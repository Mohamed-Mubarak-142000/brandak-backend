import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, normalize } from 'path';
import { Env } from '@/config/env';
import { StorageProvider, StoredObject } from './storage.provider';

export const LOCAL_UPLOAD_ROOT = join(process.cwd(), 'uploads');

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Development-only storage on the local disk. Public files are served statically from
 * /uploads/public; private files only through /api/v1/files/private?token=... (HMAC signed, expiring).
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async put({ buffer, mime, folder, isPrivate }: Parameters<StorageProvider['put']>[0]): Promise<StoredObject> {
    const visibility = isPrivate ? 'private' : 'public';
    const key = `${folder}/${randomUUID()}.${EXT[mime] ?? 'bin'}`;
    const path = join(LOCAL_UPLOAD_ROOT, visibility, key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, buffer);
    const base = this.config.get('PUBLIC_BASE_URL', { infer: true });
    return { key, url: isPrivate ? undefined : `${base}/uploads/public/${key}` };
  }

  async signedUrl(key: string, _mime: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = Buffer.from(JSON.stringify({ key, exp })).toString('base64url');
    const base = this.config.get('PUBLIC_BASE_URL', { infer: true });
    return `${base}/api/v1/files/private?token=${token}&sig=${this.sign(token)}`;
  }

  /** Returns the absolute path of a private file if the signature is valid and not expired. */
  resolveSigned(token: string, sig: string): string | null {
    const expected = Buffer.from(this.sign(token));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { key, exp } = JSON.parse(Buffer.from(token, 'base64url').toString());
      if (typeof key !== 'string' || exp < Date.now() / 1000) return null;
      const root = join(LOCAL_UPLOAD_ROOT, 'private');
      const path = normalize(join(root, key));
      return path.startsWith(root) ? path : null;
    } catch {
      return null;
    }
  }

  async remove(key: string, isPrivate: boolean) {
    await rm(join(LOCAL_UPLOAD_ROOT, isPrivate ? 'private' : 'public', key), { force: true });
  }

  private sign(value: string) {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update(value)
      .digest('base64url');
  }
}
