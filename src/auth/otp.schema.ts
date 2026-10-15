import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { OtpPurpose } from '@/common/enums';

@Schema({ timestamps: true })
export class Otp {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: OtpPurpose, required: true })
  purpose: OtpPurpose;

  @Prop({ required: true, enum: ['email', 'phone'] })
  channel: 'email' | 'phone';

  @Prop({ required: true })
  codeHash: string;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  consumedAt?: Date;

  createdAt: Date;
}

export const OtpSchema = SchemaFactory.createForClass(Otp);
OtpSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
