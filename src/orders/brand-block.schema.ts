import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** A customer a store refuses to sell to (e.g. after repeated refused parcels). */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'brandBlocks' })
export class BrandBlock {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Name and phone as they appeared on the order, so the store recognises who it blocked. */
  @Prop({ type: Object, required: true })
  customer: { name: string; phone: string };

  @Prop({ default: '' })
  note: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  createdAt: Date;
}
export const BrandBlockSchema = SchemaFactory.createForClass(BrandBlock);
BrandBlockSchema.index({ brandId: 1, userId: 1 }, { unique: true });
