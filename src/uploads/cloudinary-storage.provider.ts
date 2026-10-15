import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Env } from '@/config/env';
import { StorageProvider, StoredObject } from './storage.provider';

/**
 * Public files use the normal `upload` delivery type. Private files (payment receipts) use the
 * `authenticated` type, which Cloudinary refuses to serve without a signed, expiring URL.
 */
@Injectable()
export class CloudinaryStorageProvider implements StorageProvider {
  constructor(config: ConfigService<Env, true>) {
    cloudinary.config({
      cloud_name: config.get('CLOUDINARY_CLOUD_NAME', { infer: true }),
      api_key: config.get('CLOUDINARY_API_KEY', { infer: true }),
      api_secret: config.get('CLOUDINARY_API_SECRET', { infer: true }),
      secure: true,
    });
  }

  put({ buffer, mime, folder, isPrivate }: Parameters<StorageProvider['put']>[0]): Promise<StoredObject> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `brandak/${folder}`,
          type: isPrivate ? 'authenticated' : 'upload',
          resource_type: mime === 'application/pdf' ? 'raw' : 'image',
        },
        (error, result?: UploadApiResponse) => {
          if (error || !result) return reject(error ?? new Error('Upload failed'));
          resolve({ key: result.public_id, url: isPrivate ? undefined : result.secure_url });
        },
      );
      stream.end(buffer);
    });
  }

  async signedUrl(key: string, mime: string, ttlSeconds: number) {
    return cloudinary.utils.private_download_url(key, mime === 'application/pdf' ? '' : 'jpg', {
      type: 'authenticated',
      resource_type: mime === 'application/pdf' ? 'raw' : 'image',
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  }

  async remove(key: string, isPrivate: boolean) {
    await cloudinary.uploader.destroy(key, { type: isPrivate ? 'authenticated' : 'upload', invalidate: true });
  }
}
