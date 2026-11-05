import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, clientFor, companyId, cookieFrom, login, USERS, type Client } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const NOTICE = 'Notice is hereby given that the meeting will be held virtually to transact the business set out below.';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().replace('Z', '+00:00');

describe('meeting management', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Client; // Company Admin, Mariners Ventures
  let group: Client; // Company Admin for the whole group (second approver)
  let meetingAdmin: Client;
  let padma: Client;
  let ventures: string;

  const base = () => `/companies/${ventures}/meetings`;
  async function create(over: object = {}) {
    const res = await admin
      .post(base(), { type: 'AGM', title: 'Test Annual General Meeting', scheduledStart: inDays(30), recordDate: '2026-10-31', ...over })
      .expect(201);
    return res.body as { id: string; version: number; state: string };
  }
  /** Moves a meeting to a state, using its current version, and asserts the HTTP status. */
  async function go(c: Client, id: string, to: string, status: number, extra: object = {}) {
    const cur = (await admin.get(`${base()}/${id}`).expect(200)).body;
    return c.post(`${base()}/${id}/transition`, { to, expectedVersion: cur.version, ...extra }).expect(status);
  }
  async function readyToPublish(id: string) {
    await admin.patch(`${base()}/${id}`, { noticeText: NOTICE }).expect(200);
    await admin.post(`${base()}/${id}/agenda`, { number: '1', title: 'Adopt the accounts', hasResolution: true, resolutionKind: 'ORDINARY', resolutionText: 'RESOLVED that the accounts be adopted.' }).expect(201);
  }
  async function participant(kind: 'SHAREHOLDER' | 'PROXY_REPRESENTATIVE', idOrEmail: string, recipient: string): Promise<Client> {
    const body = kind === 'SHAREHOLDER' ? { kind, companyId: ventures, identifier: idOrEmail } : { kind, companyId: ventures, email: idOrEmail };
    const ch = await request(app.getHttpServer()).post('/api/v1/participant/otp/request').send(body).expect(200);
    const msg = await prisma.devOutboxMessage.findFirstOrThrow({ where: { recipient }, orderBy: { createdAt: 'desc' } });
    const code = /\b(\d{6})\b/.exec(msg.body)![1]!;
    const ok = await request(app.getHttpServer()).post('/api/v1/participant/otp/verify').send({ challengeId: ch.body.challengeId, code }).expect(200);
    return clientFor(app, cookieFrom(ok), ok.body.csrfToken);
  }

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    admin = await login(app, USERS.marinersAdmin);
    group = await login(app, USERS.groupAdmin);
    meetingAdmin = await login(app, USERS.meetingAdmin);
    padma = await login(app, USERS.padmaAdmin);
    ventures = await companyId(admin, 'mariners-ventures');
  });
  afterAll(async () => {
    await app.close();
  });

  it('validates new meetings', async () => {
    const bad = await admin.post(base(), { type: 'AGM', title: 'Bad', scheduledStart: inDays(10), recordDate: '2099-01-01' }).expect(400);
    expect(Object.keys(bad.body.errors)).toEqual(expect.arrayContaining(['title', 'recordDate']));
    await admin.post(base(), { type: 'EGM', title: 'Past meeting', scheduledStart: inDays(-1), recordDate: '2026-10-01' }).expect(400);
    await admin.post(base(), { type: 'EGM', title: 'Hybrid without venue', scheduledStart: inDays(5), recordDate: '2026-10-01', mode: 'HYBRID' }).expect(400);
  });

  it('manages the agenda: numbering, resolutions and order', async () => {
    const m = await create();
    await admin.post(`${base()}/${m.id}/agenda`, { number: '1', title: 'Chair address', hasResolution: false }).expect(201);
    await admin.post(`${base()}/${m.id}/agenda`, { number: '2', title: 'Dividend', hasResolution: true, resolutionKind: 'ORDINARY', resolutionText: 'RESOLVED that a dividend be paid.' }).expect(201);
    await admin.post(`${base()}/${m.id}/agenda`, { number: '2', title: 'Duplicate', hasResolution: false }).expect(400);
    await admin.post(`${base()}/${m.id}/agenda`, { number: '3', title: 'Special', hasResolution: true, resolutionKind: 'SPECIAL', resolutionText: 'short' }).expect(400);
    const items = (await admin.get(`${base()}/${m.id}/agenda`).expect(200)).body as { id: string; number: string; resolution: object | null }[];
    expect(items.map((i) => i.number)).toEqual(['1', '2']);
    expect(items[0]!.resolution).toBeNull();
    const reordered = (await admin.post(`${base()}/${m.id}/agenda/order`, { ids: [items[1]!.id, items[0]!.id] }).expect(200)).body;
    expect(reordered.map((i: { number: string }) => i.number)).toEqual(['2', '1']);
    await meetingAdmin.post(`${base()}/${m.id}/agenda`, { number: '9', title: 'Not allowed', hasResolution: false }).expect(403);
  });

  it('refuses to publish until the meeting is ready, then publishes', async () => {
    const m = await create();
    const blocked = await go(admin, m.id, 'SCHEDULED', 409);
    expect(blocked.body.message).toMatch(/notice text is written.*at least one agenda item/);
    const control = (await admin.get(`${base()}/${m.id}/control`).expect(200)).body;
    expect(control.transitions[0].allowed).toBe(false);

    await readyToPublish(m.id);
    const published = (await go(admin, m.id, 'SCHEDULED', 200)).body;
    expect(published.state).toBe('SCHEDULED');
    expect(published.publishedAt).not.toBeNull();
  });

  it('rejects transitions outside the state machine and stale versions', async () => {
    const m = await create();
    await go(meetingAdmin, m.id, 'LIVE', 409);
    await readyToPublish(m.id);
    await admin.post(`${base()}/${m.id}/transition`, { to: 'SCHEDULED', expectedVersion: 1 }).expect(409);
  });

  it('separates configuration from operation', async () => {
    const m = await create();
    await readyToPublish(m.id);
    await go(meetingAdmin, m.id, 'SCHEDULED', 403);
    await go(admin, m.id, 'SCHEDULED', 200);
    await go(admin, m.id, 'REGISTRATION_OPEN', 200);
    // Company admins configure; only meeting admins run the live meeting.
    await go(admin, m.id, 'LIVE', 403);
    await go(meetingAdmin, m.id, 'LIVE', 200);
    await go(meetingAdmin, m.id, 'PAUSED', 200);
    await go(meetingAdmin, m.id, 'LIVE', 200);
    await go(meetingAdmin, m.id, 'COMPLETED', 200);
    await go(meetingAdmin, m.id, 'ARCHIVED', 403);
    const archived = (await go(admin, m.id, 'ARCHIVED', 200)).body;
    expect(archived.state).toBe('ARCHIVED');
    const history = (await admin.get(`${base()}/${m.id}/control`).expect(200)).body.history;
    expect(history.map((h: { to: string }) => h.to)).toEqual(['ARCHIVED', 'COMPLETED', 'LIVE', 'PAUSED', 'LIVE', 'REGISTRATION_OPEN', 'SCHEDULED', 'DRAFT']);
  });

  it('returning to draft needs a reason', async () => {
    const m = await create();
    await readyToPublish(m.id);
    await go(admin, m.id, 'SCHEDULED', 200);
    await go(admin, m.id, 'DRAFT', 400);
    await go(admin, m.id, 'DRAFT', 200, { reason: 'Correcting the dividend amount in the notice' });
  });

  it('locks the agenda after registration opens and rules once live', async () => {
    const m = await create();
    await readyToPublish(m.id);
    await go(admin, m.id, 'SCHEDULED', 200);
    await go(admin, m.id, 'REGISTRATION_OPEN', 200);
    await admin.post(`${base()}/${m.id}/agenda`, { number: '5', title: 'Late item', hasResolution: false }).expect(409);
    await admin.patch(`${base()}/${m.id}`, { title: 'Renamed meeting' }).expect(409);
    const rules = (await admin.get(`${base()}/${m.id}`).expect(200)).body.rules;
    await admin.put(`${base()}/${m.id}/rules`, { ...rules, pollDemand: { enabled: true, threshold: 'ANY_MEMBER', thresholdValue: null } }).expect(200);
    await admin.put(`${base()}/${m.id}/rules`, { ...rules, audioQuestionMaxSeconds: 999 }).expect(400);
    await go(meetingAdmin, m.id, 'LIVE', 200);
    await admin.put(`${base()}/${m.id}/rules`, rules).expect(409);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'meeting.rules_update', targetId: m.id } });
    expect((audit.metadata as { changed: string[] }).changed).toEqual(['pollDemand']);
  });

  it('freezes holdings at the record date when registration opens', async () => {
    const m = await create();
    await readyToPublish(m.id);
    await go(admin, m.id, 'SCHEDULED', 200);
    await go(admin, m.id, 'REGISTRATION_OPEN', 200);
    const snap = (await admin.get(`${base()}/${m.id}/snapshot`).expect(200)).body;
    expect(snap.takenAt).not.toBeNull();
    expect(snap.holders).toBe(5);
    expect(snap.accounts).toBe(6);
    expect(snap.totalShares).toBe('396100');
    expect(snap.totalVotes).toBe('396100');

    const ents = (await admin.get(`${base()}/${m.id}/entitlements`).expect(200)).body;
    expect(ents.total).toBe(6);
    expect(ents.items[0]).toMatchObject({ shareholderName: 'Delta Life Investments Limited', shares: '250000' });

    // Snapshot rows are immutable.
    const row = await prisma.shareholdingSnapshot.findFirstOrThrow({ where: { meetingId: m.id } });
    await expect(prisma.shareholdingSnapshot.update({ where: { id: row.id }, data: { quantity: 1n } })).rejects.toThrow();
    await expect(prisma.votingEntitlement.deleteMany({ where: { meetingId: m.id } })).rejects.toThrow();
  });

  it('will not open registration when the register has nothing on the record date', async () => {
    const m = await create({ recordDate: '2026-09-30' });
    await readyToPublish(m.id);
    await go(admin, m.id, 'SCHEDULED', 200);
    const res = await go(admin, m.id, 'REGISTRATION_OPEN', 409);
    expect(res.body.message).toMatch(/register has holdings on or before the record date/);
  });

  it('will not open registration before the record date', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const m = await create({ recordDate: future, scheduledStart: inDays(20) });
    await readyToPublish(m.id);
    await go(admin, m.id, 'SCHEDULED', 200);
    const res = await go(admin, m.id, 'REGISTRATION_OPEN', 409);
    expect(res.body.message).toMatch(/record date has passed/);
  });

  it('accepts only PDF documents and shows participants only published ones', async () => {
    const m = await create();
    await readyToPublish(m.id);
    await admin.upload(`${base()}/${m.id}/documents`, 'file', Buffer.from('not a pdf'), 'notice.pdf', { kind: 'NOTICE', title: 'Notice' }).expect(400);
    const docs = (await admin.upload(`${base()}/${m.id}/documents`, 'file', PDF, 'notice.pdf', { kind: 'NOTICE', title: 'Notice of AGM' }).expect(201)).body;
    const draftDoc = (await admin.upload(`${base()}/${m.id}/documents`, 'file', PDF, 'draft.pdf', { kind: 'OTHER', title: 'Internal draft' }).expect(201)).body;
    expect(draftDoc).toHaveLength(2);
    await admin.patch(`${base()}/${m.id}/documents/${docs[0].id}`, { published: true }).expect(200);
    await go(admin, m.id, 'SCHEDULED', 200);

    const holder = await participant('SHAREHOLDER', '1201950000000002', 'rokeya.begum@example.com');
    const view = (await holder.get(`/participant/meetings/${m.id}`).expect(200)).body;
    expect(view.documents.map((d: { title: string }) => d.title)).toEqual(['Notice of AGM']);
    await holder.get(`/participant/meetings/${m.id}/documents/${docs[0].id}`).expect(200);
    await holder.get(`/participant/meetings/${m.id}/documents/${draftDoc[1].id}`).expect(404);
  });

  it('participants register for what they hold or represent', async () => {
    const m = await create();
    await readyToPublish(m.id);
    await go(admin, m.id, 'SCHEDULED', 200);

    const abdul = (await admin.get(`/companies/${ventures}/shareholders?q=Abdul`).expect(200)).body.items[0];
    const proxy = (await admin
      .post(`/companies/${ventures}/proxies`, { grantorShareholderId: abdul.id, fullName: 'Meeting Proxy', email: 'meeting.proxy@example.com', scope: 'ATTEND_AND_VOTE', meetingId: m.id, validFrom: '2026-01-01', validUntil: '2027-12-31' })
      .expect(201)).body;
    expect(proxy.meetingReference).toBe('Test Annual General Meeting');
    await group.post(`/companies/${ventures}/proxies/${proxy.id}/decision`, { decision: 'APPROVE' }).expect(200);

    const holder = await participant('SHAREHOLDER', '1201950000000002', 'rokeya.begum@example.com');
    let view = (await holder.get(`/participant/meetings/${m.id}`).expect(200)).body;
    expect(view.registrationOpen).toBe(false);
    expect(view.eligibility[0]).toMatchObject({ eligible: false, reason: 'Registration has not opened' });
    await holder.post(`/participant/meetings/${m.id}/register`, { key: view.eligibility[0].key }).expect(409);

    await go(admin, m.id, 'REGISTRATION_OPEN', 200);
    view = (await holder.get(`/participant/meetings/${m.id}`).expect(200)).body;
    expect(view.eligibility[0]).toMatchObject({ kind: 'SHAREHOLDER', eligible: true, votes: '8500', registered: false });
    view = (await holder.post(`/participant/meetings/${m.id}/register`, { key: view.eligibility[0].key }).expect(200)).body;
    expect(view.eligibility[0].registered).toBe(true);
    // Registering twice is harmless.
    await holder.post(`/participant/meetings/${m.id}/register`, { key: view.eligibility[0].key }).expect(200);

    const proxyClient = await participant('PROXY_REPRESENTATIVE', 'meeting.proxy@example.com', 'meeting.proxy@example.com');
    const pv = (await proxyClient.get(`/participant/meetings/${m.id}`).expect(200)).body;
    expect(pv.eligibility).toHaveLength(1);
    expect(pv.eligibility[0]).toMatchObject({ kind: 'PROXY_REPRESENTATIVE', shareholderName: 'Abdul Karim', votes: '15000', eligible: true });
    await proxyClient.post(`/participant/meetings/${m.id}/register`, { key: pv.eligibility[0].key }).expect(200);

    const list = (await admin.get(`${base()}/${m.id}/participants`).expect(200)).body;
    expect(list.map((r: { kind: string; votes: string }) => `${r.kind}:${r.votes}`).sort()).toEqual(['PROXY_REPRESENTATIVE:15000', 'SHAREHOLDER:8500']);
    const ents = (await admin.get(`${base()}/${m.id}/entitlements?q=Rokeya`).expect(200)).body;
    expect(ents.items[0].registered).toBe(true);

    // The demo proxy for a different meeting gives no rights here.
    const nasima = await participant('PROXY_REPRESENTATIVE', 'nasima.akter@example.com', 'nasima.akter@example.com');
    expect((await nasima.get(`/participant/meetings/${m.id}`).expect(200)).body.eligibility).toHaveLength(0);
  });

  it('assigns only board members and moderators of the company', async () => {
    const m = await create();
    const staff = (await admin.get(`${base()}/${m.id}/staff`).expect(200)).body;
    const director = staff.candidates.find((c: { roles: string[] }) => c.roles.includes('BOARD_MEMBER'));
    const moderator = staff.candidates.find((c: { roles: string[] }) => c.roles.includes('MODERATOR'));
    const saved = (await admin.put(`${base()}/${m.id}/staff`, { boardMemberIds: [director.userId], moderatorIds: [moderator.userId] }).expect(200)).body;
    expect(saved.boardMembers).toHaveLength(1);
    await admin.put(`${base()}/${m.id}/staff`, { boardMemberIds: [moderator.userId], moderatorIds: [] }).expect(400);
  });

  it('keeps meetings inside their company', async () => {
    const m = await create();
    await padma.get(`${base()}/${m.id}`).expect(404);
    await padma.get(base()).expect(404);
    const padmaId = await companyId(padma, 'padma-pharma');
    await padma.get(`/companies/${padmaId}/meetings/${m.id}`).expect(404);
    const staffOnly = await login(app, USERS.director);
    await staffOnly.get(`${base()}/${m.id}`).expect(200);
    await staffOnly.post(base(), { type: 'AGM', title: 'Director made', scheduledStart: inDays(9), recordDate: '2026-10-01' }).expect(403);
  });

  it('participants never see draft meetings', async () => {
    const m = await create();
    const holder = await participant('SHAREHOLDER', '1201950000000002', 'rokeya.begum@example.com');
    await holder.get(`/participant/meetings/${m.id}`).expect(404);
    expect(((await holder.get('/participant/meetings').expect(200)).body as { id: string }[]).some((x) => x.id === m.id)).toBe(false);
    await holder.get(`${base()}/${m.id}`).expect(404);
  });
});
