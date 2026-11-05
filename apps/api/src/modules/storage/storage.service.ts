import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { env } from '../../config/env.js';

export interface StoredObject {
  key: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Private file storage. The local-disk driver keeps files outside any web root;
 * they are only ever returned through authorized API endpoints.
 *
 * An S3-compatible driver will implement the same two methods (put/get) once an
 * object store is provisioned. See docs/DEPLOYMENT.md.
 */
@Injectable()
export class StorageService {
  private readonly root = isAbsolute(env().STORAGE_DIR) ? env().STORAGE_DIR : resolve(process.cwd(), env().STORAGE_DIR);

  async put(data: Buffer, prefix: string): Promise<StoredObject> {
    const now = new Date();
    const key = `${prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    return { key, sha256: createHash('sha256').update(data).digest('hex'), sizeBytes: data.length };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  private pathFor(key: string): string {
    if (!/^[a-z0-9-]+(\/[a-z0-9-]+)+$/i.test(key)) throw new Error('Invalid storage key');
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Storage key escapes root');
    return path;
  }
}

/** Detects the real type from magic bytes. Never trust the client-supplied MIME type. */
export function sniffFileType(buf: Buffer): 'pdf' | 'png' | 'jpeg' | 'xlsx' | 'text' | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'xlsx';
  // Text: valid UTF-8 without NUL bytes in the first 64 KB.
  const head = buf.subarray(0, 65536);
  if (head.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return 'text';
  } catch {
    return null;
  }
}

export const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  text: 'text/csv',
};
