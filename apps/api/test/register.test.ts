import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, companyId, login, USERS, type Client } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const MAPPING = { boId: 'BO ID', folio: 'Folio', name: 'Name', holderType: 'Type', shares: 'Shares', phone: 'Mobile', email: 'Email' };

const csv = (rows: string[][]) =>
  Buffer.from(['BO ID,Folio,Name,Type,Shares,Mobile,Email', ...rows.map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','))].join('\n'));

describe('shareholder register import', () => {
  let app: INestApplication;
  let group: Client; // tenant-scope Company Admin for every Meghna company
  let meetingAdmin: Client;
  let padma: Client;
  let textiles: string;
  let cement: string;

  async function importFile(buf: Buffer, name: string, mode: 'FULL' | 'DELTA', opts: { acceptErrors?: boolean; mapping?: object } = {}) {
    const up = await group.upload(`/companies/${textiles}/imports`, 'file', buf, name).expect(201);
    const v = await group
      .post(`/companies/${textiles}/imports/${up.body.id}/validate`, { mapping: opts.mapping ?? MAPPING, mode, asOfDate: '2026-10-31' })
      .expect(200);
    return { id: up.body.id as string, upload: up.body, validated: v.body };
  }

  beforeAll(async () => {
    app = await bootApp();
    group = await login(app, USERS.groupAdmin);
    meetingAdmin = await login(app, USERS.meetingAdmin);
    padma = await login(app, USERS.padmaAdmin);
    textiles = await companyId(group, 'meghna-textiles');
    cement = await companyId(group, 'meghna-cement');
  });
  afterAll(async () => {
    await app.close();
  });

  it('suggests a column mapping and previews sample rows on upload', async () => {
    const up = await group
      .upload(`/companies/${textiles}/imports`, 'file', csv([['1201950000001001', '', 'Test Holder', 'individual', '10', '', '']]), 'reg.csv')
      .expect(201);
    expect(up.body.status).toBe('UPLOADED');
    expect(up.body.suggestedMapping).toMatchObject({ boId: 'BO ID', name: 'Name', shares: 'Shares', folio: 'Folio' });
    expect(up.body.sampleRows[0].Name).toBe('Test Holder');
    await group.post(`/companies/${textiles}/imports/${up.body.id}/cancel`).expect(200);
  });

  it('rejects files that are not CSV or XLSX', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
    await group.upload(`/companies/${textiles}/imports`, 'file', pdf, 'register.csv').expect(400);
  });

  it('imports a register, creating shareholders, accounts, holdings and contacts', async () => {
    const { id, validated } = await importFile(
      csv([
        ['1201950000001001', '', 'Mahbub Rahman', 'individual', '1,000', '01711-000101', 'mahbub@example.com'],
        ['1201950000001002', '', 'Jamuna Holdings Ltd', 'corporate', '50000', '', 'cs@jamuna.example'],
        ['1201950000001003', '', 'Jamuna Holdings Ltd', 'corporate', '25000', '', ''],
        ['', 'F-201', 'Salma Khatun', '', '300', '+8801911000201', ''],
      ]),
      'initial.csv',
      'FULL',
    );
    expect(validated.status).toBe('VALIDATED');
    expect(validated.summary).toEqual({ new: 4, changed: 0, unchanged: 0, closed: 0 });
    const done = await group.post(`/companies/${textiles}/imports/${id}/commit`).expect(200);
    expect(done.body.status).toBe('COMMITTED');

    const summary = (await group.get(`/companies/${textiles}/register/summary`).expect(200)).body;
    expect(summary.shareholders).toBe(3); // two Jamuna accounts belong to one corporate holder
    expect(summary.identities).toBe(4);
    expect(summary.byClass[0]).toMatchObject({ code: 'ORD', totalShares: '76300', holders: 4 });

    const list = (await group.get(`/companies/${textiles}/shareholders?q=Jamuna`).expect(200)).body;
    expect(list.items[0].identities).toHaveLength(2);
    expect(list.items[0].totalShares).toBe('75000');
  });

  it('reports row errors and duplicates without touching the register', async () => {
    const before = (await group.get(`/companies/${textiles}/register/summary`).expect(200)).body;
    const { id, validated } = await importFile(
      csv([
        ['12019500', '', 'Short BO', '', '10', '', ''],
        ['1201950000001009', '', '', '', '10', '', ''],
        ['1201950000001010', '', 'Ok Holder', '', 'ten', '', ''],
        ['1201950000001011', '', 'Dup Holder', '', '5', '', ''],
        ['1201950000001011', '', 'Dup Holder', '', '6', '', ''],
        ['', '', 'No Id', '', '5', '', ''],
        ['1201950000001012', '', 'Bad Phone', '', '5', '12345', 'not-an-email'],
      ]),
      'errors.csv',
      'DELTA',
    );
    expect(validated.errorRows).toBe(5);
    const errors = (await group.get(`/companies/${textiles}/imports/${id}/rows?filter=ERROR`).expect(200)).body.items;
    const messages = errors.flatMap((r: { errors: string[] }) => r.errors).join(' | ');
    expect(messages).toContain('must be 16 digits');
    expect(messages).toContain('Holder name is required');
    expect(messages).toContain('must be a whole number');
    expect(messages).toContain('Duplicate of row 5');
    expect(messages).toContain('BO ID or folio number is required');
    const valid = (await group.get(`/companies/${textiles}/imports/${id}/rows?filter=NEW`).expect(200)).body.items;
    expect(valid.find((r: { name: string }) => r.name === 'Bad Phone').warnings.join(' ')).toMatch(/not a valid Bangladesh number/);

    // Committing with errors needs explicit confirmation.
    await group.post(`/companies/${textiles}/imports/${id}/commit`).expect(400);
    await group.post(`/companies/${textiles}/imports/${id}/cancel`).expect(200);
    const after = (await group.get(`/companies/${textiles}/register/summary`).expect(200)).body;
    expect(after.identities).toBe(before.identities);
  });

  it('a full import with errors cannot be committed, even when confirmed', async () => {
    const { id } = await importFile(csv([['bad', '', 'X', '', '1', '', '']]), 'full-bad.csv', 'FULL');
    await group.post(`/companies/${textiles}/imports/${id}/commit`, { acceptErrors: true }).expect(400);
    await group.post(`/companies/${textiles}/imports/${id}/cancel`).expect(200);
  });

  it('versions holdings: a change closes the old row and keeps history', async () => {
    const { id, validated } = await importFile(csv([['1201950000001001', '', 'Mahbub Rahman', '', '1500', '', '']]), 'delta.csv', 'DELTA');
    expect(validated.summary).toMatchObject({ new: 0, changed: 1, closed: 0 });
    await group.post(`/companies/${textiles}/imports/${id}/commit`).expect(200);

    const holder = (await group.get(`/companies/${textiles}/shareholders?q=Mahbub`).expect(200)).body.items[0];
    const detail = (await group.get(`/companies/${textiles}/shareholders/${holder.id}`).expect(200)).body;
    expect(detail.totalShares).toBe('1500');
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0].quantity).toBe('1000');
    expect(detail.history[0].validTo).not.toBeNull();
  });

  it('a full import closes holdings that are missing from the file', async () => {
    const { id, validated } = await importFile(
      csv([
        ['1201950000001001', '', 'Mahbub Rahman', '', '1500', '', ''],
        ['1201950000001002', '', 'Jamuna Holdings Ltd', 'corporate', '50000', '', ''],
        ['1201950000001003', '', 'Jamuna Holdings Ltd', 'corporate', '25000', '', ''],
      ]),
      'full-2.csv',
      'FULL',
    );
    expect(validated.summary).toMatchObject({ unchanged: 3, closed: 1 });
    const closed = (await group.get(`/companies/${textiles}/imports/${id}/rows?filter=CLOSED`).expect(200)).body.items;
    expect(closed[0].name).toBe('Salma Khatun');
    await group.post(`/companies/${textiles}/imports/${id}/commit`).expect(200);
    const salma = (await group.get(`/companies/${textiles}/shareholders?q=Salma`).expect(200)).body.items[0];
    expect(salma.totalShares).toBe('0');
  });

  it('rejects a stale preview after another import was committed', async () => {
    const a = await importFile(csv([['1201950000001001', '', 'Mahbub Rahman', '', '1600', '', '']]), 'a.csv', 'DELTA');
    const b = await importFile(csv([['1201950000001001', '', 'Mahbub Rahman', '', '1700', '', '']]), 'b.csv', 'DELTA');
    await group.post(`/companies/${textiles}/imports/${b.id}/commit`).expect(200);
    await group.post(`/companies/${textiles}/imports/${a.id}/commit`).expect(409);
    // Re-validating the stale import gives a fresh, committable preview.
    await group
      .post(`/companies/${textiles}/imports/${a.id}/validate`, { mapping: MAPPING, mode: 'DELTA', asOfDate: '2026-10-31' })
      .expect(200);
    await group.post(`/companies/${textiles}/imports/${a.id}/commit`).expect(200);
  });

  it('flags 16-digit BO IDs that Excel stored as numbers', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Register');
    ws.addRow(['BO ID', 'Name', 'Shares']);
    ws.addRow([1201950000002001, 'Number Cell', 10]);
    ws.addRow(['1201950000002002', 'Text Cell', 20]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await group.upload(`/companies/${textiles}/imports`, 'file', buf, 'reg.xlsx').expect(201);
    const v = await group
      .post(`/companies/${textiles}/imports/${up.body.id}/validate`, { mapping: { boId: 'BO ID', name: 'Name', shares: 'Shares' }, mode: 'DELTA', asOfDate: '2026-10-31' })
      .expect(200);
    expect(v.body.errorRows).toBe(1);
    expect(v.body.validRows).toBe(1);
    const errs = (await group.get(`/companies/${textiles}/imports/${up.body.id}/rows?filter=ERROR`).expect(200)).body.items;
    expect(errs[0].errors[0]).toMatch(/stored as a number in Excel/);
    await group.post(`/companies/${textiles}/imports/${up.body.id}/cancel`).expect(200);
  });

  it('masks identifiers and contacts for roles without personal-data access', async () => {
    const asAdmin = (await group.get(`/companies/${cement}/shareholders?q=Abdul`).expect(200)).body.items[0];
    expect(asAdmin.identities[0].value).toBe('1201950000000001');
    const asMeeting = (await meetingAdmin.get(`/companies/${cement}/shareholders?q=Abdul`).expect(200)).body.items[0];
    expect(asMeeting.identities[0].value).toBe('1201••••••••0001');
    expect(asMeeting.identities[0].masked).toBe(true);
    const detail = (await meetingAdmin.get(`/companies/${cement}/shareholders/${asMeeting.id}`).expect(200)).body;
    expect(detail.contacts[0].value).toBe('+88017•••••01');
    expect(detail.piiVisible).toBe(false);
  });

  it('searching by an exact BO ID works for masked viewers too', async () => {
    const res = (await meetingAdmin.get(`/companies/${cement}/shareholders?q=1201950000000002`).expect(200)).body;
    expect(res.items.map((i: { name: string }) => i.name)).toEqual(['Rokeya Begum']);
  });

  it('enforces permissions and company isolation on register endpoints', async () => {
    await meetingAdmin.upload(`/companies/${cement}/imports`, 'file', csv([]), 'x.csv').expect(403);
    await padma.get(`/companies/${cement}/shareholders`).expect(404);
    await padma.get(`/companies/${textiles}/imports`).expect(404);
    const director = await login(app, USERS.director);
    await director.get(`/companies/${cement}/shareholders`).expect(403);
  });

  it('holdings history cannot be altered at the database level', async () => {
    const prisma = app.get(PrismaService);
    const row = await prisma.shareholding.findFirstOrThrow({ where: { companyId: textiles, validTo: null } });
    await expect(prisma.shareholding.update({ where: { id: row.id }, data: { quantity: 1n } })).rejects.toThrow();
    await expect(prisma.shareholding.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it('row-level security hides other companies even from hand-written SQL', async () => {
    const prisma = app.get(PrismaService);
    const padmaId = (await prisma.company.findFirstOrThrow({ where: { slug: 'padma-pharma' } })).id;
    const seen = await prisma.scoped([padmaId], (tx) =>
      tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM shareholders WHERE company_id = ${cement}::uuid`,
    );
    expect(Number(seen[0]!.n)).toBe(0);
    const own = await prisma.scoped([cement], (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM shareholders`);
    expect(Number(own[0]!.n)).toBeGreaterThan(0);
    // Writing a row for another company is rejected by the policy.
    await expect(
      prisma.scoped([padmaId], (tx) =>
        tx.shareClass.create({ data: { tenantId: '00000000-0000-0000-0000-000000000000', companyId: cement, code: 'HACK', name: 'Hack' } }),
      ),
    ).rejects.toThrow();
  });
});
