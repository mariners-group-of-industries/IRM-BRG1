import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, clientFor, companyId, cookieFrom, login, USERS, type Client } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OTP_FAILED_MESSAGE, OTP_SENT_MESSAGE } from '../src/modules/participants/participant-auth.controller.js';

describe('participant sign-in with one-time codes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cement: string;
  let meghna: Client;
  let group: Client;

  const server = () => app.getHttpServer();
  const requestCode = (body: object) => request(server()).post('/api/v1/participant/otp/request').send(body).expect(200);
  const verify = (challengeId: string, code: string) => request(server()).post('/api/v1/participant/otp/verify').send({ challengeId, code });

  /** Reads the newest development-outbox message for a recipient and extracts the code. */
  async function codeFor(recipient: string): Promise<string> {
    const msg = await prisma.devOutboxMessage.findFirstOrThrow({ where: { recipient }, orderBy: { createdAt: 'desc' } });
    return /\b(\d{6})\b/.exec(msg.body)![1]!;
  }
  const outboxCount = (recipient: string) => prisma.devOutboxMessage.count({ where: { recipient } });

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    meghna = await login(app, USERS.meghnaAdmin);
    group = await login(app, USERS.groupAdmin);
    cement = await companyId(meghna, 'mariners-ventures');
  });
  afterAll(async () => {
    await app.close();
  });

  it('public company info is available for the sign-in page', async () => {
    const res = await request(server()).get(`/api/v1/participant/companies/${cement}`).expect(200);
    expect(res.body).toEqual({ id: cement, legalName: 'Mariners Ventures PLC', shortName: 'Mariners Ventures' });
  });

  it('gives the same answer for unknown and known accounts', async () => {
    const before = await outboxCount('+8801711000001');
    const unknown = await requestCode({ kind: 'SHAREHOLDER', companyId: cement, identifier: '1201959999999999' });
    const known = await requestCode({ kind: 'SHAREHOLDER', companyId: cement, identifier: '1201 9500 0000 0001' });
    expect(unknown.body.message).toBe(OTP_SENT_MESSAGE);
    expect(known.body.message).toBe(OTP_SENT_MESSAGE);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());
    expect(await outboxCount('+8801711000001')).toBe(before + 1);
    // A code for an unknown account can never be verified.
    await verify(unknown.body.challengeId, '000000').expect(401);
  });

  it('a shareholder signs in with the code sent to the registered contact', async () => {
    const ch = await requestCode({ kind: 'SHAREHOLDER', companyId: cement, identifier: '1201950000000001' });
    const code = await codeFor('+8801711000001');
    await verify(ch.body.challengeId, code === '000000' ? '111111' : '000000').expect(401);
    const ok = await verify(ch.body.challengeId, code).expect(200);
    const me = clientFor(app, cookieFrom(ok), ok.body.csrfToken);

    const profile = (await me.get('/auth/me').expect(200)).body.user;
    expect(profile.kind).toBe('PARTICIPANT');
    expect(profile.assignments.map((a: { roleKey: string }) => a.roleKey)).toEqual(['SHAREHOLDER']);

    const view = (await me.get('/participant/me').expect(200)).body;
    expect(view[0].company.shortName).toBe('Mariners Ventures');
    expect(view[0].representations[0]).toMatchObject({ kind: 'SHAREHOLDER', shareholderName: 'Abdul Karim', totalShares: '15000' });
    expect(view[0].representations[0].identities[0].value).toBe('1201••••••••0001');

    // Participants have no access to staff areas.
    expect((await me.get('/companies').expect(200)).body.items).toHaveLength(0);
    await me.get('/users').expect(403);
    await me.get(`/companies/${cement}/shareholders`).expect(404);

    // The code is single-use.
    await verify(ch.body.challengeId, code).expect(401);
  });

  it('signing in again reuses the same participant account', async () => {
    const a = await requestCode({ kind: 'SHAREHOLDER', companyId: cement, identifier: 'F-00017' });
    const ra = await verify(a.body.challengeId, await codeFor('+8801811000017')).expect(200);
    const b = await requestCode({ kind: 'SHAREHOLDER', companyId: cement, identifier: 'f-00017' });
    const rb = await verify(b.body.challengeId, await codeFor('+8801811000017')).expect(200);
    const idA = (await clientFor(app, cookieFrom(ra), ra.body.csrfToken).get('/auth/me')).body.user.id;
    const idB = (await clientFor(app, cookieFrom(rb), rb.body.csrfToken).get('/auth/me')).body.user.id;
    expect(idA).toBe(idB);
  });

  it('locks a code after too many wrong attempts', async () => {
    const ch = await requestCode({ kind: 'SHAREHOLDER', companyId: cement, identifier: '1201950000000002' });
    const code = await codeFor('rokeya.begum@example.com');
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await verify(ch.body.challengeId, wrong).expect(401);
    const res = await verify(ch.body.challengeId, code).expect(401);
    expect(res.body.message).toBe(OTP_FAILED_MESSAGE);
  });

  it('limits how many codes one account can request', async () => {
    const id = '1201950000000005';
    const before = await outboxCount('+8801911000005');
    for (let i = 0; i < 4; i++) await requestCode({ kind: 'SHAREHOLDER', companyId: cement, identifier: id });
    // Three requests deliver to both contacts; the fourth is silently refused.
    expect(await outboxCount('+8801911000005')).toBe(before + 3);
  });

  it('an approved corporate representative signs in and sees only the covered accounts', async () => {
    const ch = await requestCode({ kind: 'CORPORATE_REPRESENTATIVE', companyId: cement, email: 'imran.hossain@deltalife.example' });
    const ok = await verify(ch.body.challengeId, await codeFor('imran.hossain@deltalife.example')).expect(200);
    const rep = clientFor(app, cookieFrom(ok), ok.body.csrfToken);
    const view = (await rep.get('/participant/me').expect(200)).body[0];
    expect(view.representations[0]).toMatchObject({ kind: 'CORPORATE_REPRESENTATIVE', shareholderName: 'Delta Life Investments Limited', totalShares: '370000' });
    expect(view.representations[0].identities).toHaveLength(2);
  });

  describe('authorization lifecycle', () => {
    let holderId: string;
    let identityIds: string[];

    beforeAll(async () => {
      const list = (await meghna.get(`/companies/${cement}/shareholders?q=Delta`).expect(200)).body.items[0];
      holderId = list.id;
      identityIds = list.identities.map((i: { id: string }) => i.id);
    });

    it('a pending representative cannot sign in, and creators cannot approve their own record', async () => {
      const created = await meghna
        .upload(`/companies/${cement}/corporate-representatives`, 'document', Buffer.from('%PDF-1.7\nboard resolution'), 'resolution.pdf', {
          shareholderId: holderId,
          fullName: 'Farzana Yasmin',
          email: 'farzana@deltalife.example',
          identityIds: [identityIds[0]!],
          validFrom: '2026-01-01',
          validUntil: '2027-12-31',
        })
        .expect(201);
      expect(created.body).toMatchObject({ status: 'PENDING', effective: false, document: { fileName: 'resolution.pdf' } });

      const before = await outboxCount('farzana@deltalife.example');
      await requestCode({ kind: 'CORPORATE_REPRESENTATIVE', companyId: cement, email: 'farzana@deltalife.example' });
      expect(await outboxCount('farzana@deltalife.example')).toBe(before);

      await meghna.post(`/companies/${cement}/corporate-representatives/${created.body.id}/decision`, { decision: 'APPROVE' }).expect(409);
      await group.post(`/companies/${cement}/corporate-representatives/${created.body.id}/decision`, { decision: 'APPROVE' }).expect(200);

      const ch = await requestCode({ kind: 'CORPORATE_REPRESENTATIVE', companyId: cement, email: 'farzana@deltalife.example' });
      const ok = await verify(ch.body.challengeId, await codeFor('farzana@deltalife.example')).expect(200);
      const rep = clientFor(app, cookieFrom(ok), ok.body.csrfToken);
      const view = (await rep.get('/participant/me').expect(200)).body[0];
      expect(view.representations[0].identities).toHaveLength(1);

      // Revocation ends the session and removes the role immediately.
      await meghna.post(`/companies/${cement}/corporate-representatives/${created.body.id}/decision`, { decision: 'REVOKE', note: 'Board resolution withdrawn' }).expect(200);
      await rep.get('/participant/me').expect(401);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'farzana@deltalife.example' }, include: { assignments: true } });
      expect(user.assignments.every((a) => a.revokedAt !== null)).toBe(true);
    });

    it('rejects documents that are not PDF or images', async () => {
      await meghna
        .upload(`/companies/${cement}/corporate-representatives`, 'document', Buffer.from('MZ\x90\x00binary'), 'evil.pdf', {
          shareholderId: holderId,
          fullName: 'X Person',
          email: 'x@deltalife.example',
          identityIds: [identityIds[0]!],
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
        })
        .expect(400);
    });

    it('representatives can only be created for corporate shareholders and their own accounts', async () => {
      const abdul = (await meghna.get(`/companies/${cement}/shareholders?q=Abdul`).expect(200)).body.items[0];
      await meghna
        .post(`/companies/${cement}/corporate-representatives`, {
          shareholderId: abdul.id,
          fullName: 'Y Person',
          email: 'y@example.com',
          identityIds: [abdul.identities[0].id],
          validFrom: '2026-01-01',
          validUntil: '2026-12-31',
        })
        .expect(400);
    });

    it('an expired proxy cannot sign in', async () => {
      const rokeya = (await meghna.get(`/companies/${cement}/shareholders?q=Rokeya`).expect(200)).body.items[0];
      const p = await meghna
        .post(`/companies/${cement}/proxies`, {
          grantorShareholderId: rokeya.id,
          fullName: 'Old Proxy',
          email: 'old.proxy@example.com',
          scope: 'ATTEND',
          meetingId: (await meghna.get(`/companies/${cement}/meetings`).expect(200)).body[0].id,
          validFrom: '2025-01-01',
          validUntil: '2025-12-31',
        })
        .expect(201);
      await group.post(`/companies/${cement}/proxies/${p.body.id}/decision`, { decision: 'APPROVE' }).expect(200);
      const before = await outboxCount('old.proxy@example.com');
      await requestCode({ kind: 'PROXY_REPRESENTATIVE', companyId: cement, email: 'old.proxy@example.com' });
      expect(await outboxCount('old.proxy@example.com')).toBe(before);
    });

    it('a valid proxy signs in and sees the grantor holdings and scope', async () => {
      const ch = await requestCode({ kind: 'PROXY_REPRESENTATIVE', companyId: cement, email: 'nasima.akter@example.com' });
      const ok = await verify(ch.body.challengeId, await codeFor('nasima.akter@example.com')).expect(200);
      const view = (await clientFor(app, cookieFrom(ok), ok.body.csrfToken).get('/participant/me').expect(200)).body[0];
      expect(view.representations[0]).toMatchObject({ kind: 'PROXY_REPRESENTATIVE', shareholderName: 'Abdul Karim', scope: 'ATTEND_AND_VOTE' });
    });

    it('only administrators with authorization rights can manage proxies', async () => {
      const meeting = await login(app, USERS.meetingAdmin);
      await meeting.post(`/companies/${cement}/proxies`, {}).expect(403);
      const padma = await login(app, USERS.padmaAdmin);
      await padma.get(`/companies/${cement}/proxies`).expect(404);
    });
  });

  it('participants cannot use the staff password sign-in', async () => {
    await request(server()).post('/api/v1/auth/login').send({ email: 'nasima.akter@example.com', password: 'anything' }).expect(401);
  });

  it('never logs or audits the code itself', async () => {
    const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: 'participant.' } } });
    for (const r of rows) expect(JSON.stringify(r.metadata)).not.toMatch(/\b\d{6}\b/);
  });
});
