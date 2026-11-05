import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_MEETING_RULES,
  EDITABLE_STATES,
  MEETING_STATE_LABELS,
  RULES_EDITABLE_STATES,
  findTransition,
  hasPermission,
  maskIdentifier,
  meetingRulesSchema,
  transitionsFrom,
  type AgendaItemDto,
  type CreateMeetingInput,
  type EntitlementDto,
  type MeetingControl,
  type MeetingDetail,
  type MeetingDocumentDto,
  type MeetingParticipantDto,
  type MeetingState,
  type MeetingSummary,
  type Paginated,
  type ReadinessCheck,
  type SnapshotSummary,
  type UpdateMeetingInput,
} from '@irm/shared';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

type Tx = Prisma.TransactionClient;
export interface Scope {
  tenantId: string;
  companyId: string;
}
type MeetingRow = Prisma.MeetingGetPayload<object>;

const dhakaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Read ────────────────────────────────────────────────────────────

  async list(scope: Scope): Promise<MeetingSummary[]> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const rows = await tx.meeting.findMany({
        where: { companyId: scope.companyId },
        orderBy: { scheduledStart: 'desc' },
        include: { _count: { select: { agendaItems: true, participants: { where: { status: 'REGISTERED' } } } } },
      });
      return rows.map((m) => this.summary(m, m._count.agendaItems, m._count.participants));
    });
  }

  async get(scope: Scope, id: string): Promise<MeetingDetail> {
    return this.prisma.scoped([scope.companyId], async (tx) => this.detail(tx, await this.find(tx, scope, id)));
  }

  private async find(tx: Tx, scope: Scope, id: string): Promise<MeetingRow> {
    const m = await tx.meeting.findFirst({ where: { id, companyId: scope.companyId } });
    if (!m) throw new NotFoundException('Meeting not found');
    return m;
  }

  private async detail(tx: Tx, m: MeetingRow): Promise<MeetingDetail> {
    const [agendaCount, registrations] = await Promise.all([
      tx.agendaItem.count({ where: { meetingId: m.id } }),
      tx.meetingParticipant.count({ where: { meetingId: m.id, status: 'REGISTERED' } }),
    ]);
    return {
      ...this.summary(m, agendaCount, registrations),
      description: m.description,
      noticeText: m.noticeText,
      rules: meetingRulesSchema.parse(m.rules),
      snapshotTakenAt: m.snapshotTakenAt?.toISOString() ?? null,
      publishedAt: m.publishedAt?.toISOString() ?? null,
      startedAt: m.startedAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
    };
  }

  private summary(m: MeetingRow, agendaCount: number, registrations: number): MeetingSummary {
    return {
      id: m.id,
      companyId: m.companyId,
      type: m.type,
      title: m.title,
      state: m.state,
      scheduledStart: m.scheduledStart.toISOString(),
      timezone: m.timezone,
      recordDate: dateOnly(m.recordDate),
      mode: m.mode,
      venue: m.venue,
      agendaCount,
      registrations,
      version: m.version,
      createdAt: m.createdAt.toISOString(),
    };
  }

  // ─── Create and edit ────────────────────────────────────────────────

  async create(p: AuthPrincipal, scope: Scope, input: CreateMeetingInput & { timezone: string }, meta: RequestMeta): Promise<MeetingDetail> {
    if (new Date(input.scheduledStart) <= new Date()) throw new BadRequestException({ message: 'Validation failed', errors: { scheduledStart: ['Choose a time in the future'] } });
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const m = await tx.meeting.create({
        data: {
          ...scope,
          type: input.type,
          title: input.title,
          scheduledStart: new Date(input.scheduledStart),
          timezone: input.timezone,
          recordDate: new Date(`${input.recordDate}T00:00:00Z`),
          mode: input.mode ?? 'VIRTUAL',
          venue: input.venue || null,
          rules: DEFAULT_MEETING_RULES,
          createdById: p.userId,
        },
      });
      await tx.meetingStateTransition.create({ data: { ...scope, meetingId: m.id, fromState: null, toState: 'DRAFT', actorUserId: p.userId } });
      await this.audit.record({ action: 'meeting.create', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting', targetId: m.id, metadata: { type: m.type, title: m.title }, meta }, tx);
      return this.detail(tx, m);
    });
  }

  async update(p: AuthPrincipal, scope: Scope, id: string, input: UpdateMeetingInput, meta: RequestMeta): Promise<MeetingDetail> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const m = await this.find(tx, scope, id);
      if (!EDITABLE_STATES.includes(m.state)) throw new ConflictException(`A meeting that is ${MEETING_STATE_LABELS[m.state].toLowerCase()} can no longer be edited`);
      const start = input.scheduledStart ? new Date(input.scheduledStart) : m.scheduledStart;
      const record = input.recordDate ?? dateOnly(m.recordDate);
      if (input.scheduledStart && start <= new Date()) throw new BadRequestException({ message: 'Validation failed', errors: { scheduledStart: ['Choose a time in the future'] } });
      if (record > start.toISOString().slice(0, 10)) throw new BadRequestException({ message: 'Validation failed', errors: { recordDate: ['The record date must be on or before the meeting date'] } });
      const mode = input.mode ?? m.mode;
      const venue = input.venue !== undefined ? input.venue || null : m.venue;
      if (mode === 'HYBRID' && !venue) throw new BadRequestException({ message: 'Validation failed', errors: { venue: ['A hybrid meeting needs a venue'] } });

      const updated = await tx.meeting.update({
        where: { id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description || null }),
          ...(input.noticeText !== undefined && { noticeText: input.noticeText || null }),
          scheduledStart: start,
          recordDate: new Date(`${record}T00:00:00Z`),
          mode,
          venue,
          version: { increment: 1 },
        },
      });
      await this.audit.record({ action: 'meeting.update', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting', targetId: id, metadata: { fields: Object.keys(input) }, meta }, tx);
      return this.detail(tx, updated);
    });
  }

  async updateRules(p: AuthPrincipal, scope: Scope, id: string, body: unknown, meta: RequestMeta): Promise<MeetingDetail> {
    const parsed = meetingRulesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: { rules: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } });
    }
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const m = await this.find(tx, scope, id);
      if (!RULES_EDITABLE_STATES.includes(m.state)) throw new ConflictException('Governance rules are locked once the meeting has started');
      const before = meetingRulesSchema.parse(m.rules);
      const updated = await tx.meeting.update({ where: { id }, data: { rules: parsed.data, version: { increment: 1 } } });
      const changed = Object.keys(parsed.data).filter((k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(parsed.data[k as keyof typeof parsed.data]));
      // Rules are legally sensitive: record before and after values.
      await this.audit.record(
        {
          action: 'meeting.rules_update',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          ...scope,
          targetType: 'meeting',
          targetId: id,
          metadata: { changed, before: Object.fromEntries(changed.map((k) => [k, before[k as keyof typeof before]])), after: Object.fromEntries(changed.map((k) => [k, parsed.data[k as keyof typeof parsed.data]])) },
          meta,
        },
        tx,
      );
      return this.detail(tx, updated);
    });
  }

  // ─── State machine ──────────────────────────────────────────────────

  async control(p: AuthPrincipal, scope: Scope, id: string): Promise<MeetingControl> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const m = await this.find(tx, scope, id);
      const transitions = await Promise.all(
        transitionsFrom(m.state).map(async (t) => {
          const checks = await this.readiness(tx, m, t.to);
          const permitted = t.permissions.some((perm) => hasPermission(p.assignments, perm, scope));
          return {
            to: t.to,
            action: t.action,
            description: t.description,
            requiresReason: !!t.requiresReason,
            allowed: permitted && checks.every((c) => c.ok || !c.blocking),
            checks: permitted ? checks : [{ key: 'permission', label: 'You have permission for this action', ok: false, blocking: true }, ...checks],
          };
        }),
      );
      const history = await tx.meetingStateTransition.findMany({ where: { meetingId: id }, orderBy: { createdAt: 'desc' } });
      const actors = new Map(
        (await this.prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorUserId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
      );
      return {
        meeting: await this.detail(tx, m),
        transitions,
        history: history.map((h) => ({ id: h.id, from: h.fromState, to: h.toState, actor: h.actorUserId ? (actors.get(h.actorUserId) ?? null) : null, reason: h.reason, at: h.createdAt.toISOString() })),
      };
    });
  }

  /** Data-dependent guards for a transition. Blocking checks must pass; others are warnings. */
  private async readiness(tx: Tx, m: MeetingRow, to: MeetingState): Promise<ReadinessCheck[]> {
    const checks: ReadinessCheck[] = [];
    const today = dhakaToday();
    const record = dateOnly(m.recordDate);
    if (m.state === 'DRAFT' && to === 'SCHEDULED') {
      const [agenda, notices, board] = await Promise.all([
        tx.agendaItem.count({ where: { meetingId: m.id } }),
        tx.meetingDocument.count({ where: { meetingId: m.id, kind: 'NOTICE', published: true, removedAt: null } }),
        tx.meetingStaff.count({ where: { meetingId: m.id, role: 'BOARD_MEMBER' } }),
      ]);
      checks.push(
        { key: 'future', label: 'Meeting time is in the future', ok: m.scheduledStart > new Date(), blocking: true },
        { key: 'notice', label: 'Notice text is written', ok: (m.noticeText ?? '').trim().length >= 50, blocking: true, detail: 'At least 50 characters' },
        { key: 'agenda', label: 'At least one agenda item', ok: agenda > 0, blocking: true },
        { key: 'noticeDoc', label: 'Notice document is published', ok: notices > 0, blocking: false },
        { key: 'board', label: 'Board members are assigned', ok: board > 0, blocking: false },
      );
    }
    if (m.state === 'SCHEDULED' && to === 'REGISTRATION_OPEN') {
      const [eligible, lastImport, moderators] = await Promise.all([
        tx.shareholding.count({ where: { companyId: m.companyId, asOfDate: { lte: m.recordDate }, quantity: { gt: 0 } } }),
        tx.registerImport.findFirst({ where: { companyId: m.companyId, status: 'COMMITTED' }, orderBy: { asOfDate: 'desc' }, select: { asOfDate: true } }),
        tx.meetingStaff.count({ where: { meetingId: m.id, role: 'MODERATOR' } }),
      ]);
      const registerDate = lastImport?.asOfDate ? dateOnly(lastImport.asOfDate) : null;
      checks.push(
        { key: 'recordDate', label: 'Record date has passed', ok: record <= today, blocking: true, detail: `Record date ${record}` },
        { key: 'holders', label: 'Register has holdings on or before the record date', ok: eligible > 0, blocking: true },
        {
          key: 'registerCurrent',
          label: 'Register import covers the record date',
          ok: !!registerDate && registerDate >= record,
          blocking: false,
          detail: registerDate ? `Latest register is dated ${registerDate}` : 'No register has been imported',
        },
        { key: 'moderators', label: 'Moderators are assigned', ok: moderators > 0, blocking: false },
      );
    }
    if (m.state === 'REGISTRATION_OPEN' && to === 'LIVE') {
      const board = await tx.meetingStaff.count({ where: { meetingId: m.id, role: 'BOARD_MEMBER' } });
      const startsSoon = m.scheduledStart.getTime() - Date.now() <= 60 * 60_000;
      checks.push(
        { key: 'snapshot', label: 'Record-date snapshot exists', ok: !!m.snapshotTakenAt, blocking: true },
        { key: 'time', label: 'Within an hour of the scheduled start', ok: startsSoon, blocking: false },
        { key: 'board', label: 'Board members are assigned', ok: board > 0, blocking: false },
      );
    }
    return checks;
  }

  async transition(
    p: AuthPrincipal,
    scope: Scope,
    id: string,
    input: { to: MeetingState; reason?: string; expectedVersion: number },
    meta: RequestMeta,
  ): Promise<MeetingDetail> {
    return this.prisma.scoped(
      [scope.companyId],
      async (tx) => {
        const m = await this.find(tx, scope, id);
        const rule = findTransition(m.state, input.to);
        if (!rule) throw new ConflictException(`A meeting cannot go from ${MEETING_STATE_LABELS[m.state].toLowerCase()} to ${MEETING_STATE_LABELS[input.to].toLowerCase()}`);
        if (!rule.permissions.some((perm) => hasPermission(p.assignments, perm, scope))) {
          await this.audit.record({ action: 'access.denied', outcome: 'DENIED', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting', targetId: id, metadata: { transition: `${m.state}->${input.to}` }, meta }, tx);
          throw new ForbiddenException('You do not have permission to perform this action');
        }
        if (rule.requiresReason && !input.reason?.trim()) throw new BadRequestException({ message: 'Validation failed', errors: { reason: ['Give a reason'] } });
        const failed = (await this.readiness(tx, m, input.to)).filter((c) => c.blocking && !c.ok);
        if (failed.length) throw new ConflictException(`Not ready: ${failed.map((c) => c.label.toLowerCase()).join('; ')}`);

        const now = new Date();
        // Conditional update: only one of two concurrent transitions can win.
        const done = await tx.meeting.updateMany({
          where: { id, state: m.state, version: input.expectedVersion },
          data: {
            state: input.to,
            version: { increment: 1 },
            ...(input.to === 'SCHEDULED' && !m.publishedAt && { publishedAt: now }),
            ...(input.to === 'LIVE' && !m.startedAt && { startedAt: now }),
            ...(input.to === 'COMPLETED' && { endedAt: now }),
          },
        });
        if (done.count !== 1) throw new ConflictException('This meeting was changed by someone else. Reload and try again.');

        let snapshot: { holders: number; entitlements: number } | null = null;
        if (input.to === 'REGISTRATION_OPEN' && !m.snapshotTakenAt) {
          snapshot = await this.takeSnapshot(tx, scope, m);
          await tx.meeting.update({ where: { id }, data: { snapshotTakenAt: now } });
        }
        await tx.meetingStateTransition.create({ data: { ...scope, meetingId: id, fromState: m.state, toState: input.to, actorUserId: p.userId, reason: input.reason?.trim() || null } });
        await this.audit.record(
          { action: 'meeting.transition', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting', targetId: id, metadata: { from: m.state, to: input.to, reason: input.reason ?? null, ...(snapshot ?? {}) }, meta },
          tx,
        );
        return this.detail(tx, await tx.meeting.findUniqueOrThrow({ where: { id } }));
      },
      { timeoutMs: 120_000 },
    );
  }

  /**
   * Freezes holdings at the record date. For each account and share class, the holding
   * row with the latest register date on or before the record date is used; rows with
   * zero shares are skipped. Entitlements are created for classes that carry votes.
   */
  private async takeSnapshot(tx: Tx, scope: Scope, m: MeetingRow): Promise<{ holders: number; entitlements: number }> {
    await tx.$executeRaw`
      INSERT INTO shareholding_snapshots (id, tenant_id, company_id, meeting_id, shareholder_id, identity_id, share_class_id, holding_id, quantity, votes_per_share)
      SELECT gen_random_uuid(), ${scope.tenantId}::uuid, ${scope.companyId}::uuid, ${m.id}::uuid, si.shareholder_id, h.identity_id, h.share_class_id, h.id, h.quantity, sc.votes_per_share
      FROM (
        SELECT DISTINCT ON (identity_id, share_class_id) id, identity_id, share_class_id, quantity
        FROM shareholdings
        WHERE company_id = ${scope.companyId}::uuid AND as_of_date <= ${m.recordDate}::date
        ORDER BY identity_id, share_class_id, as_of_date DESC, valid_from DESC
      ) h
      JOIN shareholder_identities si ON si.id = h.identity_id
      JOIN shareholders s ON s.id = si.shareholder_id AND s.status = 'ACTIVE'
      JOIN share_classes sc ON sc.id = h.share_class_id
      WHERE h.quantity > 0`;
    const entitlements = await tx.$executeRaw`
      INSERT INTO voting_entitlements (id, tenant_id, company_id, meeting_id, snapshot_id, shareholder_id, identity_id, weight)
      SELECT gen_random_uuid(), tenant_id, company_id, meeting_id, id, shareholder_id, identity_id, quantity * votes_per_share
      FROM shareholding_snapshots WHERE meeting_id = ${m.id}::uuid AND votes_per_share > 0`;
    const holders = await tx.shareholdingSnapshot.groupBy({ by: ['shareholderId'], where: { meetingId: m.id } });
    return { holders: holders.length, entitlements };
  }

  // ─── Agenda ─────────────────────────────────────────────────────────

  async agenda(scope: Scope, meetingId: string): Promise<AgendaItemDto[]> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      await this.find(tx, scope, meetingId);
      return this.agendaRows(tx, meetingId);
    });
  }

  async agendaRows(tx: Tx, meetingId: string): Promise<AgendaItemDto[]> {
    const rows = await tx.agendaItem.findMany({ where: { meetingId }, include: { resolution: true }, orderBy: { position: 'asc' } });
    return rows.map((a) => ({
      id: a.id,
      number: a.number,
      title: a.title,
      description: a.description,
      position: a.position,
      resolution: a.resolution
        ? { kind: a.resolution.kind, text: a.resolution.text, requiresProposal: a.resolution.requiresProposal, requiresSeconding: a.resolution.requiresSeconding }
        : null,
    }));
  }

  private async editable(tx: Tx, scope: Scope, meetingId: string): Promise<MeetingRow> {
    const m = await this.find(tx, scope, meetingId);
    if (!EDITABLE_STATES.includes(m.state)) throw new ConflictException('The agenda is locked once registration has opened');
    return m;
  }

  async saveAgendaItem(
    p: AuthPrincipal,
    scope: Scope,
    meetingId: string,
    itemId: string | null,
    input: { number: string; title: string; description?: string; hasResolution: boolean; resolutionKind: 'ORDINARY' | 'SPECIAL'; resolutionText?: string; requiresProposal: boolean; requiresSeconding: boolean },
    meta: RequestMeta,
  ): Promise<AgendaItemDto[]> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      await this.editable(tx, scope, meetingId);
      const dup = await tx.agendaItem.findFirst({ where: { meetingId, number: input.number, ...(itemId ? { NOT: { id: itemId } } : {}) } });
      if (dup) throw new BadRequestException({ message: 'Validation failed', errors: { number: ['Another item already uses this number'] } });
      let id = itemId;
      if (itemId) {
        const existing = await tx.agendaItem.findFirst({ where: { id: itemId, meetingId } });
        if (!existing) throw new NotFoundException('Agenda item not found');
        await tx.agendaItem.update({ where: { id: itemId }, data: { number: input.number, title: input.title, description: input.description || null } });
      } else {
        const max = await tx.agendaItem.aggregate({ where: { meetingId }, _max: { position: true } });
        id = (await tx.agendaItem.create({ data: { ...scope, meetingId, number: input.number, title: input.title, description: input.description || null, position: (max._max.position ?? 0) + 1 } })).id;
      }
      if (input.hasResolution) {
        const data = { kind: input.resolutionKind, text: input.resolutionText!, requiresProposal: input.requiresProposal, requiresSeconding: input.requiresSeconding };
        await tx.resolution.upsert({ where: { agendaItemId: id! }, create: { ...scope, agendaItemId: id!, ...data }, update: data });
      } else {
        await tx.resolution.deleteMany({ where: { agendaItemId: id! } });
      }
      await tx.meeting.update({ where: { id: meetingId }, data: { version: { increment: 1 } } });
      await this.audit.record({ action: itemId ? 'agenda.update' : 'agenda.create', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'agenda_item', targetId: id, metadata: { meetingId, number: input.number, resolution: input.hasResolution ? input.resolutionKind : null }, meta }, tx);
      return this.agendaRows(tx, meetingId);
    });
  }

  async deleteAgendaItem(p: AuthPrincipal, scope: Scope, meetingId: string, itemId: string, meta: RequestMeta): Promise<AgendaItemDto[]> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      await this.editable(tx, scope, meetingId);
      const item = await tx.agendaItem.findFirst({ where: { id: itemId, meetingId } });
      if (!item) throw new NotFoundException('Agenda item not found');
      await tx.meetingDocument.updateMany({ where: { agendaItemId: itemId }, data: { agendaItemId: null } });
      await tx.resolution.deleteMany({ where: { agendaItemId: itemId } });
      await tx.agendaItem.delete({ where: { id: itemId } });
      await this.renumberPositions(tx, meetingId, (await tx.agendaItem.findMany({ where: { meetingId }, orderBy: { position: 'asc' } })).map((a) => a.id));
      await this.audit.record({ action: 'agenda.delete', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'agenda_item', targetId: itemId, metadata: { meetingId, number: item.number }, meta }, tx);
      return this.agendaRows(tx, meetingId);
    });
  }

  async reorderAgenda(p: AuthPrincipal, scope: Scope, meetingId: string, ids: string[], meta: RequestMeta): Promise<AgendaItemDto[]> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      await this.editable(tx, scope, meetingId);
      const current = await tx.agendaItem.findMany({ where: { meetingId }, select: { id: true } });
      const set = new Set(current.map((c) => c.id));
      if (ids.length !== set.size || ids.some((id) => !set.has(id))) throw new BadRequestException('Send every agenda item exactly once');
      await this.renumberPositions(tx, meetingId, ids);
      await this.audit.record({ action: 'agenda.reorder', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting', targetId: meetingId, meta }, tx);
      return this.agendaRows(tx, meetingId);
    });
  }

  private async renumberPositions(tx: Tx, meetingId: string, ids: string[]) {
    for (const [i, id] of ids.entries()) await tx.agendaItem.update({ where: { id }, data: { position: i + 1 } });
    await tx.meeting.update({ where: { id: meetingId }, data: { version: { increment: 1 } } });
  }

  // ─── Documents ──────────────────────────────────────────────────────

  async documents(tx: Tx, meetingId: string, onlyPublished: boolean): Promise<MeetingDocumentDto[]> {
    const rows = await tx.meetingDocument.findMany({
      where: { meetingId, removedAt: null, ...(onlyPublished ? { published: true } : {}) },
      include: { file: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      fileName: d.file.originalName,
      sizeBytes: d.file.sizeBytes,
      published: d.published,
      agendaItemId: d.agendaItemId,
      uploadedAt: d.createdAt.toISOString(),
    }));
  }

  // ─── Snapshot, entitlements and registrations ───────────────────────

  async snapshotSummary(scope: Scope, meetingId: string): Promise<SnapshotSummary> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const m = await this.find(tx, scope, meetingId);
      const lastImport = await tx.registerImport.findFirst({ where: { companyId: scope.companyId, status: 'COMMITTED' }, orderBy: { asOfDate: 'desc' }, select: { asOfDate: true } });
      const rows = await tx.$queryRaw<{ code: string; votes_per_share: number; shares: bigint; votes: bigint; holders: bigint; accounts: bigint }[]>`
        SELECT sc.code, s.votes_per_share, sum(s.quantity)::bigint AS shares, sum(s.quantity * s.votes_per_share)::bigint AS votes,
               count(DISTINCT s.shareholder_id)::bigint AS holders, count(DISTINCT s.identity_id)::bigint AS accounts
        FROM shareholding_snapshots s JOIN share_classes sc ON sc.id = s.share_class_id
        WHERE s.meeting_id = ${meetingId}::uuid GROUP BY sc.code, s.votes_per_share ORDER BY sc.code`;
      const totals = await tx.$queryRaw<{ holders: bigint; accounts: bigint }[]>`
        SELECT count(DISTINCT shareholder_id)::bigint AS holders, count(DISTINCT identity_id)::bigint AS accounts FROM shareholding_snapshots WHERE meeting_id = ${meetingId}::uuid`;
      return {
        takenAt: m.snapshotTakenAt?.toISOString() ?? null,
        recordDate: dateOnly(m.recordDate),
        holders: Number(totals[0]?.holders ?? 0),
        accounts: Number(totals[0]?.accounts ?? 0),
        totalShares: rows.reduce((s, r) => s + r.shares, 0n).toString(),
        totalVotes: rows.reduce((s, r) => s + r.votes, 0n).toString(),
        byClass: rows.map((r) => ({ code: r.code, votesPerShare: r.votes_per_share, shares: r.shares.toString(), votes: r.votes.toString() })),
        registerAsOf: lastImport?.asOfDate ? dateOnly(lastImport.asOfDate) : null,
      };
    });
  }

  async entitlements(scope: Scope, meetingId: string, q: string | undefined, pageRaw: string | undefined, pii: boolean): Promise<Paginated<EntitlementDto>> {
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = 50;
    return this.prisma.scoped([scope.companyId], async (tx) => {
      await this.find(tx, scope, meetingId);
      const where: Prisma.ShareholdingSnapshotWhereInput = { meetingId, ...(q?.trim() ? { shareholderId: { in: (await tx.shareholder.findMany({ where: { companyId: scope.companyId, name: { contains: q.trim(), mode: 'insensitive' } }, select: { id: true } })).map((s) => s.id) } } : {}) };
      const [total, rows, registered] = await Promise.all([
        tx.shareholdingSnapshot.count({ where }),
        tx.shareholdingSnapshot.findMany({ where, orderBy: [{ quantity: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { entitlement: true } }),
        tx.meetingParticipant.findMany({ where: { meetingId, status: 'REGISTERED' }, select: { entitlementIds: true } }),
      ]);
      const regSet = new Set(registered.flatMap((r) => r.entitlementIds));
      const [holders, identities, classes] = await Promise.all([
        tx.shareholder.findMany({ where: { id: { in: rows.map((r) => r.shareholderId) } }, select: { id: true, name: true } }),
        tx.shareholderIdentity.findMany({ where: { id: { in: rows.map((r) => r.identityId) } }, select: { id: true, kind: true, value: true } }),
        tx.shareClass.findMany({ where: { companyId: scope.companyId }, select: { id: true, code: true } }),
      ]);
      const hn = new Map(holders.map((h) => [h.id, h.name]));
      const idn = new Map(identities.map((i) => [i.id, `${i.kind === 'BO' ? 'BO' : 'Folio'} ${pii ? i.value : maskIdentifier(i.value)}`]));
      const cn = new Map(classes.map((c) => [c.id, c.code]));
      return {
        items: rows.map((r) => ({
          id: r.id,
          shareholderName: hn.get(r.shareholderId) ?? '',
          account: idn.get(r.identityId) ?? '',
          shareClass: cn.get(r.shareClassId) ?? '',
          shares: r.quantity.toString(),
          votes: r.entitlement?.weight.toString() ?? '0',
          registered: !!r.entitlement && regSet.has(r.entitlement.id),
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  async participants(scope: Scope, meetingId: string): Promise<MeetingParticipantDto[]> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      await this.find(tx, scope, meetingId);
      const rows = await tx.meetingParticipant.findMany({ where: { meetingId, status: 'REGISTERED' }, orderBy: { registeredAt: 'desc' } });
      const holders = new Map((await tx.shareholder.findMany({ where: { id: { in: rows.map((r) => r.shareholderId) } }, select: { id: true, name: true } })).map((h) => [h.id, h.name]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const ents = await tx.votingEntitlement.findMany({ where: { id: { in: rows.flatMap((r) => r.entitlementIds) } }, select: { id: true, weight: true } });
      const w = new Map(ents.map((e) => [e.id, e.weight]));
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        participantName: users.get(r.userId) ?? '',
        representing: holders.get(r.shareholderId) ?? '',
        votes: r.entitlementIds.reduce((s, id) => s + (w.get(id) ?? 0n), 0n).toString(),
        registeredAt: r.registeredAt.toISOString(),
      }));
    });
  }
}
