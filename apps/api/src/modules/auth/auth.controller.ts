import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { loginSchema, mfaCodeSchema, type LoginResponse, type MeResponse } from '@irm/shared';
import { AllowWithoutMfa, Meta, Principal, Public, SkipCsrf } from '../../common/decorators.js';
import type { AppRequest, AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

/** Password sign-ins per minute per IP. Defaults to 10; raise only for local browser-test runs. */
const LOGIN_LIMIT = process.env.NODE_ENV === 'test' ? 1000 : Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? 10);
const mfaStepSchema = mfaCodeSchema.extend({ mfaToken: z.string().min(20).max(200) });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<LoginResponse> {
    const result = await this.auth.login(parseBody(loginSchema, body), meta);
    if (result.kind === 'mfa') return { ok: true, mfaRequired: true, mfaToken: result.mfaToken };
    this.sessions.setCookie(res, result.token, result.expiresAt);
    return { ok: true, csrfToken: this.sessions.csrfTokenFor(result.token) };
  }

  /** Second sign-in step for accounts with MFA. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@Body() body: unknown, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<LoginResponse> {
    const input = parseBody(mfaStepSchema, body);
    const userId = await this.mfa.finishLoginStep(input.mfaToken, input.code, meta);
    const result = await this.auth.completeLogin(userId, null, meta);
    if (result.kind !== 'session') throw new Error('unreachable');
    this.sessions.setCookie(res, result.token, result.expiresAt);
    return { ok: true, csrfToken: this.sessions.csrfTokenFor(result.token) };
  }

  @AllowWithoutMfa()
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@Principal() p: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.mfa.setup(p, meta);
  }

  @AllowWithoutMfa()
  @Post('mfa/enable')
  @HttpCode(200)
  enableMfa(@Principal() p: AuthPrincipal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.mfa.enable(p, parseBody(mfaCodeSchema, body).code, meta);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  async disableMfa(@Principal() p: AuthPrincipal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    await this.mfa.disable(p, parseBody(mfaCodeSchema, body).code, meta);
    return { ok: true };
  }

  @AllowWithoutMfa()
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

  @AllowWithoutMfa()
  @Get('me')
  me(@Req() req: AppRequest, @Principal() principal: AuthPrincipal): MeResponse {
    return {
      user: {
        id: principal.userId,
        kind: principal.kind,
        email: principal.email,
        fullName: principal.fullName,
        mfaEnabled: principal.mfaEnabled,
        mfaSetupRequired: this.mfa.setupRequired(principal),
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
