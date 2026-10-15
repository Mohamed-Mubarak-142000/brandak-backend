import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** One row per saved product, so adding/removing is a single idempotent write. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'wishlistItems' })
export class WishlistItem {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  createdAt: Date;
}

export const WishlistItemSchema = SchemaFactory.createForClass(WishlistItem);
WishlistItemSchema.index({ userId: 1, productId: 1 }, { unique: true });
WishlistItemSchema.index({ userId: 1, createdAt: -1 });
