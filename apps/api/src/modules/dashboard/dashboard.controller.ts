import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type AuditEntry, type DashboardSummary, type Paginated } from '@irm/shared';
import { Principal } from '../../common/decorators.js';
import type { AuthPrincipal } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccessService } from '../access/access.service.js';
import { companyInclude, toCompanySummary } from '../tenancy/mappers.js';

type AuditRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  ipAddress: string | null;
  occurredAt: Date;
  company: { shortName: string } | null;
};

const toAuditEntry = (a: AuditRow): AuditEntry => ({
  id: a.id,
  action: a.action,
  actorEmail: a.actorEmail,
  targetType: a.targetType,
  targetId: a.targetId,
  companyName: a.company?.shortName ?? null,
  outcome: a.outcome,
  ipAddress: a.ipAddress,
  createdAt: a.occurredAt.toISOString(),
});

@ApiTags('dashboard')
@Controller()
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** All numbers are computed within the caller's tenant/company scope. */
  @Get('dashboard/summary')
  async summary(@Principal() p: AuthPrincipal): Promise<DashboardSummary> {
    const companyWhere = this.access.companyFilter(p, PERMISSIONS.COMPANY_READ);
    const isPlatform = p.assignments.some((a) => a.scope === 'PLATFORM');
    const canReadAudit = p.assignments.some(
      (a) => a.permissions.includes(PERMISSIONS.AUDIT_READ) || a.permissions.includes(PERMISSIONS.PLATFORM_AUDIT_READ),
    );
    const canReadUsers = p.assignments.some((a) => a.permissions.includes(PERMISSIONS.USER_READ));

    const [tenants, companies, users, roleAssignments, byType, recentCompanies, recentAudit] = await Promise.all([
      isPlatform ? this.prisma.tenant.count() : Promise.resolve(null),
      this.prisma.company.count({ where: companyWhere }),
      canReadUsers ? this.prisma.user.count({ where: this.access.userFilter(p) }) : Promise.resolve(0),
      this.countAssignments(p, companyWhere, isPlatform),
      this.prisma.company.groupBy({ by: ['companyType'], where: companyWhere, _count: { _all: true } }),
      this.prisma.company.findMany({
        where: companyWhere,
        include: companyInclude,
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      canReadAudit
        ? this.prisma.auditLog.findMany({
            where: this.access.auditFilter(p),
            include: { company: { select: { shortName: true } } },
            orderBy: { occurredAt: 'desc' },
            take: 8,
          })
        : Promise.resolve([]),
    ]);

    const scopeLabel = isPlatform
      ? 'All tenants'
      : [...new Set(p.assignments.map((a) => a.companyName ?? a.tenantName).filter(Boolean))].join(', ') ||
        'No assigned companies';

    return {
      scopeLabel,
      counts: { tenants, companies, users, roleAssignments },
      companiesByType: byType.map((b) => ({ companyType: b.companyType, count: b._count._all })),
      recentCompanies: recentCompanies.map(toCompanySummary),
      recentAudit: recentAudit.map(toAuditEntry),
    };
  }

  /**
   * Active assignments the caller can see: everything for platform operators;
   * otherwise assignments on visible companies plus group-level assignments of their tenants.
   */
  private async countAssignments(
    p: AuthPrincipal,
    companyWhere: Prisma.CompanyWhereInput,
    isPlatform: boolean,
  ): Promise<number> {
    if (isPlatform) return this.prisma.userRoleAssignment.count({ where: { revokedAt: null } });
    const companyIds = (await this.prisma.company.findMany({ where: companyWhere, select: { id: true } })).map((c) => c.id);
    const tenantIds = p.assignments.filter((a) => a.scope === 'TENANT').map((a) => a.tenantId!);
    return this.prisma.userRoleAssignment.count({
      where: {
        revokedAt: null,
        OR: [{ companyId: { in: companyIds } }, { scope: 'TENANT', tenantId: { in: tenantIds } }],
      },
    });
  }

  @Get('audit')
  async auditLog(
    @Principal() p: AuthPrincipal,
    @Query('page') pageRaw?: string,
    @Query('action') action?: string,
  ): Promise<Paginated<AuditEntry>> {
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = 50;
    const canRead = p.assignments.some(
      (a) => a.permissions.includes(PERMISSIONS.AUDIT_READ) || a.permissions.includes(PERMISSIONS.PLATFORM_AUDIT_READ),
    );
    if (!canRead) return { items: [], total: 0, page, pageSize };
    const where = { AND: [this.access.auditFilter(p), action ? { action: { startsWith: action } } : {}] };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { company: { select: { shortName: true } } },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toAuditEntry), total, page, pageSize };
  }
}
