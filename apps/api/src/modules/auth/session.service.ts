import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { env } from '../../config/env.js';
import type { RequestMeta } from '../../common/request-context.js';

export const SESSION_COOKIE = 'irm_session';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a session and returns the opaque token. Only its hash is persisted. */
  async create(userId: string, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    return { token, expiresAt };
  }

  /** Returns the active session for a token, enforcing absolute and idle expiry. */
  async validate(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, kind: true, email: true, fullName: true, status: true, mfaEnabled: true } } },
    });
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    const idleLimit = env().SESSION_IDLE_MINUTES * 60_000;
    if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > idleLimit) {
      return null;
    }
    if (session.user.status !== 'ACTIVE') return null;
    // Touch at most once a minute to avoid a write per request.
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }
    return session;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** CSRF token bound to the session token. Stateless: derived with HMAC, never stored. */
  csrfTokenFor(sessionToken: string): string {
    return createHmac('sha256', env().SESSION_SECRET).update(`csrf:${sessionToken}`).digest('base64url');
  }

  verifyCsrf(sessionToken: string, provided: string | undefined): boolean {
    if (!provided) return false;
    const expected = Buffer.from(this.csrfTokenFor(sessionToken));
    const actual = Buffer.from(provided);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env().COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env().COOKIE_SECURE, sameSite: 'lax', path: '/' });
  }
}
