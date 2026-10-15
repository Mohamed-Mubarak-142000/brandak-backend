export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StoredObject {
  /** Provider-specific key used for signed URLs and deletion. */
  key: string;
  /** Permanent URL for public objects; undefined for private ones. */
  url?: string;
}

export interface StorageProvider {
  put(input: {
    buffer: Buffer;
    mime: string;
    folder: string;
    isPrivate: boolean;
  }): Promise<StoredObject>;
  /** Short-lived URL for a private object. */
  signedUrl(key: string, mime: string, ttlSeconds: number): Promise<string>;
  remove(key: string, isPrivate: boolean): Promise<void>;
}
