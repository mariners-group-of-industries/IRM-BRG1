/**
 * Development-only demo register for Mariners Ventures PLC. Every name, account
 * number, phone and email is fictitious. Runs once: skipped if the company already has shareholders.
 */
import type { PrismaClient } from '../src/generated/prisma/client.js';

const D = (s: string) => new Date(`${s}T00:00:00Z`);

export async function seedDemoRegister(prisma: PrismaClient): Promise<void> {
  const company = await prisma.company.findFirst({ where: { slug: 'mariners-ventures' } });
  if (!company) return;
  if ((await prisma.shareholder.count({ where: { companyId: company.id } })) > 0) return;
  const scope = { tenantId: company.tenantId, companyId: company.id };
  const asOfDate = D('2026-10-31');

  const ord = await prisma.shareClass.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ORD' } },
    create: { ...scope, code: 'ORD', name: 'Ordinary shares', votesPerShare: 1 },
    update: {},
  });

  const holders: {
    name: string;
    nameBn?: string;
    type: 'INDIVIDUAL' | 'CORPORATE';
    accounts: { kind: 'BO' | 'FOLIO'; value: string; shares: bigint }[];
    phone?: string;
    email?: string;
  }[] = [
    { name: 'Abdul Karim', nameBn: 'আব্দুল করিম', type: 'INDIVIDUAL', accounts: [{ kind: 'BO', value: '1201950000000001', shares: 15_000n }], phone: '+8801711000001' },
    { name: 'Rokeya Begum', nameBn: 'রোকেয়া বেগম', type: 'INDIVIDUAL', accounts: [{ kind: 'BO', value: '1201950000000002', shares: 8_500n }], email: 'rokeya.begum@example.com' },
    { name: 'Shahidul Alam', type: 'INDIVIDUAL', accounts: [{ kind: 'FOLIO', value: 'F-00017', shares: 2_000n }], phone: '+8801811000017' },
    {
      name: 'Delta Life Investments Limited',
      type: 'CORPORATE',
      accounts: [
        { kind: 'BO', value: '1201950000000003', shares: 250_000n },
        { kind: 'BO', value: '1201950000000004', shares: 120_000n },
      ],
      email: 'company.secretary@deltalife.example',
    },
    { name: 'Nasreen Sultana', type: 'INDIVIDUAL', accounts: [{ kind: 'BO', value: '1201950000000005', shares: 600n }], phone: '+8801911000005', email: 'nasreen@example.com' },
  ];

  const ids: Record<string, { shareholderId: string; identityIds: string[] }> = {};
  for (const h of holders) {
    const s = await prisma.shareholder.create({ data: { ...scope, type: h.type, name: h.name, nameBn: h.nameBn ?? null } });
    const identityIds: string[] = [];
    for (const a of h.accounts) {
      const i = await prisma.shareholderIdentity.create({ data: { ...scope, shareholderId: s.id, kind: a.kind, value: a.value } });
      await prisma.shareholding.create({ data: { ...scope, identityId: i.id, shareClassId: ord.id, quantity: a.shares, asOfDate } });
      identityIds.push(i.id);
    }
    if (h.phone) await prisma.shareholderContact.create({ data: { ...scope, shareholderId: s.id, kind: 'PHONE', value: h.phone, source: 'REGISTER', verifiedAt: new Date() } });
    if (h.email) await prisma.shareholderContact.create({ data: { ...scope, shareholderId: s.id, kind: 'EMAIL', value: h.email, source: 'REGISTER', verifiedAt: new Date() } });
    ids[h.name] = { shareholderId: s.id, identityIds };
  }

  const creator = await prisma.user.findUniqueOrThrow({ where: { email: 'cs@marinersventures.example' } });
  const approver = await prisma.user.findUniqueOrThrow({ where: { email: 'group.admin@mariners.example' } });
  const delta = ids['Delta Life Investments Limited']!;
  await prisma.corporateRepresentative.create({
    data: {
      ...scope,
      shareholderId: delta.shareholderId,
      fullName: 'Imran Hossain',
      designation: 'Head of Treasury',
      email: 'imran.hossain@deltalife.example',
      identityIds: delta.identityIds,
      validFrom: D('2026-01-01'),
      validUntil: D('2027-12-31'),
      status: 'APPROVED',
      createdById: creator.id,
      decidedById: approver.id,
      decidedAt: new Date(),
    },
  });
  await prisma.proxyAuthorization.create({
    data: {
      ...scope,
      grantorShareholderId: ids['Abdul Karim']!.shareholderId,
      fullName: 'Nasima Akter',
      email: 'nasima.akter@example.com',
      scope: 'ATTEND_AND_VOTE',
      meetingReference: '36th Annual General Meeting 2026',
      validFrom: D('2026-01-01'),
      validUntil: D('2027-06-30'),
      status: 'APPROVED',
      createdById: creator.id,
      decidedById: approver.id,
      decidedAt: new Date(),
    },
  });
  console.log(`[seed] Demo register for Mariners Ventures: ${holders.length} shareholders, 1 corporate representative, 1 proxy`);
}
