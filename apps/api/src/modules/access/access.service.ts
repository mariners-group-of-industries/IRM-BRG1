import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  hasPermission,
  type Permission,
  type ResourceScope,
  type RoleScope,
} from '@irm/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Central authorization service. Every service method that touches tenant or
 * company data calls `assert` (single resource) or a `*Filter` (lists).
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Loads active role assignments with their permissions. Called once per request by the AuthGuard. */
  async loadAssignments(userId: string): Promise<AuthPrincipal['assignments']> {
    const rows = await this.prisma.userRoleAssignment.findMany({
      where: { userId, revokedAt: null, OR: [{ companyId: null }, { company: { status: 'ACTIVE' } }] },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        tenant: { select: { name: true, status: true } },
        company: { select: { shortName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .filter((r) => !r.tenant || r.tenant.status === 'ACTIVE')
      .map((r) => ({
        roleKey: r.role.key,
        roleName: r.role.name,
        scope: r.scope as RoleScope,
        tenantId: r.tenantId,
        tenantName: r.tenant?.name ?? null,
        companyId: r.companyId,
        companyName: r.company?.shortName ?? null,
        permissions: r.role.permissions.map((rp) => rp.permission.key as Permission).sort(),
      }));
  }

  can(principal: AuthPrincipal, permission: Permission, scope: ResourceScope = {}): boolean {
    return hasPermission(principal.assignments, permission, scope);
  }

  /** Throws 403 and writes a DENIED audit event when the check fails. */
  async assert(
    principal: AuthPrincipal,
    permission: Permission,
    scope: ResourceScope = {},
    meta?: RequestMeta,
  ): Promise<void> {
    if (this.can(principal, permission, scope)) return;
    await this.audit.record({
      action: 'access.denied',
      outcome: 'DENIED',
      actorUserId: principal.userId,
      actorEmail: principal.email,
      tenantId: scope.tenantId ?? null,
      companyId: scope.companyId ?? null,
      metadata: { permission },
      meta,
    });
    throw new ForbiddenException('You do not have permission to perform this action');
  }

  /**
   * Resolves a company's scope from the database and asserts the permission.
   * Returns 404 (not 403) when the user cannot see the company at all, so
   * company ids in other tenants cannot be probed.
   */
  async assertCompany(
    principal: AuthPrincipal,
    companyId: string,
    permission: Permission,
    meta?: RequestMeta,
  ): Promise<{ id: string; tenantId: string }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true },
    });
    const scope = company ? { tenantId: company.tenantId, companyId: company.id } : null;
    if (!company || !scope || !this.canSeeCompany(principal, scope)) {
      throw new NotFoundException('Company not found');
    }
    await this.assert(principal, permission, scope, meta);
    return company;
  }

  private canSeeCompany(principal: AuthPrincipal, scope: Required<ResourceScope>): boolean {
    return this.can(principal, 'company.read', scope);
  }

  /** Prisma filter for companies the principal holds `permission` on. */
  companyFilter(principal: AuthPrincipal, permission: Permission): Prisma.CompanyWhereInput {
    const relevant = principal.assignments.filter((a) => a.permissions.includes(permission));
    if (relevant.some((a) => a.scope === 'PLATFORM')) return {};
    const tenantIds = relevant.filter((a) => a.scope === 'TENANT').map((a) => a.tenantId!);
    const companyIds = relevant.filter((a) => a.scope === 'COMPANY').map((a) => a.companyId!);
    if (tenantIds.length === 0 && companyIds.length === 0) return { id: { in: [] } };
    return { OR: [{ tenantId: { in: tenantIds } }, { id: { in: companyIds } }] };
  }

  /** Prisma filter for tenants the principal can see (platform: all; others: tenants they belong to). */
  tenantFilter(principal: AuthPrincipal): Prisma.TenantWhereInput {
    if (principal.assignments.some((a) => a.scope === 'PLATFORM' && a.permissions.includes('tenant.read'))) {
      return {};
    }
    const ids = [...new Set(principal.assignments.map((a) => a.tenantId).filter((t): t is string => !!t))];
    return { id: { in: ids } };
  }

  tenantVisible(principal: AuthPrincipal, tenantId: string): boolean {
    return principal.assignments.some(
      (a) => (a.scope === 'PLATFORM' && a.permissions.includes('tenant.read')) || a.tenantId === tenantId,
    );
  }

  /** Users visible to the principal: anyone holding an active assignment inside a company/tenant they can manage. */
  userFilter(principal: AuthPrincipal): Prisma.UserWhereInput {
    const relevant = principal.assignments.filter((a) => a.permissions.includes('user.read'));
    if (relevant.some((a) => a.scope === 'PLATFORM')) return {};
    const tenantIds = relevant.filter((a) => a.scope === 'TENANT').map((a) => a.tenantId!);
    const companyIds = relevant.filter((a) => a.scope === 'COMPANY').map((a) => a.companyId!);
    if (tenantIds.length === 0 && companyIds.length === 0) return { id: { in: [] } };
    return {
      assignments: {
        some: {
          revokedAt: null,
          OR: [{ tenantId: { in: tenantIds } }, { companyId: { in: companyIds } }],
        },
      },
    };
  }

  /** Audit entries visible to the principal. Platform audit readers see all; others see their tenants/companies only. */
  auditFilter(principal: AuthPrincipal): Prisma.AuditLogWhereInput {
    if (this.can(principal, 'platform.audit.read')) return {};
    const relevant = principal.assignments.filter((a) => a.permissions.includes('audit.read'));
    const tenantIds = relevant.filter((a) => a.scope === 'TENANT').map((a) => a.tenantId!);
    const companyIds = relevant.filter((a) => a.scope === 'COMPANY').map((a) => a.companyId!);
    if (tenantIds.length === 0 && companyIds.length === 0) return { id: { in: [] } };
    return { OR: [{ tenantId: { in: tenantIds } }, { companyId: { in: companyIds } }] };
  }
}
