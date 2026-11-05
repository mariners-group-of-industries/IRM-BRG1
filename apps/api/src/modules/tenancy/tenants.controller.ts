import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createTenantSchema, PERMISSIONS, type TenantSummary } from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toTenantSummary } from './mappers.js';

const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Principal() p: AuthPrincipal): Promise<TenantSummary[]> {
    const rows = await this.prisma.tenant.findMany({
      where: this.access.tenantFilter(p),
      include: { _count: { select: { companies: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(toTenantSummary);
  }

  @Post()
  async create(@Principal() p: AuthPrincipal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    await this.access.assert(p, PERMISSIONS.TENANT_MANAGE, {}, meta);
    const input = parseBody(createTenantSchema, body);
    const tenant = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({ data: input, include: { _count: { select: { companies: true } } } });
      await this.audit.record(
        {
          action: 'tenant.create',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          tenantId: t.id,
          targetType: 'tenant',
          targetId: t.id,
          metadata: { name: t.name, slug: t.slug },
          meta,
        },
        tx,
      );
      return t;
    });
    return toTenantSummary(tenant);
  }

  @Patch(':id')
  async update(
    @Principal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    await this.access.assert(p, PERMISSIONS.TENANT_MANAGE, {}, meta);
    const input = parseBody(updateTenantSchema, body);
    const tenant = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id },
        data: input,
        include: { _count: { select: { companies: true } } },
      });
      await this.audit.record(
        {
          action: 'tenant.update',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          tenantId: id,
          targetType: 'tenant',
          targetId: id,
          metadata: { changes: input },
          meta,
        },
        tx,
      );
      return t;
    });
    return toTenantSummary(tenant);
  }
}
