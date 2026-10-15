import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FilePurpose, FileVisibility } from '@/common/enums';
import { AppError } from '@/common/errors';
import { StoredFile, StoredFileDocument } from './file.schema';
import { STORAGE_PROVIDER, StorageProvider } from './storage.provider';

// Vercel rejects request bodies above 4.5 MB, so stay below it.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED: Record<FilePurpose, string[]> = {
  [FilePurpose.PRODUCT_IMAGE]: IMAGE_TYPES,
  [FilePurpose.BRAND_LOGO]: IMAGE_TYPES,
  [FilePurpose.BRAND_COVER]: IMAGE_TYPES,
  [FilePurpose.PAYMENT_PROOF]: [...IMAGE_TYPES, 'application/pdf'],
};
const PRIVATE_PURPOSES = [FilePurpose.PAYMENT_PROOF];

export interface ImageRef {
  fileId: Types.ObjectId;
  url: string;
}

@Injectable()
export class UploadsService {
  constructor(
    @InjectModel(StoredFile.name) private readonly files: Model<StoredFile>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async upload(ownerId: string, purpose: FilePurpose, file?: Express.Multer.File) {
    if (!file) throw AppError.unprocessable('FILE_REQUIRED', 'A file is required');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError('FILE_TOO_LARGE', 'Files must be 4 MB or smaller', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    // Trust the bytes, not the client-declared content type.
    const mime = sniffMime(file.buffer);
    if (!mime || !ALLOWED[purpose].includes(mime)) {
      throw AppError.unprocessable('FILE_TYPE_NOT_ALLOWED', `Allowed types: ${ALLOWED[purpose].join(', ')}`);
    }
    const isPrivate = PRIVATE_PURPOSES.includes(purpose);
    const stored = await this.storage.put({
      buffer: file.buffer,
      mime,
      folder: purpose.toLowerCase(),
      isPrivate,
    });
    const doc = await this.files.create({
      ownerId: new Types.ObjectId(ownerId),
      purpose,
      visibility: isPrivate ? FileVisibility.PRIVATE : FileVisibility.PUBLIC,
      key: stored.key,
      url: stored.url,
      mime,
      size: file.size,
    });
    return { id: doc.id as string, purpose, url: doc.url ?? null, mime, size: doc.size };
  }

  /** Loads files and checks they were uploaded by `ownerId` for `purpose`. */
  async requireOwned(ownerId: string, ids: string[], purpose: FilePurpose): Promise<StoredFileDocument[]> {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !Types.ObjectId.isValid(id))) throw this.invalidFiles();
    const docs = await this.files.find({
      _id: { $in: unique },
      ownerId: new Types.ObjectId(ownerId),
      purpose,
    });
    if (docs.length !== unique.length) throw this.invalidFiles();
    return unique.map((id) => docs.find((d) => d.id === id)!);
  }

  /** Resolves public image file ids to `{ fileId, url }` refs stored on brands/products. */
  async imageRefs(ownerId: string, ids: string[], purpose: FilePurpose): Promise<ImageRef[]> {
    const docs = await this.requireOwned(ownerId, ids, purpose);
    return docs.map((d) => ({ fileId: d._id, url: d.url! }));
  }

  async signedUrl(fileId: Types.ObjectId | string, ttlSeconds = 300) {
    const file = await this.files.findById(fileId);
    if (!file) throw AppError.notFound('File');
    if (file.visibility === FileVisibility.PUBLIC) return file.url!;
    return this.storage.signedUrl(file.key, file.mime, ttlSeconds);
  }

  private invalidFiles() {
    return AppError.unprocessable('INVALID_FILES', 'One or more files are missing or not yours');
  }
}

export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
