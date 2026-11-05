import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { loginSchema, type MeResponse } from '@irm/shared';
import { Meta, Principal, Public, SkipCsrf } from '../../common/decorators.js';
import type { AppRequest, AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const input = parseBody(loginSchema, body);
    const { token, expiresAt } = await this.auth.login(input, meta);
    this.sessions.setCookie(res, token, expiresAt);
    return { ok: true, csrfToken: this.sessions.csrfTokenFor(token) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: AppRequest,
    @Principal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[SESSION_COOKIE] as string;
    await this.sessions.revoke(token);
    this.sessions.clearCookie(res);
    await this.audit.record({
      action: 'auth.logout',
      outcome: 'SUCCESS',
      actorUserId: principal.userId,
      actorEmail: principal.email,
      meta,
    });
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: AppRequest, @Principal() principal: AuthPrincipal): MeResponse {
    return {
      user: {
        id: principal.userId,
        email: principal.email,
        fullName: principal.fullName,
        assignments: principal.assignments.map((a) => ({
          roleKey: a.roleKey,
          roleName: a.roleName,
          scope: a.scope,
          tenantId: a.tenantId,
          tenantName: a.tenantName,
          companyId: a.companyId,
          companyName: a.companyName,
          permissions: [...a.permissions],
        })),
      },
      csrfToken: this.sessions.csrfTokenFor(req.sessionToken!),
    };
  }
}
