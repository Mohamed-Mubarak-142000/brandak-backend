import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum ReturnStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  /** The store got the items back. */
  RECEIVED = 'RECEIVED',
  /** The store gave the money back; the commission on these items is reversed. */
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export enum ReturnReason {
  WRONG_SIZE = 'WRONG_SIZE',
  DAMAGED = 'DAMAGED',
  NOT_AS_DESCRIBED = 'NOT_AS_DESCRIBED',
  WRONG_ITEM = 'WRONG_ITEM',
  CHANGED_MIND = 'CHANGED_MIND',
  OTHER = 'OTHER',
}

/** Requests that still hold their items (so they can't be asked for twice). */
export const HOLDING_STATUSES = [ReturnStatus.REQUESTED, ReturnStatus.APPROVED, ReturnStatus.RECEIVED, ReturnStatus.REFUNDED];

@Schema({ _id: false })
export class ReturnItem {
  @Prop({ type: Types.ObjectId, required: true }) productId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) variantId: Types.ObjectId;
  @Prop({ required: true }) title: string;
  @Prop() imageUrl?: string;
  @Prop() size?: string;
  @Prop() color?: string;
  @Prop({ required: true }) unitPrice: number;
  @Prop({ required: true, min: 1 }) quantity: number;
}
const ReturnItemSchema = SchemaFactory.createForClass(ReturnItem);

@Schema({ _id: false })
export class ReturnEvent {
  @Prop({ type: String, enum: ReturnStatus, required: true }) status: ReturnStatus;
  @Prop({ required: true }) at: Date;
  @Prop({ required: true }) actor: 'CUSTOMER' | 'BRAND' | 'ADMIN';
  @Prop() note?: string;
}
const ReturnEventSchema = SchemaFactory.createForClass(ReturnEvent);

@Schema({ timestamps: true, collection: 'returns' })
export class ReturnRequest {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({ required: true })
  orderNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  customerName: string;

  @Prop({ type: [ReturnItemSchema], required: true })
  items: ReturnItem[];

  @Prop({ type: String, enum: ReturnReason, required: true })
  reason: ReturnReason;

  @Prop({ default: '' })
  note: string;

  @Prop({ type: [{ fileId: Types.ObjectId, url: String, _id: false }], default: [] })
  images: { fileId: Types.ObjectId; url: string }[];

  /** What the customer gets back for these items (after any store coupon share). */
  @Prop({ required: true })
  refundAmount: number;

  @Prop({ type: String, enum: ReturnStatus, default: ReturnStatus.REQUESTED })
  status: ReturnStatus;

  @Prop({ type: [ReturnEventSchema], default: [] })
  history: ReturnEvent[];

  /** Commission given back to the store when refunded. */
  @Prop({ default: 0 })
  commissionReversed: number;

  createdAt: Date;
  updatedAt: Date;
}
export const ReturnRequestSchema = SchemaFactory.createForClass(ReturnRequest);
ReturnRequestSchema.index({ brandId: 1, status: 1, createdAt: -1 });
ReturnRequestSchema.index({ userId: 1, createdAt: -1 });
