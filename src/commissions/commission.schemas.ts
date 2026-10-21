import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** One document (key "default") holding the platform's commission terms, editable by admins. */
@Schema({ timestamps: true, collection: 'platformSettings' })
export class PlatformSettings {
  @Prop({ required: true, unique: true, default: 'default' })
  key: string;

  /** Share of the items total (after discounts, excluding shipping) taken on each delivered order. */
  @Prop({ required: true, min: 0, max: 0.5, default: 0.05 })
  commissionRate: number;

  /** Days a store has to settle what it owes before it stops receiving orders. */
  @Prop({ required: true, min: 1, default: 14 })
  settlementDays: number;

  /** Owed amount (EGP) above which the store stops receiving orders until it pays. */
  @Prop({ required: true, min: 0, default: 2000 })
  maxUnpaidBalance: number;

  /** Price (EGP) of one week of each paid placement. */
  @Prop({ type: Object, default: () => ({ SEARCH_TOP: 150, CATEGORY_TOP: 100, HOME_BANNER: 300 }) })
  adWeekPrices: Record<string, number>;
}
export const PlatformSettingsSchema = SchemaFactory.createForClass(PlatformSettings);

export enum LedgerType {
  /** Commission on a delivered cash order: the store owes it. */
  COMMISSION = 'COMMISSION',
  /** Commission given back (returned items, admin correction). */
  REVERSAL = 'REVERSAL',
  /** A settlement the admin approved: the store paid. */
  PAYMENT = 'PAYMENT',
  ADJUSTMENT = 'ADJUSTMENT',
  /** A reseller's margin the store collected with the order; Fatrina pays it to the reseller. */
  RESELLER_MARGIN = 'RESELLER_MARGIN',
}

/** Running account between a store and the platform. Positive amounts are owed by the store. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'ledger' })
export class LedgerEntry {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true, index: true })
  brandId: Types.ObjectId;

  @Prop({ type: String, enum: LedgerType, required: true })
  type: LedgerType;

  /** EGP; positive = store owes the platform, negative = credit to the store. */
  @Prop({ required: true })
  amount: number;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderId?: Types.ObjectId;

  @Prop()
  orderNumber?: string;

  @Prop({ type: Types.ObjectId, ref: 'Settlement' })
  settlementId?: Types.ObjectId;

  /** Commission details for COMMISSION entries. */
  @Prop() rate?: number;
  @Prop() base?: number;

  @Prop()
  note?: string;

  createdAt: Date;
}
export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);
// One commission per order, even if a delivery is replayed.
LedgerEntrySchema.index({ orderId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: LedgerType.COMMISSION } });

export enum SettlementStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** A store paying what it owes by InstaPay transfer, reviewed by an admin. */
@Schema({ timestamps: true, collection: 'settlements' })
export class Settlement {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true, index: true })
  brandId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  amount: number;

  @Prop({ type: Types.ObjectId, ref: 'StoredFile', required: true })
  proofFileId: Types.ObjectId;

  @Prop({ required: true })
  transactionReference: string;

  @Prop({ required: true, index: true })
  transactionReferenceNormalized: string;

  @Prop({ type: String, enum: SettlementStatus, default: SettlementStatus.PENDING_REVIEW })
  status: SettlementStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' }) submittedBy: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) reviewedBy?: Types.ObjectId;
  @Prop() reviewedAt?: Date;
  @Prop() rejectionReason?: string;

  createdAt: Date;
}
export type SettlementDocument = HydratedDocument<Settlement>;
export const SettlementSchema = SchemaFactory.createForClass(Settlement);
