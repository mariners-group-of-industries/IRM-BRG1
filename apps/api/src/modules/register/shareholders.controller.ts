import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  normalizeBoId,
  normalizeFolio,
  shareClassSchema,
  type Paginated,
  type RegisterSummary,
  type ShareClassDto,
  type ShareholderDetail,
  type ShareholderListItem,
} from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toContactDto, toHoldingDto, toIdentityDto } from './register.mappers.js';

@ApiTags('shareholders')
@Controller('companies/:companyId')
export class ShareholdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('register/summary')
  async summary(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string): Promise<RegisterSummary> {
    await this.access.assertCompany(p, companyId, PERMISSIONS.SHAREHOLDER_READ);
    return this.prisma.scoped([companyId], async (tx) => {
      const [shareholders, identities, classes, lastImport] = await Promise.all([
        tx.shareholder.count({ where: { companyId } }),
        tx.shareholderIdentity.count({ where: { companyId } }),
        tx.shareClass.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
        tx.registerImport.findFirst({ where: { companyId, status: 'COMMITTED' }, orderBy: { committedAt: 'desc' } }),
      ]);
      const sums = await tx.shareholding.groupBy({
        by: ['shareClassId'],
        where: { companyId, validTo: null, quantity: { gt: 0 } },
        _sum: { quantity: true },
        _count: { _all: true },
      });
      return {
        shareholders,
        identities,
        byClass: classes.map((c) => {
          const s = sums.find((x) => x.shareClassId === c.id);
          return {
            code: c.code,
            name: c.name,
            votesPerShare: c.votesPerShare,
            totalShares: (s?._sum.quantity ?? 0n).toString(),
            holders: s?._count._all ?? 0,
          };
        }),
        lastImport: lastImport
          ? {
              id: lastImport.id,
              committedAt: lastImport.committedAt!.toISOString(),
              asOfDate: lastImport.asOfDate?.toISOString().slice(0, 10) ?? null,
            }
          : null,
      };
    });
  }

  @Get('share-classes')
  async shareClasses(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string): Promise<ShareClassDto[]> {
    await this.access.assertCompany(p, companyId, PERMISSIONS.SHAREHOLDER_READ);
    return this.prisma.scoped([companyId], (tx) =>
      tx.shareClass.findMany({
        where: { companyId },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, votesPerShare: true },
      }),
    );
  }

  @Post('share-classes')
  async createShareClass(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ): Promise<ShareClassDto> {
    const company = await this.access.assertCompany(p, companyId, PERMISSIONS.SHAREHOLDER_IMPORT, meta);
    const input = parseBody(shareClassSchema, body);
    return this.prisma.scoped([companyId], async (tx) => {
      const c = await tx.shareClass.create({
        data: { tenantId: company.tenantId, companyId, code: input.code, name: input.name, votesPerShare: input.votesPerShare },
      });
      await this.audit.record(
        {
          action: 'share_class.create',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          tenantId: company.tenantId,
          companyId,
          targetType: 'share_class',
          targetId: c.id,
          metadata: { code: c.code, votesPerShare: c.votesPerShare },
          meta,
        },
        tx,
      );
      return { id: c.id, code: c.code, name: c.name, votesPerShare: c.votesPerShare };
    });
  }

  @Get('shareholders')
  async list(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('page') pageRaw?: string,
  ): Promise<Paginated<ShareholderListItem>> {
    const company = await this.access.assertCompany(p, companyId, PERMISSIONS.SHAREHOLDER_READ);
    const pii = this.access.can(p, PERMISSIONS.SHAREHOLDER_PII_READ, { tenantId: company.tenantId, companyId });
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = 25;
    const search = q?.trim();
    const identifier = search ? (normalizeBoId(search) ?? normalizeFolio(search)) : null;

    const where: Prisma.ShareholderWhereInput = {
      companyId,
      ...(type === 'INDIVIDUAL' || type === 'CORPORATE' ? { type } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { nameBn: { contains: search } },
              ...(identifier ? [{ identities: { some: { value: identifier } } }] : []),
            ],
          }
        : {}),
    };

    return this.prisma.scoped([companyId], async (tx) => {
      const [total, rows] = await Promise.all([
        tx.shareholder.count({ where }),
        tx.shareholder.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            identities: {
              orderBy: { value: 'asc' },
              include: { holdings: { where: { validTo: null }, select: { quantity: true } } },
            },
          },
        }),
      ]);
      return {
        items: rows.map((s) => ({
          id: s.id,
          type: s.type,
          name: s.name,
          nameBn: s.nameBn,
          status: s.status,
          identities: s.identities.map((i) => toIdentityDto(i, pii)),
          totalShares: s.identities
            .flatMap((i) => i.holdings)
            .reduce((sum, h) => sum + h.quantity, 0n)
            .toString(),
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  @Get('shareholders/:id')
  async detail(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Meta() meta: RequestMeta,
  ): Promise<ShareholderDetail> {
    const company = await this.access.assertCompany(p, companyId, PERMISSIONS.SHAREHOLDER_READ);
    const pii = this.access.can(p, PERMISSIONS.SHAREHOLDER_PII_READ, { tenantId: company.tenantId, companyId });
    return this.prisma.scoped([companyId], async (tx) => {
      const s = await tx.shareholder.findFirst({
        where: { id, companyId },
        include: {
          identities: { orderBy: { value: 'asc' } },
          contacts: { where: { retiredAt: null }, orderBy: { kind: 'asc' } },
        },
      });
      if (!s) throw new NotFoundException('Shareholder not found');
      const holdings = await tx.shareholding.findMany({
        where: { companyId, identityId: { in: s.identities.map((i) => i.id) } },
        include: { identity: true, shareClass: true },
        orderBy: { validFrom: 'desc' },
      });
      if (pii) {
        // Unmasked personal data views are audited.
        await this.audit.record(
          {
            action: 'shareholder.pii_view',
            outcome: 'SUCCESS',
            actorUserId: p.userId,
            actorEmail: p.email,
            tenantId: company.tenantId,
            companyId,
            targetType: 'shareholder',
            targetId: s.id,
            meta,
          },
          tx,
        );
      }
      const current = holdings.filter((h) => h.validTo === null);
      return {
        id: s.id,
        type: s.type,
        name: s.name,
        nameBn: s.nameBn,
        status: s.status,
        identities: s.identities.map((i) => toIdentityDto(i, pii)),
        totalShares: current.reduce((sum, h) => sum + h.quantity, 0n).toString(),
        contacts: s.contacts.map((c) => toContactDto(c, pii)),
        currentHoldings: current.map((h) => toHoldingDto(h, pii)),
        history: holdings.filter((h) => h.validTo !== null).map((h) => toHoldingDto(h, pii)),
        piiVisible: pii,
      };
    });
  }
}
