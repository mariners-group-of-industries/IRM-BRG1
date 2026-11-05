import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  maskIdentifier,
  normalizeBoId,
  normalizeFolio,
  participantOtpRequestSchema,
  participantOtpVerifySchema,
  type OtpRequestResponse,
  type ParticipantMe,
  type PublicCompanyInfo,
} from '@irm/shared';
import { Meta, Principal, Public, SkipCsrf } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { NotificationService, type OutboundMessage } from '../notifications/notification.service.js';
import { isEffective } from '../register/authorization-rules.js';
import { ParticipantAccessService, type ParticipantSubject } from './participant-access.service.js';

/** Same text whether or not the details matched, so the response never confirms a holding exists. */
export const OTP_SENT_MESSAGE =
  'If these details match our records, a 6-digit code has been sent to the mobile number or email registered for this account.';
export const OTP_FAILED_MESSAGE = 'The code is incorrect or has expired. Request a new code and try again.';
const MAX_CHALLENGES_PER_SUBJECT = 3;
const SUBJECT_WINDOW_MS = 15 * 60_000;

const hashCode = (challengeId: string, code: string) =>
  createHmac('sha256', env().SESSION_SECRET).update(`otp:${challengeId}:${code}`).digest('hex');

@ApiTags('participants')
@Controller()
export class ParticipantAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationService,
    private readonly participants: ParticipantAccessService,
  ) {}

  /** Public company name for the sign-in page header. Only active companies are shown. */
  @Public()
  @Get('participant/companies/:id')
  async company(@Param('id', new ParseUUIDPipe()) id: string): Promise<PublicCompanyInfo> {
    const c = await this.prisma.company.findFirst({
      where: { id, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      select: { id: true, legalName: true, shortName: true },
    });
    if (!c) throw new NotFoundException('This sign-in link is not valid');
    return c;
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 5, ttl: 60_000 } })
  @Post('participant/otp/request')
  @HttpCode(200)
  async request(@Body() body: unknown, @Meta() meta: RequestMeta): Promise<OtpRequestResponse> {
    const input = parseBody(participantOtpRequestSchema, body);
    const company = await this.prisma.company.findFirst({
      where: { id: input.companyId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      select: { id: true, tenantId: true, shortName: true },
    });

    const challengeId = randomUUID();
    const subjectKey = createHash('sha256')
      .update(`${input.kind}:${input.companyId}:${'identifier' in input ? input.identifier.replace(/[\s-]/g, '').toUpperCase() : input.email}`)
      .digest('hex');

    let subject: ParticipantSubject | null = null;
    let recipients: { kind: 'PHONE' | 'EMAIL'; value: string }[] = [];
    if (company) {
      const resolved = await this.resolve(input, company);
      subject = resolved?.subject ?? null;
      recipients = resolved?.recipients ?? [];
    }

    const recent = await this.prisma.otpChallenge.count({
      where: { purpose: 'PARTICIPANT_LOGIN', subject: { path: ['key'], equals: subjectKey }, createdAt: { gt: new Date(Date.now() - SUBJECT_WINDOW_MS) } },
    });
    const throttled = recent >= MAX_CHALLENGES_PER_SUBJECT;
    const deliverable = !!subject && recipients.length > 0 && !throttled;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const ttl = env().OTP_TTL_MINUTES;
    await this.prisma.otpChallenge.create({
      data: {
        id: challengeId,
        purpose: 'PARTICIPANT_LOGIN',
        // An unmatched request stores a hash no code can produce, so verification always fails.
        secretHash: deliverable ? hashCode(challengeId, code) : randomBytes(32).toString('hex'),
        subject: { key: subjectKey, ...(deliverable ? { resolved: subject } : {}) } as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + ttl * 60_000),
        ipAddress: meta.ipAddress,
      },
    });

    if (deliverable) {
      for (const r of recipients) {
        const msg: OutboundMessage = {
          channel: r.kind,
          recipient: r.value,
          subject: `${company!.shortName} sign-in code`,
          body: `Your ${company!.shortName} shareholder sign-in code is ${code}. It expires in ${ttl} minutes. Never share this code with anyone, including company staff.`,
        };
        await this.notifications.send(msg);
      }
    }

    const identifierForAudit = 'identifier' in input ? maskIdentifier(input.identifier.replace(/[\s-]/g, '')) : input.email.replace(/^(.).*@/, '$1•••@');
    await this.audit.record({
      action: 'participant.otp_request',
      outcome: deliverable ? 'SUCCESS' : throttled ? 'DENIED' : 'FAILURE',
      tenantId: company?.tenantId ?? null,
      companyId: company?.id ?? null,
      targetType: 'otp_challenge',
      targetId: challengeId,
      metadata: { kind: input.kind, identifier: identifierForAudit, reason: deliverable ? null : throttled ? 'throttled' : subject ? 'no_contact' : 'no_match' },
      meta,
    });

    return { challengeId, expiresInSeconds: ttl * 60, message: OTP_SENT_MESSAGE };
  }

  private async resolve(
    input: ReturnType<typeof participantOtpRequestSchema.parse>,
    company: { id: string; tenantId: string },
  ): Promise<{ subject: ParticipantSubject; recipients: { kind: 'PHONE' | 'EMAIL'; value: string }[] } | null> {
    const base = { companyId: company.id, tenantId: company.tenantId };
    return this.prisma.scoped([company.id], async (tx) => {
      if (input.kind === 'SHAREHOLDER') {
        const bo = normalizeBoId(input.identifier);
        const folio = bo ? null : normalizeFolio(input.identifier);
        if (!bo && !folio) return null;
        const identity = await tx.shareholderIdentity.findFirst({
          where: { companyId: company.id, kind: bo ? 'BO' : 'FOLIO', value: (bo ?? folio)! },
          include: { shareholder: { include: { contacts: { where: { retiredAt: null, verifiedAt: { not: null } } } } } },
        });
        if (!identity || identity.shareholder.status !== 'ACTIVE') return null;
        return {
          subject: { kind: 'SHAREHOLDER', ...base, shareholderId: identity.shareholderId },
          recipients: identity.shareholder.contacts.map((c) => ({ kind: c.kind, value: c.value })),
        };
      }
      const isRep = input.kind === 'CORPORATE_REPRESENTATIVE';
      const records = isRep
        ? await tx.corporateRepresentative.findMany({ where: { companyId: company.id, email: input.email, status: 'APPROVED' } })
        : await tx.proxyAuthorization.findMany({ where: { companyId: company.id, email: input.email, status: 'APPROVED' } });
      const effective = records.filter((r) => isEffective(r));
      if (effective.length === 0) return null;
      const ids = effective.map((r) => r.id);
      return {
        subject: isRep
          ? { kind: 'CORPORATE_REPRESENTATIVE', ...base, email: input.email, repIds: ids }
          : { kind: 'PROXY_REPRESENTATIVE', ...base, email: input.email, proxyIds: ids },
        // Codes go to the email on the approved authorization only.
        recipients: [{ kind: 'EMAIL', value: input.email }],
      };
    });
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60_000 } })
  @Post('participant/otp/verify')
  @HttpCode(200)
  async verify(@Body() body: unknown, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const input = parseBody(participantOtpVerifySchema, body);
    const ch = await this.prisma.otpChallenge.findUnique({ where: { id: input.challengeId } });
    const fail = async (reason: string) => {
      await this.audit.record({ action: 'participant.otp_verify', outcome: 'FAILURE', targetType: 'otp_challenge', targetId: input.challengeId, metadata: { reason }, meta });
      throw new UnauthorizedException(OTP_FAILED_MESSAGE);
    };
    if (!ch || ch.purpose !== 'PARTICIPANT_LOGIN' || ch.consumedAt || ch.expiresAt <= new Date()) return fail('invalid_or_expired');
    if (ch.attempts >= env().OTP_MAX_ATTEMPTS) return fail('too_many_attempts');

    const expected = Buffer.from(ch.secretHash, 'hex');
    const actual = Buffer.from(hashCode(ch.id, input.code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      return fail('wrong_code');
    }
    // Single use, even under concurrent requests.
    const consumed = await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) return fail('already_used');

    const subject = (ch.subject as { resolved?: ParticipantSubject }).resolved;
    if (!subject) return fail('no_subject');
    const participant = await this.participants.ensureParticipant(subject);
    if (!participant) return fail('no_longer_valid');

    const { token, expiresAt } = await this.sessions.create(participant.userId, meta);
    this.sessions.setCookie(res, token, expiresAt);
    await this.prisma.user.update({ where: { id: participant.userId }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: 'participant.login',
      outcome: 'SUCCESS',
      actorUserId: participant.userId,
      tenantId: subject.tenantId,
      companyId: subject.companyId,
      metadata: { kind: subject.kind },
      meta,
    });
    return { ok: true, csrfToken: this.sessions.csrfTokenFor(token) };
  }

  @Get('participant/me')
  async me(@Principal() p: AuthPrincipal): Promise<ParticipantMe[]> {
    return this.participants.describe(p.userId);
  }

  /**
   * DEVELOPMENT ONLY. Lists messages that a real SMS/email provider would have sent.
   * Returns 404 unless NODE_ENV is development or test and OTP_DELIVERY is dev-outbox.
   */
  @Public()
  @Get('dev/outbox')
  async outbox() {
    if (env().NODE_ENV === 'production' || env().OTP_DELIVERY !== 'dev-outbox') throw new NotFoundException();
    const rows = await this.prisma.devOutboxMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 25 });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}

