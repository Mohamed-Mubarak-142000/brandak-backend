import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BillingPeriod, SubscriptionStatus } from '@/common/enums';

/** Older snapshots only have maxActiveProducts; missing limits mean "no limit". */
export interface PlanLimitsSnapshot {
  maxActiveProducts: number;
  maxOrdersPerMonth?: number | null;
  maxImagesPerProduct?: number;
}

/** Plan terms frozen at request time, so later price/limit edits don't change existing subscriptions. */
@Schema({ _id: false })
export class PlanSnapshot {
  @Prop({ required: true }) code: string;
  @Prop({ required: true }) nameAr: string;
  @Prop({ required: true }) nameEn: string;
  @Prop({ required: true }) price: number;
  @Prop({ required: true }) durationDays: number;
  @Prop({ type: Object, required: true }) limits: PlanLimitsSnapshot;
}
const PlanSnapshotSchema = SchemaFactory.createForClass(PlanSnapshot);

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SubscriptionPlan', required: true })
  planId: Types.ObjectId;

  @Prop({ type: PlanSnapshotSchema, required: true })
  planSnapshot: PlanSnapshot;

  @Prop({ type: String, enum: BillingPeriod, required: true })
  billingPeriod: BillingPeriod;

  @Prop({ type: String, enum: SubscriptionStatus, default: SubscriptionStatus.PENDING_PAYMENT })
  status: SubscriptionStatus;

  /** Set on approval. A renewal paid early starts when the previous period ends. */
  @Prop()
  startsAt?: Date;

  @Prop()
  endsAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Subscription' })
  renewalOf?: Types.ObjectId;

  @Prop()
  cancelledAt?: Date;

  createdAt: Date;
}

export type SubscriptionDocument = HydratedDocument<Subscription>;
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.index({ brandId: 1, status: 1, endsAt: -1 });
SubscriptionSchema.index({ status: 1, endsAt: 1 });
