import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env().DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a transaction that is confined to the given companies by
   * PostgreSQL row-level security. Inside, the session switches to the
   * restricted role `irm_app` and sets `app.company_ids`, so even a mistaken
   * query cannot read or write rows of another company in the RLS-protected tables.
   *
   * All shareholder, register, authorization and participant data access must go through here.
   */
  async scoped<T>(
    companyIds: string[],
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (companyIds.length === 0) throw new Error('scoped() needs at least one company id');
    for (const id of companyIds) if (!UUID.test(id)) throw new Error('scoped() received an invalid company id');
    return this.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE irm_app');
        await tx.$executeRaw`SELECT set_config('app.company_ids', ${companyIds.join(',')}, true)`;
        return fn(tx);
      },
      { timeout: options.timeoutMs ?? 15_000, maxWait: 10_000 },
    );
  }
}
