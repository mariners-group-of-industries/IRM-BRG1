import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, login, USERS, type Client } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type CompanyRow = { id: string; slug: string; tenantId: string };

describe('tenant and company isolation', () => {
  let app: INestApplication;
  let platform: Client;
  let group: Client;
  let meghna: Client;
  let padma: Client;
  let companies: Record<string, CompanyRow>;

  beforeAll(async () => {
    app = await bootApp();
    platform = await login(app, USERS.platform);
    group = await login(app, USERS.groupAdmin);
    meghna = await login(app, USERS.meghnaAdmin);
    padma = await login(app, USERS.padmaAdmin);
    const all = (await platform.get('/companies?pageSize=100').expect(200)).body.items as CompanyRow[];
    companies = Object.fromEntries(all.map((c) => [c.slug, c]));
  });
  afterAll(async () => {
    await app.close();
  });

  it('platform admin sees every company', () => {
    expect(Object.keys(companies).sort()).toEqual(
      ['meghna-cement', 'meghna-logistics', 'meghna-textiles', 'padma-pharma'].sort(),
    );
  });

  it('tenant-scoped admin sees only companies in their group', async () => {
    const slugs = ((await group.get('/companies').expect(200)).body.items as CompanyRow[]).map((c) => c.slug);
    expect(slugs.sort()).toEqual(['meghna-cement', 'meghna-logistics', 'meghna-textiles']);
  });

  it('company admin sees only their own company', async () => {
    const slugs = ((await meghna.get('/companies').expect(200)).body.items as CompanyRow[]).map((c) => c.slug);
    expect(slugs).toEqual(['meghna-cement']);
  });

  it('returns 404, not 403, for a company in another tenant', async () => {
    await padma.get(`/companies/${companies['meghna-cement']!.id}`).expect(404);
    await meghna.get(`/companies/${companies['padma-pharma']!.id}`).expect(404);
  });

  it('company admin cannot read a sibling company in the same tenant', async () => {
    await meghna.get(`/companies/${companies['meghna-textiles']!.id}`).expect(404);
  });

  it('company admin cannot update another tenant company', async () => {
    await padma.patch(`/companies/${companies['meghna-cement']!.id}`, { shortName: 'Hijacked' }).expect(404);
  });

  it('company admin cannot create companies or tenants', async () => {
    await meghna
      .post('/companies', {
        tenantId: companies['meghna-cement']!.tenantId,
        legalName: 'Rogue Co Limited',
        shortName: 'Rogue',
        slug: 'rogue-co',
        companyType: 'PRIVATE',
      })
      .expect(403);
    await meghna.post('/tenants', { name: 'Rogue Group', slug: 'rogue-group' }).expect(403);
  });

  it('company admin cannot suspend their own company', async () => {
    await meghna.patch(`/companies/${companies['meghna-cement']!.id}`, { status: 'SUSPENDED' }).expect(403);
  });

  it('tenant list is limited to the caller tenants', async () => {
    const all = (await platform.get('/tenants').expect(200)).body as { slug: string }[];
    const mine = (await padma.get('/tenants').expect(200)).body as { slug: string }[];
    expect(all.length).toBe(2);
    expect(mine.map((t) => t.slug)).toEqual(['padma-industries']);
  });

  it('dashboard counts are scoped to the caller', async () => {
    const p = (await padma.get('/dashboard/summary').expect(200)).body;
    expect(p.counts.companies).toBe(1);
    expect(p.counts.tenants).toBeNull();
    const pl = (await platform.get('/dashboard/summary').expect(200)).body;
    expect(pl.counts.tenants).toBe(2);
    expect(pl.counts.companies).toBeGreaterThanOrEqual(4);
  });

  it('audit log never leaks another tenant events', async () => {
    const entries = (await padma.get('/audit').expect(200)).body.items as { companyName: string | null }[];
    for (const e of entries) expect(e.companyName === null || e.companyName === 'Padma Pharma').toBe(true);
    const tenantIds = (await app.get(PrismaService).auditLog.findMany({
      where: { id: { in: ((await padma.get('/audit')).body.items as { id: string }[]).map((e) => e.id) } },
      select: { tenantId: true },
    })).map((r) => r.tenantId);
    for (const t of tenantIds) expect(t).toBe(companies['padma-pharma']!.tenantId);
  });

  it('platform admin can create a tenant and a company inside it', async () => {
    const t = (await platform.post('/tenants', { name: 'Jamuna Group', slug: 'jamuna-group' }).expect(201)).body;
    const c = await platform
      .post('/companies', {
        tenantId: t.id,
        legalName: 'Jamuna Power Limited',
        shortName: 'Jamuna Power',
        slug: 'jamuna-power',
        companyType: 'PUBLIC_UNLISTED',
      })
      .expect(201);
    expect(c.body.tenantName).toBe('Jamuna Group');
    // The group admin of another tenant cannot see it.
    await group.get(`/companies/${c.body.id}`).expect(404);
  });

  it('rejects duplicate company slugs inside a tenant', async () => {
    await platform
      .post('/companies', {
        tenantId: companies['meghna-cement']!.tenantId,
        legalName: 'Duplicate',
        shortName: 'Dup',
        slug: 'meghna-cement',
        companyType: 'PRIVATE',
      })
      .expect(409);
  });
});

describe('dashboard assignment counts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('platform count equals all active assignments; company admin count stays in scope', async () => {
    const prisma = app.get(PrismaService);
    const platform = await login(app, USERS.platform);
    const all = await prisma.userRoleAssignment.count({ where: { revokedAt: null } });
    expect((await platform.get('/dashboard/summary').expect(200)).body.counts.roleAssignments).toBe(all);

    const padma = await login(app, USERS.padmaAdmin);
    const padmaCo = await prisma.company.findFirstOrThrow({ where: { slug: 'padma-pharma' } });
    const inPadma = await prisma.userRoleAssignment.count({ where: { revokedAt: null, companyId: padmaCo.id } });
    expect((await padma.get('/dashboard/summary').expect(200)).body.counts.roleAssignments).toBe(inPadma);
  });
});
