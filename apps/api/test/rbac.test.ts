import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, login, USERS, type Client } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const NEW_PASSWORD = 'Str0ng!Passphrase';

describe('role assignment and privilege boundaries', () => {
  let app: INestApplication;
  let platform: Client;
  let meghna: Client;
  let meetingAdmin: Client;
  let meghnaCementId: string;
  let padmaId: string;

  beforeAll(async () => {
    app = await bootApp();
    platform = await login(app, USERS.platform);
    meghna = await login(app, USERS.meghnaAdmin);
    meetingAdmin = await login(app, USERS.meetingAdmin);
    const items = (await platform.get('/companies?pageSize=100').expect(200)).body.items as { id: string; slug: string }[];
    meghnaCementId = items.find((c) => c.slug === 'mariners-ventures')!.id;
    padmaId = items.find((c) => c.slug === 'padma-pharma')!.id;
  });
  afterAll(async () => {
    await app.close();
  });

  async function newUser(c: Client, email: string) {
    const res = await c.post('/users', { email, fullName: 'Test Person', password: NEW_PASSWORD }).expect(201);
    return res.body.id as string;
  }

  it('enforces password policy on user creation', async () => {
    const res = await meghna.post('/users', { email: 'weak@example.com', fullName: 'Weak', password: 'short' }).expect(400);
    expect(res.body.errors.password).toBeDefined();
  });

  it('company admin can grant a moderator role in their own company', async () => {
    const id = await newUser(meghna, 'new.moderator@marinersventures.example');
    await meghna.post('/assignments', { userId: id, roleKey: 'MODERATOR', scope: 'COMPANY', companyId: meghnaCementId }).expect(201);
  });

  it('company admin cannot grant roles in another tenant company', async () => {
    const id = await newUser(meghna, 'cross.tenant@marinersventures.example');
    await meghna.post('/assignments', { userId: id, roleKey: 'MODERATOR', scope: 'COMPANY', companyId: padmaId }).expect(404);
  });

  it('company admin can grant meeting admin but not participant roles', async () => {
    const id = await newUser(meghna, 'escalation@marinersventures.example');
    await meghna.post('/assignments', { userId: id, roleKey: 'MEETING_ADMIN', scope: 'COMPANY', companyId: meghnaCementId }).expect(201);
    // Participant roles come only from verification and authorization flows.
    await meghna
      .post('/assignments', { userId: id, roleKey: 'SHAREHOLDER', scope: 'COMPANY', companyId: meghnaCementId })
      .expect(403);
    const denied = await app.get(PrismaService).auditLog.findFirst({
      where: { action: 'role.assign', outcome: 'DENIED', targetId: null, actorEmail: USERS.meghnaAdmin },
      orderBy: { occurredAt: 'desc' },
    });
    expect(denied).not.toBeNull();
  });

  it('only platform admins can grant platform roles', async () => {
    const id = await newUser(meghna, 'wannabe.platform@marinersventures.example');
    await meghna.post('/assignments', { userId: id, roleKey: 'PLATFORM_SUPER_ADMIN', scope: 'PLATFORM' }).expect(403);
  });

  it('rejects a role at a scope it does not allow', async () => {
    const id = await newUser(platform, 'scope.check@irm.local');
    await platform.post('/assignments', { userId: id, roleKey: 'MODERATOR', scope: 'TENANT', tenantId: '00000000-0000-4000-8000-000000000000' }).expect(400);
  });

  it('meeting admin cannot manage users or roles', async () => {
    await meetingAdmin.post('/users', { email: 'x@example.com', fullName: 'X Person', password: NEW_PASSWORD }).expect(403);
    await meetingAdmin.get('/users').expect(403);
  });

  it('newly granted role takes effect on the next request', async () => {
    const email = 'fresh.official@marinersventures.example';
    const id = await newUser(meghna, email);
    // Before assignment: no access.
    const before = await login(app, email, NEW_PASSWORD);
    expect(((await before.get('/companies').expect(200)).body.items as unknown[]).length).toBe(0);
    await meghna.post('/assignments', { userId: id, roleKey: 'COMPANY_OFFICIAL', scope: 'COMPANY', companyId: meghnaCementId }).expect(201);
    expect(((await before.get('/companies').expect(200)).body.items as unknown[]).length).toBe(1);
  });

  it('revoking a role removes access immediately', async () => {
    const email = 'revoke.me@marinersventures.example';
    const id = await newUser(meghna, email);
    const a = await meghna.post('/assignments', { userId: id, roleKey: 'COMPANY_OFFICIAL', scope: 'COMPANY', companyId: meghnaCementId }).expect(201);
    const u = await login(app, email, NEW_PASSWORD);
    await u.get(`/companies/${meghnaCementId}`).expect(200);
    await meghna.delete(`/assignments/${a.body.id}`).expect(200);
    await u.get(`/companies/${meghnaCementId}`).expect(404);
  });

  it('duplicate active assignments are rejected by the database', async () => {
    const id = await newUser(meghna, 'dupe.assign@marinersventures.example');
    const body = { userId: id, roleKey: 'COMPANY_OFFICIAL', scope: 'COMPANY', companyId: meghnaCementId };
    await meghna.post('/assignments', body).expect(201);
    await meghna.post('/assignments', body).expect(409);
  });

  it('users list only shows people and roles inside the caller scope', async () => {
    const res = await meghna.get('/users').expect(200);
    const items = res.body.items as { email: string; roles: { scopeName: string | null }[] }[];
    expect(items.some((u) => u.email === USERS.padmaAdmin)).toBe(false);
    expect(items.some((u) => u.email === USERS.platform)).toBe(false);
    for (const u of items) for (const r of u.roles) expect(r.scopeName).toBe('Mariners Ventures');
  });

  it('disabling a user ends their sessions', async () => {
    const email = 'disable.me@irm.local';
    const id = await newUser(platform, email);
    const u = await login(app, email, NEW_PASSWORD);
    await u.get('/auth/me').expect(200);
    await platform.post(`/users/${id}/disable`).expect(200);
    await u.get('/auth/me').expect(401);
  });

  it('audit log is append-only at the database level', async () => {
    const prisma = app.get(PrismaService);
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it('database rejects a company assignment whose tenant does not match the company', async () => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: USERS.moderator } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'COMPANY_OFFICIAL' } });
    const padma = await prisma.company.findUniqueOrThrow({ where: { id: padmaId } });
    const meghnaCo = await prisma.company.findUniqueOrThrow({ where: { id: meghnaCementId } });
    expect(padma.tenantId).not.toBe(meghnaCo.tenantId);
    await expect(
      prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id, scope: 'COMPANY', tenantId: padma.tenantId, companyId: meghnaCo.id },
      }),
    ).rejects.toThrow();
  });
});

describe('adding a company member in one step', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates the account and role together, or neither', async () => {
    const meghna = await login(app, USERS.meghnaAdmin);
    const items = (await meghna.get('/companies').expect(200)).body.items as { id: string }[];
    const cement = items[0]!.id;
    const ok = await meghna
      .post(`/companies/${cement}/members`, { email: 'one.step@marinersventures.example', fullName: 'One Step', password: 'Str0ng!Passphrase', roleKey: 'MODERATOR' })
      .expect(201);
    expect(ok.body.assignmentId).toBeDefined();

    // A role the caller may not grant fails without creating the account.
    await meghna
      .post(`/companies/${cement}/members`, { email: 'no.account@marinersventures.example', fullName: 'No Account', password: 'Str0ng!Passphrase', roleKey: 'SHAREHOLDER' })
      .expect(403);
    const prisma = app.get(PrismaService);
    expect(await prisma.user.findUnique({ where: { email: 'no.account@marinersventures.example' } })).toBeNull();
  });
});
