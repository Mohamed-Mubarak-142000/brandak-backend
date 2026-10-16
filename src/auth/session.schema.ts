import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** sha256 of the current refresh secret; rotated on every refresh. */
  @Prop({ required: true })
  refreshHash: string;

  /** sha256 of the secret the current one replaced, accepted for a few seconds (concurrent refreshes). */
  @Prop()
  previousHash?: string;

  @Prop()
  rotatedAt?: Date;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  userAgent?: string;

  @Prop()
  ip?: string;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ userId: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
