import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OrderPaymentMethod, OrderStatus } from '@/common/enums';

/** Everything a historical invoice needs, frozen at checkout. */
@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true }) productId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) variantId: Types.ObjectId;
  @Prop({ required: true }) title: string;
  @Prop() imageUrl?: string;
  @Prop() size?: string;
  @Prop() color?: string;
  @Prop() sku?: string;
  @Prop({ required: true }) unitPrice: number;
  @Prop({ required: true }) quantity: number;
  @Prop({ required: true }) lineTotal: number;
}
const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ _id: false })
export class StatusChange {
  @Prop({ type: String, enum: OrderStatus, required: true }) status: OrderStatus;
  @Prop({ required: true }) at: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) by?: Types.ObjectId;
  @Prop({ required: true }) actor: 'CUSTOMER' | 'BRAND' | 'ADMIN' | 'SYSTEM';
  @Prop() note?: string;
}
const StatusChangeSchema = SchemaFactory.createForClass(StatusChange);

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true, unique: true })
  orderNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Object, required: true })
  brandSnapshot: { name: string; slug: string; phone?: string };

  @Prop({ type: Object, required: true })
  customer: { name: string; phone: string };

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  /** Delivery address; null for orders collected from the store. */
  @Prop({ type: Object, default: null })
  addressSnapshot: Record<string, unknown> | null;

  @Prop({ default: 'DELIVERY' })
  fulfillment: 'DELIVERY' | 'PICKUP';

  /** Where to collect a PICKUP order, copied from the store at checkout. */
  @Prop({ type: Object, default: null })
  pickup: { address: string; governorate: string | null; hours: string; mapUrl: string } | null;

  /** Coupon used on the order; fundedBy says who pays for the discount. */
  @Prop({ type: Object })
  coupon?: { couponId: Types.ObjectId; code: string; discount: number; fundedBy: 'BRAND' | 'PLATFORM' };

  /** Filled by the store when it ships: carrier, tracking number and (optionally) a tracking link. */
  @Prop({ type: Object })
  shipment?: { carrier: string; trackingNumber: string; trackingUrl?: string | null; shippedAt: Date };

  /** Platform commission charged when the order was delivered. */
  @Prop({ type: Object })
  commission?: { rate: number; base: number; amount: number };

  @Prop({ required: true }) subtotal: number;
  @Prop({ required: true }) shippingFee: number;
  @Prop({ default: 0 }) discountTotal: number;
  @Prop({ required: true }) grandTotal: number;
  @Prop({ default: 'EGP' }) currency: string;

  @Prop({ type: String, enum: OrderPaymentMethod, default: OrderPaymentMethod.COD })
  paymentMethod: OrderPaymentMethod;

  /** Cash on delivery: becomes PAID when the brand marks the order delivered. */
  @Prop({ default: 'UNPAID' })
  paymentStatus: 'UNPAID' | 'PAID';

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Prop({ type: [StatusChangeSchema], default: [] })
  statusHistory: StatusChange[];

  @Prop()
  cancelReason?: string;

  @Prop({ default: '' })
  notes: string;

  @Prop({ required: true })
  idempotencyKey: string;

  @Prop()
  deliveredAt?: Date;

  /** Soft delete: hidden from every list and stat; restore unsets it. */
  @Prop()
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deletedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<Order>;
export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ brandId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ brandId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ userId: 1, 'items.productId': 1, status: 1 });

@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String })
  _id: string;

  @Prop({ default: 0 })
  seq: number;
}
export const CounterSchema = SchemaFactory.createForClass(Counter);
