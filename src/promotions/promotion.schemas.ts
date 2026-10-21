import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum CouponType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

/**
 * A discount code. With a brandId it belongs to that store and the store gives the discount;
 * without one it is a Fatrina code valid in every store, and the platform pays the store back.
 */
@Schema({ timestamps: true, collection: 'coupons' })
export class Coupon {
  @Prop({ type: Types.ObjectId, ref: 'Brand', default: null })
  brandId: Types.ObjectId | null;

  /** Stored upper-case; customers can type it in any case. */
  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: String, enum: CouponType, required: true })
  type: CouponType;

  /** Percent (1–90) or EGP amount, depending on type. */
  @Prop({ required: true, min: 0 })
  value: number;

  /** Cap for percent coupons, EGP. */
  @Prop({ type: Number, default: null })
  maxDiscount: number | null;

  /** Items total needed before the code works, EGP. */
  @Prop({ default: 0 })
  minSubtotal: number;

  /** Total redemptions allowed; null = unlimited. */
  @Prop({ type: Number, default: null })
  maxUses: number | null;

  @Prop({ default: 0 })
  usedCount: number;

  @Prop({ default: 1, min: 1 })
  perUserLimit: number;

  @Prop({ required: true })
  startsAt: Date;

  @Prop({ required: true })
  endsAt: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  createdAt: Date;
}
export type CouponDocument = HydratedDocument<Coupon>;
export const CouponSchema = SchemaFactory.createForClass(Coupon);
CouponSchema.index({ brandId: 1, code: 1 }, { unique: true });

/** One use of a coupon by one order; removed again if the order is cancelled or refused. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'couponRedemptions' })
export class CouponRedemption {
  @Prop({ type: Types.ObjectId, ref: 'Coupon', required: true })
  couponId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, unique: true })
  orderId: Types.ObjectId;

  @Prop({ required: true })
  discount: number;
}
export const CouponRedemptionSchema = SchemaFactory.createForClass(CouponRedemption);
CouponRedemptionSchema.index({ couponId: 1, userId: 1 });

/** A season the admin runs (White Friday, Ramadan...). Stores join by putting products on sale in it. */
@Schema({ timestamps: true, collection: 'campaigns' })
export class Campaign {
  @Prop({ required: true, trim: true })
  nameAr: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ default: '' })
  descriptionAr: string;

  @Prop({ required: true })
  startsAt: Date;

  @Prop({ required: true })
  endsAt: Date;

  /** Smallest discount a product needs to join, percent. */
  @Prop({ default: 10, min: 1, max: 90 })
  minPercent: number;

  /** Banner colour on the home screen (hex). */
  @Prop({ default: '#F16B21' })
  color: string;

  @Prop({ default: true })
  isActive: boolean;
}
export type CampaignDocument = HydratedDocument<Campaign>;
export const CampaignSchema = SchemaFactory.createForClass(Campaign);
