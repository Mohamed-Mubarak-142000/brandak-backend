import { Injectable } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { round2 } from '@/commissions/commission-math';
import { AppError } from '@/common/errors';
import { paginate } from '@/common/pagination';
import { NotificationsService } from '@/notifications/notifications.service';

/** One point for every 10 EGP of delivered items (after discounts). */
export const EARN_PER_EGP = 0.1;
/** What one point takes off an order, in EGP (so 1% back). */
export const POINT_VALUE = 0.1;
/** Fewest points you can spend at once. */
export const MIN_REDEEM = 100;
/** Points can't take more than this share off the items. */
export const MAX_REDEEM_SHARE = 0.2;

export enum PointsType {
  EARN = 'EARN',
  REDEEM = 'REDEEM',
  /** Points spent on an order that was cancelled come back. */
  REFUND = 'REFUND',
  /** Points earned on items that were returned are taken back. */
  REVERSAL = 'REVERSAL',
  ADJUSTMENT = 'ADJUSTMENT',
}

@Schema({ collection: 'pointsAccounts' })
export class PointsAccount {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true }) userId: Types.ObjectId;
  @Prop({ default: 0, min: 0 }) balance: number;
}
export const PointsAccountSchema = SchemaFactory.createForClass(PointsAccount);

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'pointsEntries' })
export class PointsEntry {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true }) userId: Types.ObjectId;
  @Prop({ type: String, enum: PointsType, required: true }) type: PointsType;
  /** Positive = earned/returned, negative = spent/taken back. */
  @Prop({ required: true }) points: number;
  @Prop({ type: Types.ObjectId, ref: 'Order' }) orderId?: Types.ObjectId;
  @Prop() orderNumber?: string;
  @Prop() note?: string;
  createdAt: Date;
}
export const PointsEntrySchema = SchemaFactory.createForClass(PointsEntry);
// Each order earns once and redeems once, even if a request is replayed.
PointsEntrySchema.index({ orderId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: { $in: [PointsType.EARN, PointsType.REDEEM, PointsType.REFUND] } } });

/**
 * Fatrina points, shared by every store: earned on delivered orders, spent as a discount at any
 * store. Fatrina pays for the discount (the store is credited it, like a Fatrina coupon).
 */
@Injectable()
export class LoyaltyService {
  constructor(
    @InjectModel(PointsAccount.name) private readonly accounts: Model<PointsAccount>,
    @InjectModel(PointsEntry.name) private readonly entries: Model<PointsEntry>,
    private readonly notifications: NotificationsService,
  ) {}

  async balance(userId: string | Types.ObjectId) {
    const a = await this.accounts.findOne({ userId: new Types.ObjectId(String(userId)) }).lean();
    return a?.balance ?? 0;
  }

  async summary(userId: string) {
    const balance = await this.balance(userId);
    return { balance, value: round2(balance * POINT_VALUE), pointValue: POINT_VALUE, earnPerEgp: EARN_PER_EGP, minRedeem: MIN_REDEEM, maxRedeemShare: MAX_REDEEM_SHARE };
  }

  history(userId: string, query: { page: number; limit: number }) {
    return paginate(this.entries, { userId: new Types.ObjectId(userId) }, query, { sort: { createdAt: -1 } });
  }

  /** How many points an order can use, and the discount they give (0 when below the minimum). */
  usable(balance: number, itemsAfterOtherDiscounts: number) {
    const cap = Math.floor((itemsAfterOtherDiscounts * MAX_REDEEM_SHARE) / POINT_VALUE);
    const points = Math.min(balance, cap);
    if (points < MIN_REDEEM) return { points: 0, discount: 0 };
    return { points, discount: round2(points * POINT_VALUE) };
  }

  /** Spends points inside the checkout transaction (refuses if the balance changed meanwhile). */
  async redeem(userId: Types.ObjectId, points: number, order: { _id: Types.ObjectId; orderNumber: string }, session: ClientSession) {
    if (points <= 0) return;
    const res = await this.accounts.updateOne({ userId, balance: { $gte: points } }, { $inc: { balance: -points } }, { session });
    if (res.modifiedCount !== 1) throw AppError.conflict('POINTS_CHANGED', 'Your points balance changed, review the total');
    await this.entries.create([{ userId, type: PointsType.REDEEM, points: -points, orderId: order._id, orderNumber: order.orderNumber }], { session });
  }

  /** Points spent on an order that won't be delivered go back. */
  async refund(order: { _id: Types.ObjectId; userId: Types.ObjectId; orderNumber: string; points?: { used: number } | null }, session: ClientSession) {
    const used = order.points?.used ?? 0;
    if (used <= 0) return;
    await this.add(order.userId, used, { type: PointsType.REFUND, orderId: order._id, orderNumber: order.orderNumber }, session);
  }

  /** Earns points when an order is delivered; returns how many. */
  async earn(order: { _id: Types.ObjectId; userId: Types.ObjectId; orderNumber: string; subtotal: number; discountTotal?: number }, session: ClientSession) {
    const points = Math.floor(Math.max(0, order.subtotal - (order.discountTotal ?? 0)) * EARN_PER_EGP);
    if (points <= 0) return 0;
    await this.add(order.userId, points, { type: PointsType.EARN, orderId: order._id, orderNumber: order.orderNumber }, session);
    return points;
  }

  /** Takes back points earned on returned items (never below zero). */
  async reverseForReturn(order: { _id: Types.ObjectId; userId: Types.ObjectId; orderNumber: string; subtotal: number; points?: { earned?: number } | null }, itemsValue: number, session: ClientSession) {
    const earned = order.points?.earned ?? 0;
    if (!earned || order.subtotal <= 0) return 0;
    const back = Math.min(earned, Math.round((earned * itemsValue) / order.subtotal));
    const account = await this.accounts.findOne({ userId: order.userId }).session(session).lean();
    const take = Math.min(back, account?.balance ?? 0);
    if (take <= 0) return 0;
    await this.accounts.updateOne({ userId: order.userId }, { $inc: { balance: -take } }, { session });
    await this.entries.create([{ userId: order.userId, type: PointsType.REVERSAL, points: -take, orderId: order._id, orderNumber: order.orderNumber }], { session });
    return take;
  }

  async notifyEarned(userId: Types.ObjectId, points: number, orderNumber: string) {
    if (points <= 0) return;
    await this.notifications.notify(userId.toString(), {
      type: 'POINTS_EARNED',
      title: `كسبت ${points} نقطة`,
      body: `من طلب ${orderNumber}. نقاطك بتتصرف كخصم في أي متجر على فاترينة.`,
      data: {},
      dedupeKey: `points-${orderNumber}`,
    });
  }

  private async add(userId: Types.ObjectId, points: number, entry: { type: PointsType; orderId?: Types.ObjectId; orderNumber?: string; note?: string }, session: ClientSession) {
    await this.accounts.updateOne({ userId }, { $inc: { balance: points } }, { upsert: true, session });
    await this.entries.create([{ userId, points, ...entry }], { session });
  }
}
