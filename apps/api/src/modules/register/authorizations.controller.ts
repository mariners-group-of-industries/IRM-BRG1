import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
  PERMISSIONS,
  corporateRepSchema,
  normalizeBdPhone,
  proxySchema,
  type CorporateRepDto,
  type ProxyDto,
} from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MIME, StorageService, sniffFileType } from '../storage/storage.service.js';
import { ParticipantAccessService } from '../participants/participant-access.service.js';
import { isEffective } from './authorization-rules.js';
import { dateOnly, toIdentityDto } from './register.mappers.js';

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'REVOKE']),
  note: z.string().trim().max(500).optional(),
});

const MAX_DOC_BYTES = 10 * 1024 * 1024;


type Kind = 'corporate-representatives' | 'proxies';

@ApiTags('authorizations')
@Controller('companies/:companyId')
export class AuthorizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly participants: ParticipantAccessService,
  ) {}

  private async scope(p: AuthPrincipal, companyId: string, perm: 'shareholder.read' | 'authorization.manage', meta?: RequestMeta) {
    const c = await this.access.assertCompany(p, companyId, perm, meta);
    return { tenantId: c.tenantId, companyId: c.id, pii: this.access.can(p, PERMISSIONS.SHAREHOLDER_PII_READ, { tenantId: c.tenantId, companyId: c.id }) };
  }

  // ─── Corporate representatives ──────────────────────────────────────

  @Get('corporate-representatives')
  async listReps(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string): Promise<CorporateRepDto[]> {
    const s = await this.scope(p, companyId, PERMISSIONS.SHAREHOLDER_READ);
    return this.prisma.scoped([companyId], async (tx) => {
      const rows = await tx.corporateRepresentative.findMany({
        where: { companyId },
        include: { shareholder: { include: { identities: true } }, document: true },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => this.repDto(r, s.pii));
    });
  }

  @Post('corporate-representatives')
  @UseInterceptors(FileInterceptor('document', { storage: memoryStorage(), limits: { fileSize: MAX_DOC_BYTES, files: 1 } }))
  async createRep(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Meta() meta: RequestMeta,
  ): Promise<CorporateRepDto> {
    const s = await this.scope(p, companyId, PERMISSIONS.AUTHORIZATION_MANAGE, meta);
    const input = parseBody(corporateRepSchema, { ...body, identityIds: toArray(body.identityIds) });
    const doc = file ? await this.storeDocument(file, companyId) : null;
    return this.prisma.scoped([companyId], async (tx) => {
      const holder = await tx.shareholder.findFirst({ where: { id: input.shareholderId, companyId }, include: { identities: true } });
      if (!holder) throw new NotFoundException('Shareholder not found');
      if (holder.type !== 'CORPORATE') throw new BadRequestException('Corporate representatives can only act for corporate shareholders');
      const owned = new Set(holder.identities.map((i) => i.id));
      if (input.identityIds.some((id) => !owned.has(id))) throw new BadRequestException('Every selected account must belong to this shareholder');
      const documentId = doc ? (await tx.storedFile.create({ data: { tenantId: s.tenantId, companyId, kind: 'AUTHORIZATION_DOCUMENT', uploadedById: p.userId, ...doc } })).id : null;
      const rep = await tx.corporateRepresentative.create({
        data: {
          tenantId: s.tenantId,
          companyId,
          shareholderId: holder.id,
          fullName: input.fullName,
          designation: input.designation || null,
          email: input.email,
          phone: input.phone ? normalizeBdPhone(input.phone) : null,
          identityIds: input.identityIds,
          validFrom: new Date(`${input.validFrom}T00:00:00Z`),
          validUntil: new Date(`${input.validUntil}T00:00:00Z`),
          documentId,
          createdById: p.userId,
        },
        include: { shareholder: { include: { identities: true } }, document: true },
      });
      await this.audit.record(
        { action: 'corporate_rep.create', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, tenantId: s.tenantId, companyId, targetType: 'corporate_representative', targetId: rep.id, metadata: { shareholderId: holder.id, accounts: input.identityIds.length, hasDocument: !!documentId }, meta },
        tx,
      );
      return this.repDto(rep, s.pii);
    });
  }

  // ─── Proxies ────────────────────────────────────────────────────────

  @Get('proxies')
  async listProxies(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string): Promise<ProxyDto[]> {
    await this.scope(p, companyId, PERMISSIONS.SHAREHOLDER_READ);
    return this.prisma.scoped([companyId], async (tx) => {
      const rows = await tx.proxyAuthorization.findMany({ where: { companyId }, include: { grantor: true, document: true }, orderBy: { createdAt: 'desc' } });
      return rows.map((r) => this.proxyDto(r));
    });
  }

  @Post('proxies')
  @UseInterceptors(FileInterceptor('document', { storage: memoryStorage(), limits: { fileSize: MAX_DOC_BYTES, files: 1 } }))
  async createProxy(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Meta() meta: RequestMeta,
  ): Promise<ProxyDto> {
    const s = await this.scope(p, companyId, PERMISSIONS.AUTHORIZATION_MANAGE, meta);
    const input = parseBody(proxySchema, body);
    const doc = file ? await this.storeDocument(file, companyId) : null;
    return this.prisma.scoped([companyId], async (tx) => {
      const grantor = await tx.shareholder.findFirst({ where: { id: input.grantorShareholderId, companyId } });
      if (!grantor) throw new NotFoundException('Shareholder not found');
      const documentId = doc ? (await tx.storedFile.create({ data: { tenantId: s.tenantId, companyId, kind: 'AUTHORIZATION_DOCUMENT', uploadedById: p.userId, ...doc } })).id : null;
      const proxy = await tx.proxyAuthorization.create({
        data: {
          tenantId: s.tenantId,
          companyId,
          grantorShareholderId: grantor.id,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone ? normalizeBdPhone(input.phone) : null,
          scope: input.scope,
          meetingReference: input.meetingReference,
          validFrom: new Date(`${input.validFrom}T00:00:00Z`),
          validUntil: new Date(`${input.validUntil}T00:00:00Z`),
          documentId,
          createdById: p.userId,
        },
        include: { grantor: true, document: true },
      });
      await this.audit.record(
        { action: 'proxy.create', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, tenantId: s.tenantId, companyId, targetType: 'proxy_authorization', targetId: proxy.id, metadata: { grantorShareholderId: grantor.id, scope: input.scope, hasDocument: !!documentId }, meta },
        tx,
      );
      return this.proxyDto(proxy);
    });
  }

  // ─── Decisions and documents (both kinds) ───────────────────────────

  /**
   * APPROVE and REJECT apply to PENDING records. REVOKE applies to APPROVED records and
   * immediately removes the participant role and ends that person's sessions.
   * The approver must not be the person who created the record (four-eyes rule).
   */
  @Post(':kind/:id/decision')
  @HttpCode(200)
  async decide(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    const k = assertKind(kind);
    const s = await this.scope(p, companyId, PERMISSIONS.AUTHORIZATION_MANAGE, meta);
    const input = parseBody(decisionSchema, body);
    const result = await this.prisma.scoped([companyId], async (tx) => {
      const model = (k === 'proxies' ? tx.proxyAuthorization : tx.corporateRepresentative) as unknown as {
        findFirst: (a: object) => Promise<{ id: string; status: string; createdById: string } | null>;
        updateMany: (a: object) => Promise<{ count: number }>;
      };
      const rec = await model.findFirst({ where: { id, companyId } });
      if (!rec) throw new NotFoundException('Authorization not found');
      const from = input.decision === 'REVOKE' ? 'APPROVED' : 'PENDING';
      if (rec.status !== from) throw new ConflictException(`Only ${from.toLowerCase()} authorizations can be ${input.decision === 'APPROVE' ? 'approved' : input.decision === 'REJECT' ? 'rejected' : 'revoked'}`);
      if (input.decision === 'APPROVE' && rec.createdById === p.userId) {
        throw new ConflictException('Another administrator must approve an authorization you created');
      }
      const status = input.decision === 'APPROVE' ? 'APPROVED' : input.decision === 'REJECT' ? 'REJECTED' : 'REVOKED';
      // Conditional update guards against two administrators deciding at the same time.
      const updated = await model.updateMany({
        where: { id, status: from },
        data: { status, decidedById: p.userId, decidedAt: new Date(), decisionNote: input.note || null },
      });
      if (updated.count !== 1) throw new ConflictException('This authorization was changed by someone else. Reload and try again.');
      await this.audit.record(
        { action: `${k === 'proxies' ? 'proxy' : 'corporate_rep'}.${input.decision.toLowerCase()}`, outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, tenantId: s.tenantId, companyId, targetType: k === 'proxies' ? 'proxy_authorization' : 'corporate_representative', targetId: id, metadata: { note: input.note ?? null }, meta },
        tx,
      );
      return status;
    });
    if (result === 'REVOKED') {
      await this.participants.revokeLinkedAccess(companyId, k === 'proxies' ? { proxyId: id } : { corporateRepId: id });
    }
    return { status: result };
  }

  @Get(':kind/:id/document')
  async document(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('kind') kind: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
    @Meta() meta: RequestMeta,
  ): Promise<StreamableFile> {
    const k = assertKind(kind);
    const s = await this.scope(p, companyId, PERMISSIONS.AUTHORIZATION_MANAGE, meta);
    const file = await this.prisma.scoped([companyId], async (tx) => {
      const where = { id, companyId };
      const rec = k === 'proxies'
        ? await tx.proxyAuthorization.findFirst({ where, include: { document: true } })
        : await tx.corporateRepresentative.findFirst({ where, include: { document: true } });
      if (!rec?.document) throw new NotFoundException('No document attached');
      await this.audit.record(
        { action: 'authorization.document_download', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, tenantId: s.tenantId, companyId, targetType: 'stored_file', targetId: rec.document.id, meta },
        tx,
      );
      return rec.document;
    });
    const buf = await this.storage.get(file.storageKey);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(buf);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async storeDocument(file: Express.Multer.File, companyId: string) {
    const type = sniffFileType(file.buffer);
    if (type !== 'pdf' && type !== 'png' && type !== 'jpeg') throw new BadRequestException('The document must be a PDF, PNG or JPEG file');
    const stored = await this.storage.put(file.buffer, `authorizations/${companyId}`);
    return {
      storageKey: stored.key,
      originalName: file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 255) || `document.${type}`,
      mimeType: MIME[type]!,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
    };
  }

  private repDto(
    r: Prisma.CorporateRepresentativeGetPayload<{ include: { shareholder: { include: { identities: true } }; document: true } }>,
    pii: boolean,
  ): CorporateRepDto {
    const ids = new Set(r.identityIds);
    return {
      id: r.id,
      shareholderId: r.shareholderId,
      shareholderName: r.shareholder.name,
      fullName: r.fullName,
      designation: r.designation,
      email: r.email,
      phone: r.phone,
      identities: r.shareholder.identities.filter((i) => ids.has(i.id)).map((i) => toIdentityDto(i, pii)),
      validFrom: dateOnly(r.validFrom),
      validUntil: dateOnly(r.validUntil),
      status: r.status,
      effective: isEffective(r),
      document: r.document ? { id: r.document.id, fileName: r.document.originalName, sizeBytes: r.document.sizeBytes } : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
    };
  }

  private proxyDto(r: Prisma.ProxyAuthorizationGetPayload<{ include: { grantor: true; document: true } }>): ProxyDto {
    return {
      id: r.id,
      grantorShareholderId: r.grantorShareholderId,
      grantorName: r.grantor.name,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      scope: r.scope,
      meetingReference: r.meetingReference,
      validFrom: dateOnly(r.validFrom),
      validUntil: dateOnly(r.validUntil),
      status: r.status,
      effective: isEffective(r),
      document: r.document ? { id: r.document.id, fileName: r.document.originalName, sizeBytes: r.document.sizeBytes } : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
    };
  }
}

function assertKind(kind: string): Kind {
  if (kind !== 'corporate-representatives' && kind !== 'proxies') throw new NotFoundException();
  return kind;
}

/** Multipart forms send repeated fields as arrays and single values as strings. */
function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.includes(',') ? v.split(',').map((s) => s.trim()).filter(Boolean) : v ? [v] : [];
  return [];
}
