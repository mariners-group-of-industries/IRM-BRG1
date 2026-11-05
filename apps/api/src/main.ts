import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const { PORT } = env();
  await app.listen(PORT, '127.0.0.1');
  Logger.log(`API listening on http://127.0.0.1:${PORT}/api/v1 (docs at /api/docs)`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
