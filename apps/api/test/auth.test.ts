import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, login, PASSWORD, USERS } from './helpers.js';
import { LOGIN_FAILED_MESSAGE } from '../src/modules/auth/auth.service.js';

describe('authentication', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated access to protected routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/companies').expect(401);
  });

  it('health check is public', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.database).toBe('up');
  });

  it('returns the same message for unknown accounts and wrong passwords', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })
      .expect(401);
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: USERS.moderator, password: 'wrong-password' })
      .expect(401);
    expect(unknown.body.message).toBe(LOGIN_FAILED_MESSAGE);
    expect(wrong.body.message).toBe(LOGIN_FAILED_MESSAGE);
  });

  it('validates the login payload', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'not-an-email' }).expect(400);
    expect(res.body.errors.email).toBeDefined();
  });

  it('sets an httpOnly SameSite session cookie and never returns the raw token in the body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: USERS.meghnaAdmin, password: PASSWORD })
      .expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toMatch(/irm_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split('irm_session=')[1]!.split(';')[0]);
  });

  it('requires a valid CSRF token on state-changing requests', async () => {
    const cookie = await sessionCookie(app);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    const companyId = me.body.user.assignments[0].companyId as string;
    const server = app.getHttpServer();

    const missing = await request(server).patch(`/api/v1/companies/${companyId}`).set('Cookie', cookie).send({ shortName: 'X' });
    expect(missing.status).toBe(403);

    const forged = await request(server)
      .patch(`/api/v1/companies/${companyId}`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'forged-token-value-of-the-same-shape-xxxxxxxx')
      .send({ shortName: 'X' });
    expect(forged.status).toBe(403);

    const ok = await request(server)
      .patch(`/api/v1/companies/${companyId}`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', me.body.csrfToken)
      .send({ registeredAddress: 'Motijheel C/A, Dhaka 1000' });
    expect(ok.status).toBe(200);
  });

  it('rejects state-changing requests from a foreign Origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: USERS.meghnaAdmin, password: PASSWORD })
      .expect(403);
  });

  it('logout revokes the session server-side', async () => {
    const c = await login(app, USERS.meetingAdmin);
    await c.get('/auth/me').expect(200);
    await c.post('/auth/logout').expect(200);
    await c.get('/auth/me').expect(401);
  });

  it('locks the account after repeated failures', async () => {
    const email = USERS.moderator;
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: `bad-${i}` });
    }
    // Correct password is now refused while locked.
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
  });
});

async function sessionCookie(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: USERS.meghnaAdmin, password: PASSWORD });
  return ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
}
