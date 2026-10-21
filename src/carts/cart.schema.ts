import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Prices are intentionally not stored: they are always read fresh from the product. */
@Schema({ timestamps: true })
export class CartItem {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  variantId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  quantity: number;
}
const CartItemSchema = SchemaFactory.createForClass(CartItem);

/** One cart per customer per brand — each brand's cart becomes its own order. */
@Schema({ timestamps: true })
export class Cart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: [CartItemSchema], default: [] })
  items: CartItem[];

  /** Last abandoned-cart reminder; a cart changed after it can be reminded again. */
  @Prop({ type: Date, default: null })
  remindedAt: Date | null;

  updatedAt: Date;
}

export type CartDocument = HydratedDocument<Cart>;
export const CartSchema = SchemaFactory.createForClass(Cart);
CartSchema.index({ userId: 1, brandId: 1 }, { unique: true });
CartSchema.index({ userId: 1, updatedAt: -1 });
