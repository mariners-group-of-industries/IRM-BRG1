// Development-only PostgreSQL launcher.
//
// Starts a real PostgreSQL server from the `embedded-postgres` binaries so the
// project runs on machines without Docker or a system PostgreSQL install.
// Docker users can use infrastructure/docker-compose.yml instead.
//
// Data lives in ./.data/postgres (git-ignored). Stop with Ctrl+C.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const user = process.env.DEV_DB_USER ?? 'irm';
const password = process.env.DEV_DB_PASSWORD ?? 'irm_dev_password';
const databaseDir = resolve(process.cwd(), '.data/postgres');
const databases = ['irm', 'irm_test'];

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  // UTF-8 is mandatory: shareholder names and questions are often in Bangla.
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--auth=scram-sha-256'],
  onLog: () => {},
  onError: (e) => console.error('[postgres]', String(e).trim()),
});

const initialised = existsSync(resolve(databaseDir, 'PG_VERSION'));
if (!initialised) {
  console.log('[dev-db] Initialising new cluster in', databaseDir);
  await pg.initialise();
}
await pg.start();

for (const db of databases) {
  try {
    await pg.createDatabase(db);
    console.log(`[dev-db] Created database ${db}`);
  } catch {
    // Already exists.
  }
}

console.log(`[dev-db] PostgreSQL ready on 127.0.0.1:${port} (user ${user}). Databases: ${databases.join(', ')}`);

const shutdown = async () => {
  console.log('\n[dev-db] Stopping PostgreSQL');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
