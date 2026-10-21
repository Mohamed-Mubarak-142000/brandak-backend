import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'resellers' })
export class Reseller {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true }) userId: Types.ObjectId;
  @Prop({ default: 'ACTIVE' }) status: 'ACTIVE' | 'SUSPENDED';
  /** InstaPay address (or wallet number) Fatrina pays earnings to. */
  @Prop({ required: true }) payoutAddress: string;
  @Prop({ required: true }) payoutName: string;
  createdAt: Date;
}
export const ResellerSchema = SchemaFactory.createForClass(Reseller);

export enum EarningStatus {
  /** The order isn't delivered yet. */
  PENDING = 'PENDING',
  AVAILABLE = 'AVAILABLE',
  /** Part of a payout request under review. */
  REQUESTED = 'REQUESTED',
  PAID = 'PAID',
  /** The order was cancelled or refused: nothing earned. */
  CANCELLED = 'CANCELLED',
}

/** A reseller's margin on one order: their selling price minus the store's price. */
@Schema({ timestamps: true, collection: 'resellerEarnings' })
export class ResellerEarning {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true }) resellerId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, unique: true }) orderId: Types.ObjectId;
  @Prop({ required: true }) orderNumber: string;
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true }) brandId: Types.ObjectId;
  @Prop({ required: true }) amount: number;
  @Prop({ type: String, enum: EarningStatus, default: EarningStatus.PENDING }) status: EarningStatus;
  @Prop({ type: Types.ObjectId, ref: 'ResellerPayout', default: null }) payoutId: Types.ObjectId | null;
  createdAt: Date;
}
export const ResellerEarningSchema = SchemaFactory.createForClass(ResellerEarning);

@Schema({ timestamps: true, collection: 'resellerPayouts' })
export class ResellerPayout {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true }) resellerId: Types.ObjectId;
  @Prop({ required: true }) amount: number;
  @Prop({ required: true }) payoutAddress: string;
  @Prop({ required: true }) payoutName: string;
  @Prop({ default: 'REQUESTED' }) status: 'REQUESTED' | 'PAID' | 'REJECTED';
  @Prop({ type: String, default: null }) reference: string | null;
  @Prop({ type: String, default: null }) rejectReason: string | null;
  createdAt: Date;
}
export const ResellerPayoutSchema = SchemaFactory.createForClass(ResellerPayout);
ResellerPayoutSchema.index({ status: 1, createdAt: -1 });
