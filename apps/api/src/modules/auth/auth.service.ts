import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { LoginInput } from '@irm/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { env } from '../../config/env.js';
import type { RequestMeta } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

/** One message for every failure, so the response never reveals whether an account exists. */
export const LOGIN_FAILED_MESSAGE =
  'The email or password is incorrect, or the account is temporarily locked. Please try again.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const now = new Date();

    const locked = !!user?.lockedUntil && user.lockedUntil > now;
    const passwordOk = await this.passwords.verify(user?.passwordHash ?? null, input.password);

    if (!user || user.status !== 'ACTIVE' || locked || !passwordOk) {
      let reason = 'unknown_account';
      if (user) {
        reason = user.status !== 'ACTIVE' ? 'disabled' : locked ? 'locked' : 'bad_password';
        if (reason === 'bad_password') {
          const failures = user.failedLoginCount + 1;
          const lock = failures >= env().LOGIN_MAX_FAILURES;
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: lock ? 0 : failures,
              lockedUntil: lock ? new Date(now.getTime() + env().LOGIN_LOCK_MINUTES * 60_000) : user.lockedUntil,
            },
          });
          if (lock) reason = 'bad_password_locked';
        }
      }
      await this.audit.record({
        action: 'auth.login',
        outcome: 'FAILURE',
        actorUserId: user?.id ?? null,
        actorEmail: input.email,
        metadata: { reason },
        meta,
      });
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    const rehash = user.passwordHash && this.passwords.needsRehash(user.passwordHash)
      ? await this.passwords.hash(input.password)
      : undefined;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, ...(rehash ? { passwordHash: rehash } : {}) },
    });

    const session = await this.sessions.create(user.id, meta);
    await this.audit.record({
      action: 'auth.login',
      outcome: 'SUCCESS',
      actorUserId: user.id,
      actorEmail: user.email,
      meta,
    });
    return session;
  }
}
