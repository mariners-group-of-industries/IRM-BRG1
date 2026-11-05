import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface OutboundMessage {
  channel: 'PHONE' | 'EMAIL';
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Delivers sign-in codes and notices.
 *
 * Only the development outbox exists today: messages are written to the
 * dev_outbox_messages table and shown on the clearly labelled development page.
 * Nothing is actually sent by SMS or email. Production boot is refused while
 * this driver is selected (see config/env.ts). Message bodies are never logged.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async send(message: OutboundMessage): Promise<void> {
    if (env().OTP_DELIVERY !== 'dev-outbox' || env().NODE_ENV === 'production') {
      throw new Error('No message delivery provider is configured');
    }
    await this.prisma.devOutboxMessage.create({ data: message });
    this.logger.log(`[dev-outbox] ${message.channel.toLowerCase()} message queued (body not logged)`);
  }
}
