import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { lookup } from 'dns/promises';
import { Model, Types } from 'mongoose';
import { isIP } from 'net';
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
  [FilePurpose.REVIEW_IMAGE]: IMAGE_TYPES,
  [FilePurpose.CLAIM_IMAGE]: IMAGE_TYPES,
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

  /**
   * Downloads a public image link (product import) and stores it like a normal upload.
   * Only http(s) to public addresses, ≤ 4 MB, and real JPEG/PNG/WEBP bytes.
   */
  async importFromUrl(ownerId: string, url: string, purpose: FilePurpose) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw AppError.unprocessable('BAD_IMAGE_URL', 'Invalid image link');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !(await isPublicHost(parsed.hostname))) {
      throw AppError.unprocessable('BAD_IMAGE_URL', 'Image links must be public http(s) addresses');
    }
    const res = await fetch(parsed, { signal: AbortSignal.timeout(15_000), redirect: 'follow' }).catch(() => null);
    if (!res?.ok || !res.body) throw AppError.unprocessable('IMAGE_FETCH_FAILED', 'Could not download the image');
    if (Number(res.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES) {
      throw new AppError('FILE_TOO_LARGE', 'Files must be 4 MB or smaller', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    // Read with a hard cap: content-length can be missing or wrong.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw new AppError('FILE_TOO_LARGE', 'Files must be 4 MB or smaller', HttpStatus.PAYLOAD_TOO_LARGE);
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    return this.upload(ownerId, purpose, { buffer, size: buffer.length } as Express.Multer.File);
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

/** Refuses hosts that resolve to loopback, private, link-local or metadata addresses (SSRF). */
async function isPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return false;
  }
  return addresses.length > 0 && addresses.every((a) => !PRIVATE_RANGES.some((re) => re.test(a)));
}

const PRIVATE_RANGES = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/,
  /^::$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
  /^::ffff:(0|10|127|169\.254|192\.168)\./i,
];

export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
