import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_WITHOUT_MFA_KEY, IS_PUBLIC_KEY, SKIP_CSRF_KEY } from '../../common/decorators.js';
import type { AppRequest } from '../../common/request-context.js';
import { env } from '../../config/env.js';
import { AccessService } from '../access/access.service.js';
import { MfaService } from './mfa.service.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard. Order of checks:
 * 1. Origin: state-changing requests from a foreign Origin are rejected (also covers login CSRF).
 * 2. Session: non-public routes need a valid session cookie.
 * 3. CSRF: state-changing requests need the X-CSRF-Token header bound to the session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly mfa: MfaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ?? false;
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets) ?? false;
    const unsafe = !SAFE_METHODS.has(req.method);

    if (unsafe) {
      const origin = req.headers.origin;
      if (origin && origin !== env().WEB_ORIGIN) {
        throw new ForbiddenException('Cross-origin request rejected');
      }
    }

    if (isPublic) return true;

    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Please sign in to continue');
    }
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException('Your session has expired. Please sign in again.');

    if (unsafe && !skipCsrf) {
      const header = req.headers['x-csrf-token'];
      if (!this.sessions.verifyCsrf(token, typeof header === 'string' ? header : undefined)) {
        throw new ForbiddenException('Invalid or missing CSRF token');
      }
    }

    req.sessionToken = token;
    req.principal = {
      userId: session.user.id,
      kind: session.user.kind,
      email: session.user.email,
      mfaEnabled: session.user.mfaEnabled,
      fullName: session.user.fullName,
      sessionId: session.id,
      assignments: await this.access.loadAssignments(session.user.id),
    };

    // Admins who must use MFA can only reach enrolment, profile and sign-out until they enrol.
    const allowWithoutMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA_KEY, targets) ?? false;
    if (!allowWithoutMfa && this.mfa.setupRequired(req.principal)) {
      throw new ForbiddenException({ statusCode: 403, message: 'Set up two-step verification to continue', code: 'MFA_SETUP_REQUIRED' });
    }
    return true;
  }
}
