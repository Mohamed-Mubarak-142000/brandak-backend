import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum WatchType {
  /** Tell me when the price goes below what it was when I asked. */
  PRICE_DROP = 'PRICE_DROP',
  /** Tell me when this size/colour (or the product) is back in stock. */
  BACK_IN_STOCK = 'BACK_IN_STOCK',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'watches' })
export class Watch {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true }) productId: Types.ObjectId;
  /** A specific size/colour; null = the product as a whole. */
  @Prop({ type: Types.ObjectId, default: null }) variantId: Types.ObjectId | null;
  @Prop({ type: String, enum: WatchType, required: true }) type: WatchType;
  /** PRICE_DROP: the price to beat (lowered after each alert). */
  @Prop({ type: Number, default: null }) price: number | null;
  createdAt: Date;
}
export const WatchSchema = SchemaFactory.createForClass(Watch);
WatchSchema.index({ userId: 1, productId: 1, variantId: 1, type: 1 }, { unique: true });

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'follows' })
export class Follow {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true, index: true }) brandId: Types.ObjectId;
  createdAt: Date;
}
export const FollowSchema = SchemaFactory.createForClass(Follow);
FollowSchema.index({ userId: 1, brandId: 1 }, { unique: true });
