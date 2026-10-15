import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Model, Types } from 'mongoose';
import { Env } from '@/config/env';
import { Session } from './session.schema';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

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
   */
  async rotate(refreshToken: string) {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret || !Types.ObjectId.isValid(sessionId)) return null;
    const session = await this.sessions.findById(sessionId);
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

    const presented = Buffer.from(sha256(secret));
    const stored = Buffer.from(session.refreshHash);
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
      session.revokedAt = new Date();
      await session.save();
      return null;
    }

    const next = randomBytes(32).toString('base64url');
    session.refreshHash = sha256(next);
    session.expiresAt = this.expiry();
    await session.save();
    return { sessionId, userId: session.userId.toString(), refreshToken: `${sessionId}.${next}` };
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
