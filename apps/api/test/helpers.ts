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
  director: 'director@meghnacement.example',
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
  upload: (path: string, field: string, data: Buffer, filename: string, fields?: Record<string, string | string[]>) => request.Test;
  csrf: string;
  cookie: string;
}

export const cookieFrom = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

/** A client that sends the given session cookie and CSRF header on every request. */
export function clientFor(app: INestApplication, cookie: string, csrf: string): Client {
  const server = app.getHttpServer();
  const url = (p: string) => `/api/v1${p}`;
  return {
    csrf,
    cookie,
    get: (p) => request(server).get(url(p)).set('Cookie', cookie),
    post: (p, b) => request(server).post(url(p)).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(b ?? {}),
    patch: (p, b) => request(server).patch(url(p)).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(b ?? {}),
    delete: (p) => request(server).delete(url(p)).set('Cookie', cookie).set('X-CSRF-Token', csrf),
    upload: (p, field, data, filename, fields = {}) => {
      let r = request(server).post(url(p)).set('Cookie', cookie).set('X-CSRF-Token', csrf);
      for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) r = r.field(k, one);
      return r.attach(field, data, filename);
    },
  };
}

/** Logs in with a password and returns a client that sends the session cookie and CSRF header. */
export async function login(app: INestApplication, email: string, password = PASSWORD): Promise<Client> {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return clientFor(app, cookieFrom(res), res.body.csrfToken as string);
}

export async function companyId(c: Client, slug: string): Promise<string> {
  const res = await c.get('/companies?pageSize=100').expect(200);
  const hit = (res.body.items as { id: string; slug: string }[]).find((x) => x.slug === slug);
  if (!hit) throw new Error(`company ${slug} not visible`);
  return hit.id;
}

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
