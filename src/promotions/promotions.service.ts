import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { AppError } from '@/common/errors';
import { couponDiscount } from './price-math';
import { Campaign, Coupon, CouponRedemption, CouponType } from './promotion.schemas';

export interface CouponInput {
  code: string;
  type: CouponType;
  value: number;
  maxDiscount?: number | null;
  minSubtotal?: number;
  maxUses?: number | null;
  perUserLimit?: number;
  startsAt?: string;
  endsAt: string;
  isActive?: boolean;
}

export interface AppliedCoupon {
  couponId: Types.ObjectId;
  code: string;
  discount: number;
  /** Who pays for the discount: the store (its own code) or the platform (a Fatrina code). */
  fundedBy: 'BRAND' | 'PLATFORM';
}

export interface CampaignInput {
  nameAr: string;
  slug: string;
  descriptionAr?: string;
  startsAt: string;
  endsAt: string;
  minPercent?: number;
  color?: string;
  isActive?: boolean;
}

const normCode = (code: string) => code.trim().toUpperCase();

@Injectable()
export class PromotionsService {
  constructor(
    @InjectModel(Coupon.name) private readonly coupons: Model<Coupon>,
    @InjectModel(CouponRedemption.name) private readonly redemptions: Model<CouponRedemption>,
    @InjectModel(Campaign.name) private readonly campaigns: Model<Campaign>,
    private readonly audit: AuditLogsService,
  ) {}

  // ---------- Coupons: management ----------

  /** brandId null = Fatrina-wide codes managed by admins. */
  listCoupons(brandId: string | null) {
    return this.coupons.find({ brandId: brandId ? new Types.ObjectId(brandId) : null }).sort({ createdAt: -1 }).lean();
  }

  async createCoupon(userId: string, brandId: string | null, dto: CouponInput) {
    this.assertCouponTerms(dto);
    try {
      const c = await this.coupons.create({
        ...dto,
        code: normCode(dto.code),
        brandId: brandId ? new Types.ObjectId(brandId) : null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: new Date(dto.endsAt),
        createdBy: new Types.ObjectId(userId),
      });
      if (!brandId) await this.audit.log({ actorId: userId, actorType: 'ADMIN', action: 'COUPON_CREATED', entityType: 'Coupon', entityId: c._id, data: { code: c.code } });
      return c.toObject();
    } catch (e: any) {
      if (e?.code === 11000) throw AppError.conflict('COUPON_CODE_TAKEN', 'This code already exists');
      throw e;
    }
  }

  async updateCoupon(brandId: string | null, id: string, dto: Partial<CouponInput>) {
    const c = await this.coupons.findOne({ _id: id, brandId: brandId ? new Types.ObjectId(brandId) : null });
    if (!c) throw AppError.notFound('Coupon');
    const next = { type: c.type, value: c.value, startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString(), code: c.code, ...dto };
    this.assertCouponTerms(next);
    // The code itself never changes once people may have it.
    const rest: Partial<CouponInput> = { ...dto };
    delete rest.code;
    Object.assign(c, rest, {
      ...(dto.startsAt ? { startsAt: new Date(dto.startsAt) } : {}),
      ...(dto.endsAt ? { endsAt: new Date(dto.endsAt) } : {}),
    });
    await c.save();
    return c.toObject();
  }

  // ---------- Coupons: checkout ----------

  /**
   * The coupon a customer typed, checked against this store and order. The store's own code wins
   * over a Fatrina code with the same text. Throws with a reason the app can show.
   */
  async resolve(code: string, brandId: Types.ObjectId, userId: string, subtotal: number, now = new Date()): Promise<AppliedCoupon> {
    const c =
      (await this.coupons.findOne({ brandId, code: normCode(code) }).lean()) ??
      (await this.coupons.findOne({ brandId: null, code: normCode(code) }).lean());
    if (!c || !c.isActive) throw AppError.unprocessable('COUPON_INVALID', 'This code is not valid');
    if (now < c.startsAt) throw AppError.unprocessable('COUPON_NOT_STARTED', 'This code is not active yet');
    if (now >= c.endsAt) throw AppError.unprocessable('COUPON_EXPIRED', 'This code has expired');
    if (subtotal < c.minSubtotal) {
      throw AppError.unprocessable('COUPON_MIN_SUBTOTAL', `Minimum order for this code is ${c.minSubtotal} EGP`, [
        { field: 'couponCode', reason: `min_${c.minSubtotal}` },
      ]);
    }
    if (c.maxUses != null && c.usedCount >= c.maxUses) throw AppError.unprocessable('COUPON_USED_UP', 'This code was used up');
    const mine = await this.redemptions.countDocuments({ couponId: c._id, userId: new Types.ObjectId(userId) });
    if (mine >= c.perUserLimit) throw AppError.unprocessable('COUPON_ALREADY_USED', 'You already used this code');
    return { couponId: c._id, code: c.code, discount: couponDiscount(c, subtotal), fundedBy: c.brandId ? 'BRAND' : 'PLATFORM' };
  }

  /** Records the use inside the order transaction; the conditional increment stops overuse. */
  async redeem(applied: AppliedCoupon, userId: Types.ObjectId, orderId: Types.ObjectId, session: ClientSession) {
    const ok = await this.coupons.updateOne(
      { _id: applied.couponId, $or: [{ maxUses: null }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }] },
      { $inc: { usedCount: 1 } },
      { session },
    );
    if (ok.modifiedCount !== 1) throw AppError.unprocessable('COUPON_USED_UP', 'This code was used up');
    await this.redemptions.create([{ couponId: applied.couponId, userId, orderId, discount: applied.discount }], { session });
  }

  /** Gives the use back when an order is cancelled or refused. */
  async release(orderId: Types.ObjectId, session: ClientSession) {
    const r = await this.redemptions.findOneAndDelete({ orderId }, { session });
    if (r) await this.coupons.updateOne({ _id: r.couponId }, { $inc: { usedCount: -1 } }, { session });
  }

  // ---------- Campaigns (seasons) ----------

  /** Running and upcoming seasons, for the home banner and the sale picker. */
  activeCampaigns(now = new Date()) {
    return this.campaigns.find({ isActive: true, endsAt: { $gt: now } }).sort({ startsAt: 1 }).lean();
  }

  async campaignBySlug(slug: string) {
    const c = await this.campaigns.findOne({ slug: slug.toLowerCase(), isActive: true }).lean();
    if (!c) throw AppError.notFound('Campaign');
    return c;
  }

  listCampaigns() {
    return this.campaigns.find().sort({ startsAt: -1 }).lean();
  }

  async createCampaign(adminId: string, dto: CampaignInput) {
    this.assertWindow(dto.startsAt, dto.endsAt);
    try {
      const c = await this.campaigns.create({ ...dto, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt) });
      await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'CAMPAIGN_CREATED', entityType: 'Campaign', entityId: c._id, data: { slug: c.slug } });
      return c.toObject();
    } catch (e: any) {
      if (e?.code === 11000) throw AppError.conflict('CAMPAIGN_SLUG_TAKEN', 'This slug already exists');
      throw e;
    }
  }

  async updateCampaign(adminId: string, id: string, dto: Partial<CampaignInput>) {
    const c = await this.campaigns.findById(id);
    if (!c) throw AppError.notFound('Campaign');
    const startsAt = dto.startsAt ?? c.startsAt.toISOString();
    const endsAt = dto.endsAt ?? c.endsAt.toISOString();
    this.assertWindow(startsAt, endsAt);
    Object.assign(c, dto, { startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
    await c.save();
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'CAMPAIGN_UPDATED', entityType: 'Campaign', entityId: c._id, data: dto });
    return c.toObject();
  }

  /** A product sale joining a season must fit inside it and give at least its minimum discount. */
  async assertSaleFitsCampaign(campaignId: string, sale: { percent: number; startsAt: Date; endsAt: Date }) {
    const c = await this.campaigns.findOne({ _id: campaignId, isActive: true }).lean();
    if (!c) throw AppError.unprocessable('CAMPAIGN_INVALID', 'This season is not running');
    if (sale.percent < c.minPercent) {
      throw AppError.unprocessable('CAMPAIGN_MIN_PERCENT', `This season needs at least ${c.minPercent}% off`, [
        { field: 'sale.percent', reason: `min_${c.minPercent}` },
      ]);
    }
    if (sale.startsAt < c.startsAt || sale.endsAt > c.endsAt) {
      throw AppError.unprocessable('CAMPAIGN_WINDOW', 'The sale must be inside the season dates');
    }
  }

  // ---------- Helpers ----------

  private assertCouponTerms(dto: { type: CouponType; value: number; startsAt?: string; endsAt: string }) {
    if (dto.type === CouponType.PERCENT && (dto.value < 1 || dto.value > 90)) {
      throw AppError.unprocessable('COUPON_VALUE', 'Percent coupons are between 1 and 90');
    }
    if (dto.type === CouponType.FIXED && dto.value < 1) throw AppError.unprocessable('COUPON_VALUE', 'Amount must be at least 1 EGP');
    this.assertWindow(dto.startsAt ?? new Date().toISOString(), dto.endsAt);
  }

  private assertWindow(startsAt: string, endsAt: string) {
    if (new Date(endsAt) <= new Date(startsAt)) throw AppError.unprocessable('INVALID_DATES', 'The end must be after the start');
  }

}
