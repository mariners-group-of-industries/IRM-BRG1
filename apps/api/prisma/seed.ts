/**
 * Development seed. Idempotent: safe to run repeatedly.
 *
 * - Syncs the permission catalogue and system roles from @irm/shared (always).
 * - Creates demo tenants, companies and staff users (development and test only).
 *
 * Demo data is fictitious. Company names are invented and do not refer to real entities.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_DEFINITIONS } from '@irm/shared';
import { PrismaClient, type RoleScope } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function syncCatalogue(): Promise<void> {
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, description: PERMISSION_DESCRIPTIONS[key] },
      update: { description: PERMISSION_DESCRIPTIONS[key] },
    });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  for (const def of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        allowedScopes: [...def.allowedScopes] as RoleScope[],
        participant: def.participant,
      },
      update: {
        name: def.name,
        description: def.description,
        allowedScopes: [...def.allowedScopes] as RoleScope[],
        participant: def.participant,
      },
    });
    // Replace the role's permission set with the catalogue definition.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: def.permissions.map((k) => ({ roleId: role.id, permissionId: perms.get(k)! })),
      }),
    ]);
  }
  console.log(`[seed] Synced ${ALL_PERMISSIONS.length} permissions and ${ROLE_DEFINITIONS.length} roles`);
}

async function seedDemo(): Promise<void> {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password) throw new Error('SEED_DEFAULT_PASSWORD is required to seed demo users');
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  const tenantA = await prisma.tenant.upsert({
    where: { slug: 'meghna-group' },
    create: { name: 'Meghna Holdings Group', slug: 'meghna-group' },
    update: {},
  });
  const tenantB = await prisma.tenant.upsert({
    where: { slug: 'padma-industries' },
    create: { name: 'Padma Industries', slug: 'padma-industries' },
    update: {},
  });

  const companies = [
    { tenantId: tenantA.id, slug: 'meghna-cement', legalName: 'Meghna Cement Mills PLC', shortName: 'Meghna Cement', companyType: 'PUBLIC_LISTED', tradingCode: 'MGCEM', registrationNumber: 'C-104522' },
    { tenantId: tenantA.id, slug: 'meghna-textiles', legalName: 'Meghna Textiles Limited', shortName: 'Meghna Textiles', companyType: 'PUBLIC_UNLISTED', tradingCode: null, registrationNumber: 'C-118790' },
    { tenantId: tenantA.id, slug: 'meghna-logistics', legalName: 'Meghna Logistics Private Limited', shortName: 'Meghna Logistics', companyType: 'PRIVATE', tradingCode: null, registrationNumber: 'C-131204' },
    { tenantId: tenantB.id, slug: 'padma-pharma', legalName: 'Padma Pharmaceuticals PLC', shortName: 'Padma Pharma', companyType: 'PUBLIC_LISTED', tradingCode: 'PADPHR', registrationNumber: 'C-099311' },
  ] as const;

  const companyIds: Record<string, { id: string; tenantId: string }> = {};
  for (const c of companies) {
    const row = await prisma.company.upsert({
      where: { tenantId_slug: { tenantId: c.tenantId, slug: c.slug } },
      create: { ...c, registeredAddress: 'Motijheel C/A, Dhaka 1000', contactEmail: `company.secretary@${c.slug}.example` },
      update: {},
    });
    companyIds[c.slug] = { id: row.id, tenantId: row.tenantId };
  }

  const roles = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const users: { email: string; fullName: string; roleKey: string; scope: RoleScope; tenantId?: string; company?: string }[] = [
    { email: 'platform.admin@irm.local', fullName: 'Nusrat Jahan', roleKey: 'PLATFORM_SUPER_ADMIN', scope: 'PLATFORM' },
    { email: 'group.admin@meghna.example', fullName: 'Tanvir Ahmed', roleKey: 'COMPANY_ADMIN', scope: 'TENANT', tenantId: tenantA.id },
    { email: 'cs@meghnacement.example', fullName: 'Farhana Rahman', roleKey: 'COMPANY_ADMIN', scope: 'COMPANY', company: 'meghna-cement' },
    { email: 'meeting.admin@meghnacement.example', fullName: 'Rafiqul Islam', roleKey: 'MEETING_ADMIN', scope: 'COMPANY', company: 'meghna-cement' },
    { email: 'moderator@meghnacement.example', fullName: 'Sadia Karim', roleKey: 'MODERATOR', scope: 'COMPANY', company: 'meghna-cement' },
    { email: 'director@meghnacement.example', fullName: 'Mahmudul Hasan', roleKey: 'BOARD_MEMBER', scope: 'COMPANY', company: 'meghna-cement' },
    { email: 'cs@padmapharma.example', fullName: 'Shirin Akter', roleKey: 'COMPANY_ADMIN', scope: 'COMPANY', company: 'padma-pharma' },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, fullName: u.fullName, passwordHash: hash },
      update: {},
    });
    const company = u.company ? companyIds[u.company] : undefined;
    const tenantId = company?.tenantId ?? u.tenantId ?? null;
    const companyId = company?.id ?? null;
    const existing = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: roles.get(u.roleKey)!, scope: u.scope, tenantId, companyId, revokedAt: null },
    });
    if (!existing) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: roles.get(u.roleKey)!, scope: u.scope, tenantId, companyId },
      });
    }
  }
  console.log(`[seed] Demo data ready: 2 tenants, ${companies.length} companies, ${users.length} users`);
}

async function main(): Promise<void> {
  await syncCatalogue();
  if (process.env.NODE_ENV !== 'production') await seedDemo();
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
