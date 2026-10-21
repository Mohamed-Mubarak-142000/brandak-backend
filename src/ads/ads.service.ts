import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { CommissionsService } from '@/commissions/commissions.service';
import { FilePurpose, ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
import { normalizeReference } from '@/common/utils/text';
import { NotificationsService } from '@/notifications/notifications.service';
import { Product } from '@/products/product.schema';
import { UploadsService } from '@/uploads/uploads.service';
import { UsersService } from '@/users/users.service';
import { Ad, AdPlacement, AdStatus } from './ad.schema';

const PLACEMENT_NAMES: Record<AdPlacement, string> = {
  [AdPlacement.SEARCH_TOP]: 'أول نتايج البحث',
  [AdPlacement.CATEGORY_TOP]: 'أول القسم',
  [AdPlacement.HOME_BANNER]: 'مميز في الرئيسية',
};
/** Sponsored slots shown at once per placement. */
const SLOTS: Record<AdPlacement, number> = {
  [AdPlacement.SEARCH_TOP]: 2,
  [AdPlacement.CATEGORY_TOP]: 2,
  [AdPlacement.HOME_BANNER]: 10,
};

/**
 * Paid placements: a store buys 1–4 weeks of a product at the top of search, of its category,
 * or in the home "featured" rail. Paid by InstaPay transfer; it runs once an admin approves.
 */
@Injectable()
export class AdsService {
  constructor(
    @InjectModel(Ad.name) private readonly ads: Model<Ad>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly commissions: CommissionsService,
    private readonly uploads: UploadsService,
    private readonly users: UsersService,
    private readonly members: BrandMembersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  async prices() {
    const week = await this.commissions.adWeekPrices();
    return Object.values(AdPlacement).map((placement) => ({ placement, name: PLACEMENT_NAMES[placement], weekPrice: week[placement], slots: SLOTS[placement] }));
  }

  updatePrices(adminId: string, prices: Partial<Record<AdPlacement, number>>) {
    return this.commissions.updateAdWeekPrices(adminId, prices as Record<string, number>);
  }

  async create(userId: string, brandId: string, dto: { productId: string; placement: AdPlacement; weeks: number; proofFileId: string; transactionReference: string }) {
    const product = await this.products
      .findOne({ _id: dto.productId, brandId: new Types.ObjectId(brandId), status: ProductStatus.ACTIVE })
      .select('categoryId title')
      .lean();
    if (!product) throw AppError.unprocessable('PRODUCT_NOT_PUBLISHED', 'Only published products can be promoted');
    await this.uploads.requireOwned(userId, [dto.proofFileId], FilePurpose.PAYMENT_PROOF);
    const reference = normalizeReference(dto.transactionReference);
    if (await this.ads.exists({ transactionReferenceNormalized: reference, status: { $ne: AdStatus.REJECTED } })) {
      throw AppError.conflict('REFERENCE_ALREADY_USED', 'This transfer reference was already submitted');
    }
    const week = await this.commissions.adWeekPrices();
    const ad = await this.ads.create({
      brandId: new Types.ObjectId(brandId),
      productId: product._id,
      categoryId: product.categoryId,
      placement: dto.placement,
      weeks: dto.weeks,
      price: week[dto.placement] * dto.weeks,
      proofFileId: new Types.ObjectId(dto.proofFileId),
      transactionReference: dto.transactionReference.trim(),
      transactionReferenceNormalized: reference,
      submittedBy: new Types.ObjectId(userId),
    });
    await this.notifications.notify(await this.users.adminIds(), {
      type: 'AD_SUBMITTED',
      title: 'طلب إعلان جديد',
      body: `${PLACEMENT_NAMES[dto.placement]} · ${product.title} · ${ad.price} ج.م`,
      data: { adId: ad.id },
    });
    return this.toView(ad.toObject());
  }

  async listForBrand(brandId: string, query: { page: number; limit: number }) {
    const page = await paginate(this.ads, { brandId: new Types.ObjectId(brandId) }, query, { sort: { createdAt: -1 } });
    const titles = await this.productTitles(page.items.map((a) => a.productId));
    return new PageResult(page.items.map((a) => ({ ...this.toView(a), productTitle: titles.get(a.productId.toString()) ?? '' })), page.page, page.limit, page.total);
  }

  async listAll(query: { page: number; limit: number; status?: AdStatus }) {
    const filter: FilterQuery<Ad> = query.status ? { status: query.status } : {};
    const page = await paginate(this.ads, filter, query, { sort: { createdAt: -1 } });
    const titles = await this.productTitles(page.items.map((a) => a.productId));
    const brands = new Map(
      (await this.brands.find({ _id: { $in: page.items.map((a) => a.brandId) } }).select('name').lean()).map((b) => [b._id.toString(), b.name]),
    );
    return new PageResult(
      page.items.map((a) => ({ ...this.toView(a), productTitle: titles.get(a.productId.toString()) ?? '', brandName: brands.get(a.brandId.toString()) ?? '' })),
      page.page,
      page.limit,
      page.total,
    );
  }

  async proofUrl(adminId: string, id: string) {
    const ad = await this.ads.findById(id).lean();
    if (!ad) throw AppError.notFound('Ad');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'AD_PROOF_VIEWED', entityType: 'Ad', entityId: ad._id });
    return { url: await this.uploads.signedUrl(ad.proofFileId, 300), expiresInSeconds: 300 };
  }

  /** Starts the placement now, for the weeks paid. */
  async approve(adminId: string, id: string) {
    const now = new Date();
    const pending = await this.ads.findOne({ _id: id, status: AdStatus.PENDING_REVIEW }).lean();
    if (!pending) throw AppError.unprocessable('AD_NOT_PENDING', 'This ad is not waiting for review');
    const ad = await this.ads
      .findOneAndUpdate(
        { _id: id, status: AdStatus.PENDING_REVIEW },
        { $set: { status: AdStatus.ACTIVE, startsAt: now, endsAt: new Date(now.getTime() + pending.weeks * 7 * 86_400_000) } },
        { new: true },
      )
      .lean();
    if (!ad) throw AppError.unprocessable('AD_NOT_PENDING', 'This ad is not waiting for review');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'AD_APPROVED', entityType: 'Ad', entityId: ad._id });
    await this.notifications.notify(await this.members.memberUserIds(ad.brandId), {
      type: 'AD_APPROVED',
      title: 'إعلانك اشتغل',
      body: `${PLACEMENT_NAMES[ad.placement]} لمدة ${ad.weeks * 7} يوم`,
      data: { adId: ad._id.toString() },
    });
    return this.toView(ad);
  }

  async reject(adminId: string, id: string, reason: string) {
    const ad = await this.ads
      .findOneAndUpdate({ _id: id, status: AdStatus.PENDING_REVIEW }, { $set: { status: AdStatus.REJECTED, rejectReason: reason.trim() } }, { new: true })
      .lean();
    if (!ad) throw AppError.unprocessable('AD_NOT_PENDING', 'This ad is not waiting for review');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'AD_REJECTED', entityType: 'Ad', entityId: ad._id, data: { reason } });
    await this.notifications.notify(await this.members.memberUserIds(ad.brandId), {
      type: 'AD_REJECTED',
      title: 'طلب الإعلان اترفض',
      body: reason,
      data: { adId: ad._id.toString() },
    });
    return this.toView(ad);
  }

  /** Product ids running in a placement right now, optionally limited to some categories. */
  async runningProductIds(placement: AdPlacement, opts: { categoryIds?: Types.ObjectId[] } = {}) {
    const now = new Date();
    const filter: FilterQuery<Ad> = { placement, status: AdStatus.ACTIVE, startsAt: { $lte: now }, endsAt: { $gt: now } };
    if (opts.categoryIds?.length) filter.categoryId = { $in: opts.categoryIds };
    const ads = await this.ads.find(filter).select('_id productId').lean();
    // Rotate so every paying store gets its turn at the top.
    return shuffle(ads).map((a) => ({ adId: a._id.toString(), productId: a.productId }));
  }

  slots(placement: AdPlacement) {
    return SLOTS[placement];
  }

  async countImpressions(adIds: string[]) {
    if (adIds.length) await this.ads.updateMany({ _id: { $in: adIds } }, { $inc: { impressions: 1 } });
  }

  async click(id: string) {
    await this.ads.updateOne({ _id: id, status: AdStatus.ACTIVE }, { $inc: { clicks: 1 } });
  }

  private async productTitles(ids: Types.ObjectId[]) {
    return new Map((await this.products.find({ _id: { $in: ids } }).select('title').lean()).map((p) => [p._id.toString(), p.title]));
  }

  private toView(a: Lean<Ad>) {
    const running = a.status === AdStatus.ACTIVE && !!a.endsAt && a.endsAt.getTime() > Date.now();
    return {
      id: a._id.toString(),
      brandId: a.brandId.toString(),
      productId: a.productId.toString(),
      placement: a.placement,
      placementName: PLACEMENT_NAMES[a.placement],
      weeks: a.weeks,
      price: a.price,
      transactionReference: a.transactionReference,
      // ACTIVE ads past their end show as EXPIRED.
      status: a.status === AdStatus.ACTIVE && !running ? 'EXPIRED' : a.status,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      rejectReason: a.rejectReason,
      impressions: a.impressions,
      clicks: a.clicks,
      createdAt: a.createdAt,
    };
  }
}

function shuffle<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
