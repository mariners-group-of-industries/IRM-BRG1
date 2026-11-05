/**
 * Development-only demo AGM for Mariners Ventures PLC: a published (Scheduled) meeting
 * with a notice, a typical AGM agenda and assigned staff. Fictitious content.
 * Runs once: skipped if the company already has a meeting.
 */
import { DEFAULT_MEETING_RULES } from '@irm/shared';
import type { PrismaClient } from '../src/generated/prisma/client.js';

const NOTICE = `NOTICE is hereby given that the 36th Annual General Meeting of Mariners Ventures PLC will be held virtually on Thursday, 10 December 2026 at 10:30 a.m. (Dhaka time) through the company's digital AGM platform to transact the business set out in the agenda below.

Shareholders whose names appear in the Register of Members or in the Depository Register on the record date, 31 October 2026, are entitled to attend and vote at the meeting.

A member entitled to attend and vote may appoint a proxy to attend and vote on their behalf. The proxy form, duly completed, must be lodged with the company not later than 72 hours before the meeting.

By order of the Board
Farhana Rahman
Company Secretary`;

const AGENDA: { number: string; title: string; kind?: 'ORDINARY' | 'SPECIAL'; text?: string }[] = [
  { number: '1', title: 'Welcome address by the Chair' },
  { number: '2', title: 'Audited financial statements for the year ended 30 June 2026', kind: 'ORDINARY', text: 'RESOLVED that the audited financial statements of the company for the year ended 30 June 2026, together with the reports of the Directors and the Auditors thereon, be and are hereby received, considered and adopted.' },
  { number: '3', title: 'Declaration of dividend', kind: 'ORDINARY', text: 'RESOLVED that a cash dividend of 15% (Tk. 1.50 per share) for the year ended 30 June 2026, as recommended by the Board, be and is hereby approved for shareholders whose names appear on the record date.' },
  { number: '4', title: 'Re-election of Directors retiring by rotation', kind: 'ORDINARY', text: 'RESOLVED that Mr. Mahmudul Hasan, who retires by rotation and being eligible offers himself for re-election, be and is hereby re-elected as a Director of the company.' },
  { number: '5', title: 'Appointment of statutory auditors and fixing their remuneration', kind: 'ORDINARY', text: 'RESOLVED that M/s. Rahman Hossain & Co., Chartered Accountants, be and are hereby appointed statutory auditors of the company until the conclusion of the next Annual General Meeting at a remuneration of Tk. 4,50,000 plus VAT.' },
  { number: '6', title: 'Appointment of corporate governance compliance auditor', kind: 'ORDINARY', text: 'RESOLVED that M/s. Alam & Associates, Chartered Secretaries, be and are hereby appointed as corporate governance compliance auditor for the year 2026-27 at a remuneration of Tk. 1,00,000 plus VAT.' },
  { number: '7', title: 'Amendment of the Articles of Association (special business)', kind: 'SPECIAL', text: 'RESOLVED that Article 52 of the Articles of Association of the company be and is hereby amended to permit general meetings to be held virtually or in hybrid form using digital platforms, subject to applicable law.' },
];

export async function seedDemoMeeting(prisma: PrismaClient): Promise<void> {
  const company = await prisma.company.findFirst({ where: { slug: 'mariners-ventures' } });
  if (!company) return;
  if ((await prisma.meeting.count({ where: { companyId: company.id } })) > 0) return;
  const scope = { tenantId: company.tenantId, companyId: company.id };
  const admin = await prisma.user.findUnique({ where: { email: 'cs@marinersventures.example' } });
  if (!admin) return;

  const meeting = await prisma.meeting.create({
    data: {
      ...scope,
      type: 'AGM',
      title: '36th Annual General Meeting 2026',
      description: 'Annual General Meeting for the financial year ended 30 June 2026.',
      noticeText: NOTICE,
      mode: 'VIRTUAL',
      scheduledStart: new Date('2026-12-10T10:30:00+06:00'),
      recordDate: new Date('2026-10-31T00:00:00Z'),
      state: 'SCHEDULED',
      version: 2,
      rules: DEFAULT_MEETING_RULES,
      publishedAt: new Date(),
      createdById: admin.id,
    },
  });
  await prisma.meetingStateTransition.createMany({
    data: [
      { ...scope, meetingId: meeting.id, fromState: null, toState: 'DRAFT', actorUserId: admin.id },
      { ...scope, meetingId: meeting.id, fromState: 'DRAFT', toState: 'SCHEDULED', actorUserId: admin.id },
    ],
  });
  for (const [i, a] of AGENDA.entries()) {
    const item = await prisma.agendaItem.create({ data: { ...scope, meetingId: meeting.id, number: a.number, title: a.title, position: i + 1 } });
    if (a.kind && a.text) await prisma.resolution.create({ data: { ...scope, agendaItemId: item.id, kind: a.kind, text: a.text } });
  }
  const staff = await prisma.user.findMany({ where: { email: { in: ['director@marinersventures.example', 'moderator@marinersventures.example'] } } });
  for (const u of staff) {
    await prisma.meetingStaff.create({ data: { ...scope, meetingId: meeting.id, userId: u.id, role: u.email!.startsWith('director') ? 'BOARD_MEMBER' : 'MODERATOR' } });
  }
  // Link the demo proxy lodged for this AGM.
  await prisma.proxyAuthorization.updateMany({
    where: { companyId: company.id, meetingId: null, meetingReference: { contains: '36th Annual General Meeting' } },
    data: { meetingId: meeting.id, meetingReference: meeting.title },
  });
  console.log(`[seed] Demo meeting for Mariners Ventures: ${AGENDA.length} agenda items, scheduled`);
}
