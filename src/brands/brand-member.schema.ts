import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BrandMemberRole } from '@/common/enums';

@Schema({ timestamps: true, collection: 'brandMembers' })
export class BrandMember {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: BrandMemberRole, default: BrandMemberRole.OWNER })
  role: BrandMemberRole;
}

export const BrandMemberSchema = SchemaFactory.createForClass(BrandMember);
// MVP: a user manages at most one brand. Drop this index to allow several brands per user later.
BrandMemberSchema.index({ userId: 1 }, { unique: true });
BrandMemberSchema.index({ brandId: 1, userId: 1 }, { unique: true });
