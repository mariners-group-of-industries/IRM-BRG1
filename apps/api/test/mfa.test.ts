import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, clientFor, cookieFrom, login, PASSWORD } from './helpers.js';
import { currentStep, totpAt } from '../src/modules/auth/totp.js';
import { resetEnvCache } from '../src/config/env.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('staff two-step verification (TOTP)', () => {
  let app: INestApplication;
  const email = 'mfa.user@irm.local';
  let secret = '';
  let recovery: string[] = [];

  beforeAll(async () => {
    app = await bootApp();
    const platform = await login(app, 'platform.admin@irm.local');
    await platform.post('/users', { email, fullName: 'Mfa Tester', password: 'Str0ng!Passphrase' }).expect(201);
  });
  afterAll(async () => {
    process.env.MFA_ENFORCE_FOR_ADMINS = 'false';
    resetEnvCache();
    await app.close();
  });

  it('enrols with a QR code and confirms with a first code', async () => {
    const u = await login(app, email, 'Str0ng!Passphrase');
    const setup = await u.post('/auth/mfa/setup').expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/IRM%20Platform/);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    secret = setup.body.secret;

    await u.post('/auth/mfa/enable', { code: '000000' === totpAt(secret, currentStep()) ? '111111' : '000000' }).expect(400);
    const enabled = await u.post('/auth/mfa/enable', { code: totpAt(secret, currentStep()) }).expect(200);
    recovery = enabled.body.recoveryCodes;
    expect(recovery).toHaveLength(10);

    const stored = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email } });
    expect(stored.mfaSecretEnc).not.toContain(secret);
    expect(stored.mfaRecoveryHashes).not.toContain(recovery[0]);
  });

  it('password sign-in now needs a second step and sets no cookie until it succeeds', async () => {
    const step1 = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Str0ng!Passphrase' }).expect(200);
    expect(step1.body.mfaRequired).toBe(true);
    expect(step1.headers['set-cookie']).toBeUndefined();

    // The code used during enrolment cannot be replayed; use the next step.
    const code = totpAt(secret, currentStep() + 1);
    const step2 = await request(app.getHttpServer()).post('/api/v1/auth/mfa/verify').send({ mfaToken: step1.body.mfaToken, code }).expect(200);
    const c = clientFor(app, cookieFrom(step2), step2.body.csrfToken);
    expect((await c.get('/auth/me').expect(200)).body.user.mfaEnabled).toBe(true);

    // Same code again is a replay.
    const again = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Str0ng!Passphrase' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/mfa/verify').send({ mfaToken: again.body.mfaToken, code }).expect(401);
  });

  it('a recovery code works exactly once', async () => {
    const s1 = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Str0ng!Passphrase' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/mfa/verify').send({ mfaToken: s1.body.mfaToken, code: recovery[0] }).expect(200);
    const s2 = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Str0ng!Passphrase' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/mfa/verify').send({ mfaToken: s2.body.mfaToken, code: recovery[0] }).expect(401);
  });

  it('when enforced, admins without MFA can only reach enrolment', async () => {
    process.env.MFA_ENFORCE_FOR_ADMINS = 'true';
    resetEnvCache();
    const admin = await login(app, 'cs@padmapharma.example', PASSWORD);
    const me = await admin.get('/auth/me').expect(200);
    expect(me.body.user.mfaSetupRequired).toBe(true);
    const blocked = await admin.get('/companies').expect(403);
    expect(blocked.body.code).toBe('MFA_SETUP_REQUIRED');
    await admin.post('/auth/mfa/setup').expect(200);
    // Roles that are not admin roles are unaffected.
    const moderator = await login(app, 'moderator@meghnacement.example', PASSWORD).catch(() => null);
    if (moderator) await moderator.get('/companies').expect(200);
    process.env.MFA_ENFORCE_FOR_ADMINS = 'false';
    resetEnvCache();
  });
});
