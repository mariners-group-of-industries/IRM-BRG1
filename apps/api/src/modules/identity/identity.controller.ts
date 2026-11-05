import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_BY_KEY,
  ROLE_DEFINITIONS,
  canAssignRole,
  type Paginated,
  type RoleKey,
  type UserSummary,
} from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  fullName: z.string().trim().min(2, 'At least 2 characters').max(160),
  password: z.string().min(1, 'Required').max(256),
});

const assignSchema = z.object({
  userId: z.string().uuid(),
  roleKey: z.string().refine((k) => ROLE_BY_KEY.has(k as RoleKey), 'Unknown role'),
  scope: z.enum(['PLATFORM', 'TENANT', 'COMPANY']),
  tenantId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});

@ApiTags('identity')
@Controller()
export class IdentityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /** Role catalogue and permission matrix. Readable by any signed-in staff user. */
  @Get('roles')
  roles() {
    return {
      roles: ROLE_DEFINITIONS.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        allowedScopes: r.allowedScopes,
        participant: r.participant,
        permissions: r.permissions,
      })),
      permissions: Object.entries(PERMISSION_DESCRIPTIONS).map(([key, description]) => ({ key, description })),
    };
  }

  @Get('users')
  async users(
    @Principal() p: AuthPrincipal,
    @Query('q') q?: string,
    @Query('page') pageRaw?: string,
    @Query('companyId') companyId?: string,
  ): Promise<Paginated<UserSummary>> {
    if (!p.assignments.some((a) => a.permissions.includes(PERMISSIONS.USER_READ))) {
      throw new ForbiddenException('You do not have permission to view users');
    }
    if (companyId) {
      if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new BadRequestException('Invalid companyId');
      await this.access.assertCompany(p, companyId, PERMISSIONS.USER_READ);
    }
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = 25;
    const search = q?.trim();
    const where: Prisma.UserWhereInput = {
      AND: [
        this.access.userFilter(p),
        companyId ? { assignments: { some: { revokedAt: null, companyId } } } : {},
        search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { fullName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const visibleScope: Prisma.UserRoleAssignmentWhereInput = companyId
      ? { companyId }
      : this.visibleAssignmentFilter(p);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: {
            where: { revokedAt: null, ...visibleScope },
            include: {
              role: { select: { name: true } },
              tenant: { select: { name: true } },
              company: { select: { shortName: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        status: u.status,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        roles: u.assignments.map((a) => ({
          assignmentId: a.id,
          roleName: a.role.name,
          scope: a.scope,
          scopeName: a.company?.shortName ?? a.tenant?.name ?? null,
        })),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Non-platform callers only see the assignments inside their own scope, never a user's roles elsewhere. */
  private visibleAssignmentFilter(p: AuthPrincipal): Prisma.UserRoleAssignmentWhereInput {
    const relevant = p.assignments.filter((a) => a.permissions.includes(PERMISSIONS.USER_READ));
    if (relevant.some((a) => a.scope === 'PLATFORM')) return {};
    return {
      OR: [
        { tenantId: { in: relevant.filter((a) => a.scope === 'TENANT').map((a) => a.tenantId!) } },
        { companyId: { in: relevant.filter((a) => a.scope === 'COMPANY').map((a) => a.companyId!) } },
      ],
    };
  }

  @Post('users')
  async createUser(@Principal() p: AuthPrincipal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    if (!p.assignments.some((a) => a.permissions.includes(PERMISSIONS.USER_MANAGE))) {
      throw new ForbiddenException('You do not have permission to create users');
    }
    const input = parseBody(createUserSchema, body);
    const policy = this.passwords.policyError(input.password);
    if (policy) throw new BadRequestException({ message: 'Validation failed', errors: { password: [policy] } });
    const existing = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw new ConflictException('A user with this email already exists');
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, fullName: input.fullName, passwordHash } });
      await this.audit.record(
        {
          action: 'user.create',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          targetType: 'user',
          targetId: u.id,
          metadata: { email: u.email },
          meta,
        },
        tx,
      );
      return u;
    });
    return { id: user.id, email: user.email, fullName: user.fullName };
  }

  /**
   * Grants a role. Rules:
   * - The caller needs role.assign at the target scope.
   * - The caller's role must list the target role in assignableRoles (see @irm/shared grants.ts).
   * - PLATFORM roles can only be granted by a platform assignment.
   */
  @Post('assignments')
  async assign(@Principal() p: AuthPrincipal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const input = parseBody(assignSchema, body);
    const def = ROLE_BY_KEY.get(input.roleKey as RoleKey)!;
    if (!def.allowedScopes.includes(input.scope)) {
      throw new BadRequestException(`${def.name} cannot be assigned at ${input.scope.toLowerCase()} scope`);
    }

    let tenantId: string | null = null;
    let companyId: string | null = null;
    if (input.scope === 'COMPANY') {
      if (!input.companyId) throw new BadRequestException('companyId is required for company scope');
      const c = await this.access.assertCompany(p, input.companyId, PERMISSIONS.ROLE_ASSIGN, meta);
      tenantId = c.tenantId;
      companyId = c.id;
    } else if (input.scope === 'TENANT') {
      if (!input.tenantId) throw new BadRequestException('tenantId is required for tenant scope');
      const t = await this.prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });
      if (!t || !this.access.tenantVisible(p, t.id)) throw new NotFoundException('Tenant not found');
      await this.access.assert(p, PERMISSIONS.ROLE_ASSIGN, { tenantId: t.id }, meta);
      tenantId = t.id;
    } else {
      await this.access.assert(p, PERMISSIONS.ROLE_ASSIGN, {}, meta);
      if (!p.assignments.some((a) => a.scope === 'PLATFORM')) {
        throw new ForbiddenException('Only platform administrators can grant platform roles');
      }
    }

    if (!canAssignRole(p.assignments, def.key, { scope: input.scope, tenantId, companyId })) {
      await this.audit.record({
        action: 'role.assign',
        outcome: 'DENIED',
        actorUserId: p.userId,
        actorEmail: p.email,
        tenantId,
        companyId,
        metadata: { roleKey: def.key, scope: input.scope, reason: 'role_not_assignable' },
        meta,
      });
      throw new ForbiddenException(`You are not allowed to grant the ${def.name} role here`);
    }

    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException('User not found');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { key: def.key } });

    const assignment = await this.prisma.$transaction(async (tx) => {
      const a = await tx.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id, scope: input.scope, tenantId, companyId, grantedById: p.userId },
      });
      await this.audit.record(
        {
          action: 'role.assign',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          tenantId,
          companyId,
          targetType: 'user',
          targetId: user.id,
          metadata: { roleKey: def.key, scope: input.scope, assignmentId: a.id, userEmail: user.email },
          meta,
        },
        tx,
      );
      return a;
    });
    return { id: assignment.id };
  }

  @Delete('assignments/:id')
  @HttpCode(200)
  async revoke(@Principal() p: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    const a = await this.prisma.userRoleAssignment.findUnique({ where: { id }, include: { role: true } });
    if (!a || a.revokedAt) throw new NotFoundException('Assignment not found');
    const scope = { tenantId: a.tenantId, companyId: a.companyId };
    if (a.scope !== 'PLATFORM' && !this.access.can(p, PERMISSIONS.ROLE_ASSIGN, scope)) {
      throw new NotFoundException('Assignment not found');
    }
    await this.access.assert(p, PERMISSIONS.ROLE_ASSIGN, scope, meta);
    if (a.userId === p.userId && a.role.key === 'PLATFORM_SUPER_ADMIN') {
      throw new BadRequestException('You cannot revoke your own platform administrator role');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.update({ where: { id }, data: { revokedAt: new Date(), revokedById: p.userId } });
      await this.audit.record(
        {
          action: 'role.revoke',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          tenantId: a.tenantId,
          companyId: a.companyId,
          targetType: 'user',
          targetId: a.userId,
          metadata: { roleKey: a.role.key, assignmentId: a.id },
          meta,
        },
        tx,
      );
    });
    return { ok: true };
  }

  /** Disabling a user also ends every active session immediately. */
  @Post('users/:id/disable')
  @HttpCode(200)
  async disable(@Principal() p: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    await this.access.assert(p, PERMISSIONS.USER_MANAGE, {}, meta);
    if (id === p.userId) throw new BadRequestException('You cannot disable your own account');
    await this.prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      action: 'user.disable',
      outcome: 'SUCCESS',
      actorUserId: p.userId,
      actorEmail: p.email,
      targetType: 'user',
      targetId: id,
      meta,
    });
    return { ok: true };
  }
}
