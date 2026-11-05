import 'dotenv/config';
import { execSync } from 'node:child_process';
import pg from 'pg';

/**
 * Rebuilds the test database from migrations and seeds it before the suite.
 * Refuses to run against any database whose name does not end in "_test".
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": test database names must end in _test`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();

  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' };
  execSync('pnpm exec prisma migrate deploy', { stdio: 'pipe', env });
  execSync('pnpm exec tsx prisma/seed.ts', { stdio: 'pipe', env });
}
