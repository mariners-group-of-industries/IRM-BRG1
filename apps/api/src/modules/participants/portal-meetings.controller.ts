import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { PUBLISHED_STATES, REGISTRATION_STATES, meetingRulesSchema, type MeetingState, type PortalMeeting } from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { MeetingsService } from '../meetings/meetings.service.js';
import { sendFile } from '../meetings/meetings.controller.js';
import { isEffective } from '../register/authorization-rules.js';
import { StorageService } from '../storage/storage.service.js';

type Tx = Prisma.TransactionClient;

interface Option {
  key: string;
  kind: 'SHAREHOLDER' | 'CORPORATE_REPRESENTATIVE' | 'PROXY_REPRESENTATIVE';
  label: string;
  shareholderId: string;
  shareholderName: string;
  corporateRepId: string | null;
  proxyId: string | null;
  entitlementIds: string[];
  votes: bigint;
  eligible: boolean;
  reason: string | null;
}

/** Meetings as seen by shareholders, corporate representatives and proxies. */
@ApiTags('participants')
@Controller('participant/meetings')
export class PortalMeetingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async companies(p: AuthPrincipal): Promise<string[]> {
    if (p.kind !== 'PARTICIPANT') throw new ForbiddenException('This area is for shareholders and their representatives');
    const links = await this.prisma.participantLink.findMany({ where: { userId: p.userId }, select: { companyId: true }, distinct: ['companyId'] });
    return links.map((l) => l.companyId);
  }

  @Get()
  async list(@Principal() p: AuthPrincipal): Promise<PortalMeeting[]> {
    const companyIds = await this.companies(p);
    if (companyIds.length === 0) return [];
    return this.prisma.scoped(companyIds, async (tx) => {
      const rows = await tx.meeting.findMany({
        where: { companyId: { in: companyIds }, state: { in: [...PUBLISHED_STATES] } },
        orderBy: { scheduledStart: 'asc' },
      });
      return Promise.all(rows.map((m) => this.view(tx, p, m)));
    });
  }

  @Get(':id')
  async get(@Principal() p: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string): Promise<PortalMeeting> {
    const companyIds = await this.companies(p);
    if (companyIds.length === 0) throw new NotFoundException('Meeting not found');
    return this.prisma.scoped(companyIds, async (tx) => this.view(tx, p, await this.visible(tx, companyIds, id)));
  }

  private async visible(tx: Tx, companyIds: string[], id: string) {
    const m = await tx.meeting.findFirst({ where: { id, companyId: { in: companyIds }, state: { in: [...PUBLISHED_STATES] } } });
    if (!m) throw new NotFoundException('Meeting not found');
    return m;
  }

  @Post(':id/register')
  @HttpCode(200)
  async register(@Principal() p: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta): Promise<PortalMeeting> {
    const { key } = parseBody(z.object({ key: z.string().min(1).max(200) }), body);
    const companyIds = await this.companies(p);
    if (companyIds.length === 0) throw new NotFoundException('Meeting not found');
    return this.prisma.scoped(companyIds, async (tx) => {
      const m = await this.visible(tx, companyIds, id);
      if (!REGISTRATION_STATES.includes(m.state as MeetingState)) throw new ConflictException('Registration is not open for this meeting');
      const option = (await this.options(tx, p.userId, m)).find((o) => o.key === key);
      if (!option) throw new NotFoundException('Nothing to register for');
      if (!option.eligible) throw new BadRequestException(option.reason ?? 'Not eligible');
      const existing = await tx.meetingParticipant.findFirst({ where: { meetingId: id, userId: p.userId, kind: option.kind, shareholderId: option.shareholderId } });
      if (existing?.status === 'REGISTERED') return this.view(tx, p, m);
      if (existing) {
        await tx.meetingParticipant.update({ where: { id: existing.id }, data: { status: 'REGISTERED', entitlementIds: option.entitlementIds, registeredAt: new Date() } });
      } else {
        await tx.meetingParticipant.create({
          data: {
            tenantId: m.tenantId,
            companyId: m.companyId,
            meetingId: id,
            userId: p.userId,
            kind: option.kind,
            shareholderId: option.shareholderId,
            corporateRepId: option.corporateRepId,
            proxyId: option.proxyId,
            entitlementIds: option.entitlementIds,
          },
        });
      }
      await this.audit.record(
        { action: 'meeting.register', outcome: 'SUCCESS', actorUserId: p.userId, tenantId: m.tenantId, companyId: m.companyId, targetType: 'meeting', targetId: id, metadata: { kind: option.kind, entitlements: option.entitlementIds.length, votes: option.votes.toString() }, meta },
        tx,
      );
      return this.view(tx, p, m);
    });
  }

  @Get(':id/documents/:docId')
  async document(@Principal() p: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Param('docId', new ParseUUIDPipe()) docId: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const companyIds = await this.companies(p);
    if (companyIds.length === 0) throw new NotFoundException('Document not found');
    const doc = await this.prisma.scoped(companyIds, async (tx) => {
      await this.visible(tx, companyIds, id);
      return tx.meetingDocument.findFirst({ where: { id: docId, meetingId: id, published: true, removedAt: null }, include: { file: true } });
    });
    if (!doc) throw new NotFoundException('Document not found');
    return sendFile(res, doc.file, await this.storage.get(doc.file.storageKey));
  }

  private async view(tx: Tx, p: AuthPrincipal, m: Prisma.MeetingGetPayload<object>): Promise<PortalMeeting> {
    const [company, agenda, documents, options, registrations] = await Promise.all([
      tx.company.findUniqueOrThrow({ where: { id: m.companyId }, select: { shortName: true } }),
      this.meetings.agendaRows(tx, m.id),
      this.meetings.documents(tx, m.id, true),
      this.options(tx, p.userId, m),
      tx.meetingParticipant.findMany({ where: { meetingId: m.id, userId: p.userId, status: 'REGISTERED' } }),
    ]);
    return {
      id: m.id,
      companyId: m.companyId,
      companyName: company.shortName,
      type: m.type,
      title: m.title,
      state: m.state,
      scheduledStart: m.scheduledStart.toISOString(),
      timezone: m.timezone,
      recordDate: m.recordDate.toISOString().slice(0, 10),
      mode: m.mode,
      venue: m.venue,
      noticeText: m.noticeText,
      agenda,
      documents,
      registrationOpen: REGISTRATION_STATES.includes(m.state as MeetingState),
      eligibility: options.map((o) => ({
        key: o.key,
        kind: o.kind,
        label: o.label,
        shareholderName: o.shareholderName,
        votes: o.votes.toString(),
        eligible: o.eligible,
        reason: o.reason,
        registered: registrations.some((r) => r.kind === o.kind && r.shareholderId === o.shareholderId),
      })),
    };
  }

  /**
   * What this person could register for at this meeting, with the entitlements each option
   * covers. Entitlements only exist once the record-date snapshot has been taken.
   */
  private async options(tx: Tx, userId: string, m: Prisma.MeetingGetPayload<object>): Promise<Option[]> {
    const rules = meetingRulesSchema.parse(m.rules);
    const links = await tx.participantLink.findMany({ where: { userId, companyId: m.companyId } });
    const snapshotTaken = !!m.snapshotTakenAt;
    const out: Option[] = [];

    const entitlementsFor = async (shareholderId: string, identityIds?: string[]) =>
      tx.votingEntitlement.findMany({ where: { meetingId: m.id, shareholderId, ...(identityIds ? { identityId: { in: identityIds } } : {}) }, select: { id: true, weight: true } });
    const noHolding = 'Not a holder on the record date';

    for (const l of links) {
      if (l.kind === 'SHAREHOLDER' && l.shareholderId) {
        const s = await tx.shareholder.findUnique({ where: { id: l.shareholderId } });
        if (!s) continue;
        const ents = snapshotTaken ? await entitlementsFor(s.id) : [];
        out.push({
          key: `SHAREHOLDER:${s.id}`, kind: 'SHAREHOLDER', label: 'As shareholder', shareholderId: s.id, shareholderName: s.name, corporateRepId: null, proxyId: null,
          entitlementIds: ents.map((e) => e.id), votes: ents.reduce((a, e) => a + e.weight, 0n),
          eligible: snapshotTaken && ents.length > 0, reason: !snapshotTaken ? 'Registration has not opened' : ents.length === 0 ? noHolding : null,
        });
      } else if (l.corporateRepId) {
        const r = await tx.corporateRepresentative.findUnique({ where: { id: l.corporateRepId }, include: { shareholder: true } });
        if (!r) continue;
        const effective = isEffective(r);
        const ents = snapshotTaken && effective ? await entitlementsFor(r.shareholderId, r.identityIds) : [];
        out.push({
          key: `REP:${r.id}`, kind: 'CORPORATE_REPRESENTATIVE', label: 'As corporate representative', shareholderId: r.shareholderId, shareholderName: r.shareholder.name, corporateRepId: r.id, proxyId: null,
          entitlementIds: ents.map((e) => e.id), votes: ents.reduce((a, e) => a + e.weight, 0n),
          eligible: snapshotTaken && effective && ents.length > 0,
          reason: !effective ? 'Your authorization is not active' : !snapshotTaken ? 'Registration has not opened' : ents.length === 0 ? noHolding : null,
        });
      } else if (l.proxyId) {
        const r = await tx.proxyAuthorization.findUnique({ where: { id: l.proxyId }, include: { grantor: true } });
        if (!r) continue;
        const forThisMeeting = r.meetingId === m.id;
        if (!forThisMeeting) continue; // A proxy only ever applies to the meeting it was lodged for.
        const effective = isEffective(r);
        const ents = snapshotTaken && effective && rules.proxy.allowed ? await entitlementsFor(r.grantorShareholderId) : [];
        out.push({
          key: `PROXY:${r.id}`, kind: 'PROXY_REPRESENTATIVE', label: r.scope === 'ATTEND_AND_VOTE' ? 'As proxy (attend and vote)' : 'As proxy (attend only)', shareholderId: r.grantorShareholderId, shareholderName: r.grantor.name, corporateRepId: null, proxyId: r.id,
          entitlementIds: ents.map((e) => e.id), votes: ents.reduce((a, e) => a + e.weight, 0n),
          eligible: rules.proxy.allowed && effective && snapshotTaken && ents.length > 0,
          reason: !rules.proxy.allowed ? 'This meeting does not accept proxies' : !effective ? 'The proxy is not active' : !snapshotTaken ? 'Registration has not opened' : ents.length === 0 ? noHolding : null,
        });
      }
    }
    return out;
  }
}
