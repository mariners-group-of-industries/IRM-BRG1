import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import type { MfaSetupResponse } from '@irm/shared';
import { env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  otpauthUrl,
  verifyTotp,
} from './totp.js';

const MFA_STEP_TTL_MS = 5 * 60_000;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export const MFA_FAILED_MESSAGE = 'The verification code is incorrect or has expired.';

/** Roles that must use MFA when MFA_ENFORCE_FOR_ADMINS is on. */
const ADMIN_ROLES = new Set(['PLATFORM_SUPER_ADMIN', 'COMPANY_ADMIN']);

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  setupRequired(p: Pick<AuthPrincipal, 'kind' | 'mfaEnabled' | 'assignments'>): boolean {
    return env().MFA_ENFORCE_FOR_ADMINS && p.kind === 'STAFF' && !p.mfaEnabled && p.assignments.some((a) => ADMIN_ROLES.has(a.roleKey));
  }

  /** Issues the second-step token after a correct password. Only its hash is stored. */
  async startLoginStep(userId: string, meta: RequestMeta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.otpChallenge.create({
      data: {
        purpose: 'MFA_LOGIN',
        secretHash: sha256(token),
        subject: {},
        userId,
        expiresAt: new Date(Date.now() + MFA_STEP_TTL_MS),
        ipAddress: meta.ipAddress,
      },
    });
    return token;
  }

  /** Completes the second step. Returns the user id on success. */
  async finishLoginStep(token: string, code: string, meta: RequestMeta): Promise<string> {
    const ch = await this.prisma.otpChallenge.findFirst({ where: { purpose: 'MFA_LOGIN', secretHash: sha256(token) } });
    if (!ch || !ch.userId || ch.consumedAt || ch.expiresAt <= new Date() || ch.attempts >= env().OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException(MFA_FAILED_MESSAGE);
    }
    const ok = await this.checkCode(ch.userId, code);
    if (!ok) {
      await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      await this.audit.record({ action: 'auth.mfa_verify', outcome: 'FAILURE', actorUserId: ch.userId, meta });
      throw new UnauthorizedException(MFA_FAILED_MESSAGE);
    }
    const consumed = await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new UnauthorizedException(MFA_FAILED_MESSAGE);
    await this.audit.record({ action: 'auth.mfa_verify', outcome: 'SUCCESS', actorUserId: ch.userId, metadata: { method: ok }, meta });
    return ch.userId;
  }

  /**
   * Accepts a TOTP code (blocking replays of an already used time step) or an unused
   * recovery code (which is then removed). Returns the method used, or null.
   */
  private async checkCode(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled || !user.mfaSecretEnc) return null;
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(decryptSecret(user.mfaSecretEnc, env().MFA_ENCRYPTION_KEY), code, user.mfaLastStep);
      if (step === null) return null;
      const updated = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
        data: { mfaLastStep: step },
      });
      return updated.count === 1 ? 'totp' : null;
    }
    const h = sha256(code.toLowerCase());
    const match = user.mfaRecoveryHashes.find((x) => x.length === h.length && timingSafeEqual(Buffer.from(x), Buffer.from(h)));
    if (!match) return null;
    await this.prisma.user.update({ where: { id: userId }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((x) => x !== match) } });
    return 'recovery';
  }

  /** Starts enrolment: stores a new encrypted secret that is not active until confirmed. */
  async setup(p: AuthPrincipal, meta: RequestMeta): Promise<MfaSetupResponse> {
    if (p.kind !== 'STAFF' || !p.email) throw new BadRequestException('MFA applies to staff accounts');
    if (p.mfaEnabled) throw new ConflictException('MFA is already enabled. Turn it off first to enrol a new device.');
    const secret = generateSecret();
    await this.prisma.user.update({
      where: { id: p.userId },
      data: { mfaSecretEnc: encryptSecret(secret, env().MFA_ENCRYPTION_KEY), mfaLastStep: null },
    });
    await this.audit.record({ action: 'auth.mfa_setup_started', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, meta });
    const url = otpauthUrl(secret, p.email);
    return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 200 }) };
  }

  /** Confirms enrolment with a first code. Returns recovery codes, shown once and stored hashed. */
  async enable(p: AuthPrincipal, code: string, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (user.mfaEnabled) throw new ConflictException('MFA is already enabled');
    if (!user.mfaSecretEnc) throw new BadRequestException('Start MFA setup first');
    const step = verifyTotp(decryptSecret(user.mfaSecretEnc, env().MFA_ENCRYPTION_KEY), code, null);
    if (step === null) throw new BadRequestException({ message: 'Validation failed', errors: { code: ['That code is not correct. Check the time on your phone and try again.'] } });
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: p.userId },
      data: { mfaEnabled: true, mfaLastStep: step, mfaRecoveryHashes: recoveryCodes.map((c) => sha256(c)) },
    });
    await this.audit.record({ action: 'auth.mfa_enabled', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, meta });
    return { recoveryCodes };
  }

  async disable(p: AuthPrincipal, code: string, meta: RequestMeta): Promise<void> {
    const method = await this.checkCode(p.userId, code);
    if (!method) {
      await this.audit.record({ action: 'auth.mfa_disable', outcome: 'FAILURE', actorUserId: p.userId, actorEmail: p.email, meta });
      throw new BadRequestException({ message: 'Validation failed', errors: { code: [MFA_FAILED_MESSAGE] } });
    }
    await this.prisma.user.update({
      where: { id: p.userId },
      data: { mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryHashes: [] },
    });
    await this.audit.record({ action: 'auth.mfa_disabled', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, meta });
  }
}
