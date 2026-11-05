import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createCompanySchema,
  PERMISSIONS,
  updateCompanySchema,
  type CompanySummary,
  type Paginated,
} from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { blankToNull, parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { companyInclude, toCompanySummary } from './mappers.js';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Principal() p: AuthPrincipal,
    @Query('q') q?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<Paginated<CompanySummary>> {
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 25));
    const search = q?.trim();
    const where: Prisma.CompanyWhereInput = {
      AND: [
        this.access.companyFilter(p, PERMISSIONS.COMPANY_READ),
        tenantId ? { tenantId } : {},
        search
          ? {
              OR: [
                { legalName: { contains: search, mode: 'insensitive' } },
                { shortName: { contains: search, mode: 'insensitive' } },
                { tradingCode: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.company.count({ where }),
      this.prisma.company.findMany({
        where,
        include: companyInclude,
        orderBy: { legalName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toCompanySummary), total, page, pageSize };
  }

  @Get(':id')
  async get(@Principal() p: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.access.assertCompany(p, id, PERMISSIONS.COMPANY_READ);
    const c = await this.prisma.company.findUnique({ where: { id }, include: companyInclude });
    if (!c) throw new NotFoundException('Company not found');
    return toCompanySummary(c);
  }

  @Post()
  async create(@Principal() p: AuthPrincipal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const input = parseBody(createCompanySchema, body);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId } });
    // Tenants the caller has no relationship with are reported as missing, not forbidden.
    const visible = tenant && this.access.tenantVisible(p, tenant.id);
    if (!tenant || !visible) throw new NotFoundException('Tenant not found');
    await this.access.assert(p, PERMISSIONS.COMPANY_CREATE, { tenantId: tenant.id }, meta);
    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          tenantId: tenant.id,
          legalName: input.legalName,
          shortName: input.shortName,
          slug: input.slug,
          companyType: input.companyType,
          registrationNumber: blankToNull(input.registrationNumber),
          tradingCode: blankToNull(input.tradingCode)?.toUpperCase() ?? null,
          registeredAddress: blankToNull(input.registeredAddress),
          contactEmail: blankToNull(input.contactEmail)?.toLowerCase() ?? null,
          timezone: input.timezone,
        },
        include: companyInclude,
      });
      await this.audit.record(
        {
          action: 'company.create',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          tenantId: tenant.id,
          companyId: c.id,
          targetType: 'company',
          targetId: c.id,
          metadata: { legalName: c.legalName },
          meta,
        },
        tx,
      );
      return c;
    });
    return toCompanySummary(company);
  }

  @Patch(':id')
  async update(
    @Principal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    const scope = await this.access.assertCompany(p, id, PERMISSIONS.COMPANY_UPDATE, meta);
    const input = parseBody(updateCompanySchema, body);
    // Suspending a company is a platform operation.
    if (input.status !== undefined) {
      await this.access.assert(p, PERMISSIONS.TENANT_MANAGE, {}, meta);
    }
    const data: Prisma.CompanyUpdateInput = {
      ...(input.legalName !== undefined && { legalName: input.legalName }),
      ...(input.shortName !== undefined && { shortName: input.shortName }),
      ...(input.companyType !== undefined && { companyType: input.companyType }),
      ...(input.registrationNumber !== undefined && { registrationNumber: blankToNull(input.registrationNumber) }),
      ...(input.tradingCode !== undefined && { tradingCode: blankToNull(input.tradingCode)?.toUpperCase() ?? null }),
      ...(input.registeredAddress !== undefined && { registeredAddress: blankToNull(input.registeredAddress) }),
      ...(input.contactEmail !== undefined && { contactEmail: blankToNull(input.contactEmail)?.toLowerCase() ?? null }),
      ...(input.timezone !== undefined && { timezone: input.timezone }),
      ...(input.status !== undefined && { status: input.status }),
    };
    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.update({ where: { id }, data, include: companyInclude });
      await this.audit.record(
        {
          action: 'company.update',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          tenantId: scope.tenantId,
          companyId: id,
          targetType: 'company',
          targetId: id,
          metadata: { fields: Object.keys(data) },
          meta,
        },
        tx,
      );
      return c;
    });
    return toCompanySummary(company);
  }
}
