// Stops the development PostgreSQL cluster started by start.mjs, even if the
// launcher process was killed without a clean shutdown.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const platformPkg = {
  win32: '@embedded-postgres/windows-x64',
  linux: '@embedded-postgres/linux-x64',
  darwin: process.arch === 'arm64' ? '@embedded-postgres/darwin-arm64' : '@embedded-postgres/darwin-x64',
}[process.platform];

const embeddedDir = dirname(require.resolve('embedded-postgres/package.json'));
const pkgDir = dirname(require.resolve(`${platformPkg}/package.json`, { paths: [embeddedDir] }));
const pgCtl = join(pkgDir, 'native', 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
const dataDir = resolve(process.cwd(), '.data/postgres');

try {
  execFileSync(pgCtl, ['-D', dataDir, 'stop', '-m', 'fast'], { stdio: 'inherit' });
} catch {
  console.log('[dev-db] No running cluster found.');
}
