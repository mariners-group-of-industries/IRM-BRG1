import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestMeta } from '../../common/request-context.js';

export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILURE';

export interface AuditEvent {
  action: string;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  actorEmail?: string | null;
  tenantId?: string | null;
  companyId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Never include passwords, tokens, OTPs or ballot choices. */
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

const FORBIDDEN_METADATA_KEYS = /pass(word)?|token|secret|otp|cookie|choice|ballot/i;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes an audit record. Accepts a transaction client so the record commits with the change. */
  async record(event: AuditEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const metadata = sanitize(event.metadata ?? {});
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          action: event.action,
          outcome: event.outcome,
          actorUserId: event.actorUserId ?? null,
          actorEmail: event.actorEmail ?? null,
          tenantId: event.tenantId ?? null,
          companyId: event.companyId ?? null,
          targetType: event.targetType ?? null,
          targetId: event.targetId ?? null,
          ipAddress: event.meta?.ipAddress ?? null,
          userAgent: event.meta?.userAgent ?? null,
          requestId: event.meta?.requestId ?? null,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Inside a transaction the caller must fail too, so rethrow.
      if (tx) throw err;
      this.logger.error(`Failed to write audit event ${event.action}`, err instanceof Error ? err.stack : String(err));
    }
  }
}

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = FORBIDDEN_METADATA_KEYS.test(k) ? '[redacted]' : v;
  }
  return out;
}
