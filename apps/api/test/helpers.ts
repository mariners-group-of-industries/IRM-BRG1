import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';

export const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Agm!Dev2026';

export const USERS = {
  platform: 'platform.admin@irm.local',
  groupAdmin: 'group.admin@meghna.example',
  meghnaAdmin: 'cs@meghnacement.example',
  meetingAdmin: 'meeting.admin@meghnacement.example',
  moderator: 'moderator@meghnacement.example',
  padmaAdmin: 'cs@padmapharma.example',
} as const;

export async function bootApp(): Promise<INestApplication> {
  const app = await createApp({ logger: false });
  await app.init();
  return app;
}

export interface Client {
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  patch: (path: string, body?: object) => request.Test;
  delete: (path: string) => request.Test;
  csrf: string;
}

/** Logs in and returns a client that sends the session cookie and CSRF header. */
export async function login(app: INestApplication, email: string, password = PASSWORD): Promise<Client> {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
  const csrf = res.body.csrfToken as string;
  const server = app.getHttpServer();
  return {
    csrf,
    get: (p) => request(server).get(`/api/v1${p}`).set('Cookie', cookie),
    post: (p, b) => request(server).post(`/api/v1${p}`).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(b ?? {}),
    patch: (p, b) => request(server).patch(`/api/v1${p}`).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(b ?? {}),
    delete: (p) => request(server).delete(`/api/v1${p}`).set('Cookie', cookie).set('X-CSRF-Token', csrf),
  };
}
