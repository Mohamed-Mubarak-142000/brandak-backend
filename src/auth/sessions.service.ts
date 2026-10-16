import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Model, Types } from 'mongoose';
import { Env } from '@/config/env';
import { Session } from './session.schema';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** How long the secret a rotation replaced stays usable (covers concurrent refreshes). */
const ROTATION_GRACE_MS = 30_000;

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Returns the new session id and the opaque refresh token `<sessionId>.<secret>`. */
  async create(userId: string, meta: { userAgent?: string; ip?: string }) {
    const secret = randomBytes(32).toString('base64url');
    const session = await this.sessions.create({
      userId: new Types.ObjectId(userId),
      refreshHash: sha256(secret),
      expiresAt: this.expiry(),
      ...meta,
    });
    return { sessionId: session.id as string, refreshToken: `${session.id}.${secret}` };
  }

  /**
   * Rotates the refresh secret. Presenting an old secret for a live session means the token
   * was copied — the whole session is revoked (refresh-token reuse detection).
   *
   * The next secret is derived from the presented one, so rotation is idempotent: concurrent
   * refreshes with the same token (two tabs, parallel requests) all get the same new token
   * instead of the losers tripping reuse detection. The just-replaced secret is accepted only
   * for ROTATION_GRACE_MS and only while it is still the latest rotation.
   */
  async rotate(refreshToken: string) {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret || !Types.ObjectId.isValid(sessionId)) return null;
    const now = new Date();
    const live = { _id: sessionId, revokedAt: { $exists: false }, expiresAt: { $gt: now } };

    const presentedHash = sha256(secret);
    const next = this.deriveNext(sessionId, secret);
    const nextHash = sha256(next);
    const result = { sessionId, refreshToken: `${sessionId}.${next}` };

    // Atomic compare-and-swap: only one concurrent caller performs the rotation.
    const rotated = await this.sessions.findOneAndUpdate(
      { ...live, refreshHash: presentedHash },
      { $set: { refreshHash: nextHash, previousHash: presentedHash, rotatedAt: now, expiresAt: this.expiry() } },
      { new: true },
    );
    if (rotated) return { ...result, userId: rotated.userId.toString() };

    const session = await this.sessions.findOne(live);
    if (!session) return null;

    const inGrace =
      !!session.previousHash &&
      !!session.rotatedAt &&
      now.getTime() - session.rotatedAt.getTime() <= ROTATION_GRACE_MS &&
      safeEqual(session.previousHash, presentedHash) &&
      safeEqual(session.refreshHash, nextHash);
    if (inGrace) return { ...result, userId: session.userId.toString() };

    await this.sessions.updateOne({ _id: sessionId }, { $set: { revokedAt: now } });
    return null;
  }

  private deriveNext(sessionId: string, secret: string) {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET', { infer: true }))
      .update(`refresh-rotation:${sessionId}:${secret}`)
      .digest('base64url');
  }

  async isActive(sessionId: string, userId: string) {
    if (!Types.ObjectId.isValid(sessionId)) return false;
    const exists = await this.sessions.exists({
      _id: sessionId,
      userId: new Types.ObjectId(userId),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    return !!exists;
  }

  async revoke(sessionId: string) {
    await this.sessions.updateOne({ _id: sessionId }, { $set: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.sessions.updateMany(
      {
        userId: new Types.ObjectId(userId),
        revokedAt: { $exists: false },
        ...(exceptSessionId ? { _id: { $ne: new Types.ObjectId(exceptSessionId) } } : {}),
      },
      { $set: { revokedAt: new Date() } },
    );
  }

  private expiry() {
    const days = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
