import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';
import type { AppRequest } from './common/request-context.js';

/** Builds the configured application. Shared by main.ts and the integration tests. */
export async function createApp(options: { logger?: boolean } = {}): Promise<NestExpressApplication> {
  const config = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: options.logger === false ? false : ['error', 'warn', 'log'],
  });

  // The web app proxies /api to this server; trust exactly one proxy hop for req.ip.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: AppRequest, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  if (config.NODE_ENV !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('IRM Platform API')
      .setDescription('AGM/EGM management. Session cookie auth; send X-CSRF-Token on state-changing requests.')
      .setVersion('0.1.0')
      .addCookieAuth('irm_session')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }
  return app;
}
