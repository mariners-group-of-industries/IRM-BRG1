import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  MEETING_DOCUMENT_KINDS,
  PERMISSIONS,
  agendaItemSchema,
  createMeetingSchema,
  meetingStaffSchema,
  transitionSchema,
  updateMeetingSchema,
  type MeetingStaffDto,
  type Permission,
} from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MIME, StorageService, sniffFileType } from '../storage/storage.service.js';
import { MeetingsService } from './meetings.service.js';

const MAX_DOC_BYTES = 25 * 1024 * 1024;
const documentMetaSchema = z.object({
  kind: z.enum(MEETING_DOCUMENT_KINDS),
  title: z.string().trim().min(2, 'At least 2 characters').max(200),
  agendaItemId: z.string().uuid().optional().or(z.literal('')),
});

@ApiTags('meetings')
@Controller('companies/:companyId/meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async scope(p: AuthPrincipal, companyId: string, perm: Permission, meta?: RequestMeta) {
    const c = await this.access.assertCompany(p, companyId, perm, meta);
    return { tenantId: c.tenantId, companyId: c.id };
  }

  @Get()
  async list(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string) {
    return this.meetings.list(await this.scope(p, companyId, PERMISSIONS.MEETING_READ));
  }

  @Post()
  async create(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const scope = await this.scope(p, companyId, PERMISSIONS.MEETING_CREATE, meta);
    return this.meetings.create(p, scope, parseBody(createMeetingSchema, body), meta);
  }

  @Get(':id')
  async get(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.meetings.get(await this.scope(p, companyId, PERMISSIONS.MEETING_READ), id);
  }

  @Patch(':id')
  async update(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const scope = await this.scope(p, companyId, PERMISSIONS.MEETING_UPDATE, meta);
    return this.meetings.update(p, scope, id, parseBody(updateMeetingSchema, body), meta);
  }

  @Put(':id/rules')
  async rules(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const scope = await this.scope(p, companyId, PERMISSIONS.MEETING_UPDATE, meta);
    return this.meetings.updateRules(p, scope, id, body, meta);
  }

  @Get(':id/control')
  async control(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.meetings.control(p, await this.scope(p, companyId, PERMISSIONS.MEETING_READ), id);
  }

  /** Permission depends on the transition; the service checks it against the transition table. */
  @Post(':id/transition')
  @HttpCode(200)
  async transition(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const scope = await this.scope(p, companyId, PERMISSIONS.MEETING_READ, meta);
    return this.meetings.transition(p, scope, id, parseBody(transitionSchema, body), meta);
  }

  // ─── Agenda ─────────────────────────────────────────────────────────

  @Get(':id/agenda')
  async agenda(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.meetings.agenda(await this.scope(p, companyId, PERMISSIONS.MEETING_READ), id);
  }

  @Post(':id/agenda')
  async addAgenda(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const scope = await this.scope(p, companyId, PERMISSIONS.AGENDA_MANAGE, meta);
    return this.meetings.saveAgendaItem(p, scope, id, null, parseBody(agendaItemSchema, body), meta);
  }

  @Patch(':id/agenda/:itemId')
  async editAgenda(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    const scope = await this.scope(p, companyId, PERMISSIONS.AGENDA_MANAGE, meta);
    return this.meetings.saveAgendaItem(p, scope, id, itemId, parseBody(agendaItemSchema, body), meta);
  }

  @Delete(':id/agenda/:itemId')
  async deleteAgenda(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Meta() meta: RequestMeta,
  ) {
    const scope = await this.scope(p, companyId, PERMISSIONS.AGENDA_MANAGE, meta);
    return this.meetings.deleteAgendaItem(p, scope, id, itemId, meta);
  }

  @Post(':id/agenda/order')
  @HttpCode(200)
  async reorder(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const scope = await this.scope(p, companyId, PERMISSIONS.AGENDA_MANAGE, meta);
    const { ids } = parseBody(z.object({ ids: z.array(z.string().uuid()).max(200) }), body);
    return this.meetings.reorderAgenda(p, scope, id, ids, meta);
  }

  // ─── Documents ──────────────────────────────────────────────────────

  @Get(':id/documents')
  async documents(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    const scope = await this.scope(p, companyId, PERMISSIONS.MEETING_READ);
    return this.prisma.scoped([companyId], async (tx) => {
      if (!(await tx.meeting.findFirst({ where: { id, companyId: scope.companyId } }))) throw new NotFoundException('Meeting not found');
      return this.meetings.documents(tx, id, false);
    });
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_DOC_BYTES, files: 1 } }))
  async upload(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Meta() meta: RequestMeta,
  ) {
    const scope = await this.scope(p, companyId, PERMISSIONS.DOCUMENT_MANAGE, meta);
    const input = parseBody(documentMetaSchema, body);
    if (!file) throw new BadRequestException('Attach a PDF in the "file" field');
    if (sniffFileType(file.buffer) !== 'pdf') throw new BadRequestException('Meeting documents must be PDF files');
    const stored = await this.storage.put(file.buffer, `meetings/${companyId}`);
    return this.prisma.scoped([companyId], async (tx) => {
      const m = await tx.meeting.findFirst({ where: { id, companyId } });
      if (!m) throw new NotFoundException('Meeting not found');
      if (m.state === 'ARCHIVED') throw new ConflictException('The meeting is archived');
      if (input.agendaItemId && !(await tx.agendaItem.findFirst({ where: { id: input.agendaItemId, meetingId: id } }))) throw new BadRequestException('Agenda item not found');
      const f = await tx.storedFile.create({
        data: {
          ...scope,
          kind: 'MEETING_DOCUMENT',
          storageKey: stored.key,
          originalName: file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 255) || 'document.pdf',
          mimeType: MIME.pdf!,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          uploadedById: p.userId,
        },
      });
      const doc = await tx.meetingDocument.create({ data: { ...scope, meetingId: id, kind: input.kind, title: input.title, fileId: f.id, agendaItemId: input.agendaItemId || null, uploadedById: p.userId } });
      await this.audit.record({ action: 'meeting_document.upload', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting_document', targetId: doc.id, metadata: { meetingId: id, kind: input.kind, sha256: stored.sha256 }, meta }, tx);
      return this.meetings.documents(tx, id, false);
    });
  }

  /** Publishing makes a document visible to participants; removal hides it but keeps the file for the record. */
  @Patch(':id/documents/:docId')
  async updateDocument(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    const scope = await this.scope(p, companyId, PERMISSIONS.DOCUMENT_MANAGE, meta);
    const input = parseBody(z.object({ published: z.boolean().optional(), removed: z.literal(true).optional() }), body);
    return this.prisma.scoped([companyId], async (tx) => {
      const doc = await tx.meetingDocument.findFirst({ where: { id: docId, meetingId: id, removedAt: null } });
      if (!doc) throw new NotFoundException('Document not found');
      await tx.meetingDocument.update({
        where: { id: docId },
        data: { ...(input.published !== undefined && { published: input.published }), ...(input.removed && { removedAt: new Date(), published: false }) },
      });
      const action = input.removed ? 'meeting_document.remove' : input.published ? 'meeting_document.publish' : 'meeting_document.unpublish';
      await this.audit.record({ action, outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting_document', targetId: docId, metadata: { meetingId: id }, meta }, tx);
      return this.meetings.documents(tx, id, false);
    });
  }

  @Get(':id/documents/:docId/download')
  async download(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    await this.scope(p, companyId, PERMISSIONS.MEETING_READ);
    const doc = await this.prisma.scoped([companyId], (tx) => tx.meetingDocument.findFirst({ where: { id: docId, meetingId: id, removedAt: null }, include: { file: true } }));
    if (!doc) throw new NotFoundException('Document not found');
    return sendFile(res, doc.file, await this.storage.get(doc.file.storageKey));
  }

  // ─── Staff ──────────────────────────────────────────────────────────

  @Get(':id/staff')
  async staff(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string): Promise<MeetingStaffDto> {
    await this.scope(p, companyId, PERMISSIONS.MEETING_READ);
    return this.staffDto(companyId, id);
  }

  @Put(':id/staff')
  async setStaff(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const scope = await this.scope(p, companyId, PERMISSIONS.MEETING_UPDATE, meta);
    const input = parseBody(meetingStaffSchema, body);
    const candidates = await this.candidates(companyId);
    const has = (userId: string, role: string) => candidates.find((c) => c.userId === userId)?.roles.includes(role);
    if (input.boardMemberIds.some((u) => !has(u, 'BOARD_MEMBER'))) throw new BadRequestException('Every board member must hold the Board Member role in this company');
    if (input.moderatorIds.some((u) => !has(u, 'MODERATOR'))) throw new BadRequestException('Every moderator must hold the Moderator role in this company');
    await this.prisma.scoped([companyId], async (tx) => {
      const m = await tx.meeting.findFirst({ where: { id, companyId } });
      if (!m) throw new NotFoundException('Meeting not found');
      if (m.state === 'COMPLETED' || m.state === 'ARCHIVED') throw new ConflictException('Staff cannot change after the meeting has ended');
      await tx.meetingStaff.deleteMany({ where: { meetingId: id } });
      await tx.meetingStaff.createMany({
        data: [
          ...[...new Set(input.boardMemberIds)].map((userId) => ({ ...scope, meetingId: id, userId, role: 'BOARD_MEMBER' as const })),
          ...[...new Set(input.moderatorIds)].map((userId) => ({ ...scope, meetingId: id, userId, role: 'MODERATOR' as const })),
        ],
      });
      await this.audit.record({ action: 'meeting.staff_update', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'meeting', targetId: id, metadata: { boardMembers: input.boardMemberIds.length, moderators: input.moderatorIds.length }, meta }, tx);
    });
    return this.staffDto(companyId, id);
  }

  /** Staff who hold the Board Member or Moderator role in this company. */
  private async candidates(companyId: string) {
    const rows = await this.prisma.userRoleAssignment.findMany({
      where: { companyId, revokedAt: null, role: { key: { in: ['BOARD_MEMBER', 'MODERATOR'] } }, user: { status: 'ACTIVE', kind: 'STAFF' } },
      include: { role: true, user: true },
    });
    const byUser = new Map<string, { userId: string; fullName: string; email: string | null; roles: string[] }>();
    for (const r of rows) {
      const e = byUser.get(r.userId) ?? { userId: r.userId, fullName: r.user.fullName, email: r.user.email, roles: [] };
      e.roles.push(r.role.key);
      byUser.set(r.userId, e);
    }
    return [...byUser.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  private async staffDto(companyId: string, meetingId: string): Promise<MeetingStaffDto> {
    const [candidates, assigned] = await Promise.all([
      this.candidates(companyId),
      this.prisma.scoped([companyId], async (tx) => {
        if (!(await tx.meeting.findFirst({ where: { id: meetingId, companyId } }))) throw new NotFoundException('Meeting not found');
        return tx.meetingStaff.findMany({ where: { meetingId } });
      }),
    ]);
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: assigned.map((a) => a.userId) } } })).map((u) => [u.id, u]));
    const pick = (role: string) =>
      assigned.filter((a) => a.role === role).map((a) => ({ userId: a.userId, fullName: users.get(a.userId)?.fullName ?? '', email: users.get(a.userId)?.email ?? null }));
    return { boardMembers: pick('BOARD_MEMBER'), moderators: pick('MODERATOR'), candidates };
  }

  // ─── Snapshot and registrations ─────────────────────────────────────

  @Get(':id/snapshot')
  async snapshot(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.meetings.snapshotSummary(await this.scope(p, companyId, PERMISSIONS.SHAREHOLDER_READ), id);
  }

  @Get(':id/entitlements')
  async entitlements(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
  ) {
    const scope = await this.scope(p, companyId, PERMISSIONS.SHAREHOLDER_READ);
    return this.meetings.entitlements(scope, id, q, page, this.access.can(p, PERMISSIONS.SHAREHOLDER_PII_READ, scope));
  }

  @Get(':id/participants')
  async participants(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.meetings.participants(await this.scope(p, companyId, PERMISSIONS.ATTENDANCE_READ), id);
  }
}

export function sendFile(res: Response, file: { mimeType: string; originalName: string }, buf: Buffer): StreamableFile {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.originalName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(buf);
}
