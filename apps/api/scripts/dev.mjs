// Dev runner: incremental tsc compile (keeps emitDecoratorMetadata, which Nest DI needs)
// plus node --watch on the compiled output.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const isWin = process.platform === 'win32';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: isWin });

const tsc = run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']);

const waitForBuild = () =>
  new Promise((resolve) => {
    const t = setInterval(() => {
      if (existsSync('dist/main.js')) {
        clearInterval(t);
        resolve();
      }
    }, 300);
  });

await waitForBuild();
const node = run('node', ['--enable-source-maps', '--watch-path=dist', 'dist/main.js']);

const stop = () => {
  tsc.kill();
  node.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
