import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CONTACT_CHANNEL, ContactChannel } from '@/auth/contact-channel';
import { Brand } from '@/brands/brand.schema';
import { ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean } from '@/common/pagination';
import { IMAGE_WIDTH, optimizedImage } from '@/common/utils/image';
import { NotificationsService } from '@/notifications/notifications.service';
import { Product } from '@/products/product.schema';
import { unitPriceNow } from '@/promotions/price-math';
import { UsersService } from '@/users/users.service';
import { Follow, Watch, WatchType } from './alert.schemas';

const MAX_WATCHES = 100;

/**
 * Price-drop and back-in-stock alerts, and following stores. Product changes call `check` so
 * alerts go out right away; the daily cron re-checks for sales that started on their own.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectModel(Watch.name) private readonly watches: Model<Watch>,
    @InjectModel(Follow.name) private readonly follows: Model<Follow>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    @Inject(CONTACT_CHANNEL) private readonly mail: ContactChannel,
  ) {}

  // ---------- Watches ----------

  async watch(userId: string, productId: string, type: WatchType, variantId?: string) {
    const product = await this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE }).lean();
    if (!product) throw AppError.notFound('Product');
    const variant = variantId ? product.variants.find((v) => v._id.toString() === variantId) : null;
    if (variantId && !variant) throw AppError.notFound('Variant');
    if (type === WatchType.BACK_IN_STOCK && (variant ? variant.stock > 0 : product.totalStock > 0)) {
      throw AppError.unprocessable('ALREADY_IN_STOCK', 'This is in stock, you can order it now');
    }
    if ((await this.watches.countDocuments({ userId: new Types.ObjectId(userId) })) >= MAX_WATCHES) {
      throw AppError.unprocessable('TOO_MANY_ALERTS', `Up to ${MAX_WATCHES} alerts`);
    }
    const price = type === WatchType.PRICE_DROP ? currentPrice(product, variant) : null;
    await this.watches.updateOne(
      { userId: new Types.ObjectId(userId), productId: product._id, variantId: variant?._id ?? null, type },
      { $set: { price } },
      { upsert: true },
    );
    return { productId, variantId: variantId ?? null, type, price };
  }

  async unwatch(userId: string, productId: string, type: WatchType, variantId?: string) {
    await this.watches.deleteOne({
      userId: new Types.ObjectId(userId),
      productId: new Types.ObjectId(productId),
      variantId: variantId ? new Types.ObjectId(variantId) : null,
      type,
    });
  }

  /** The viewer's alerts on one product (for the product page buttons). */
  async mineFor(userId: string, productId: string) {
    const rows = await this.watches.find({ userId: new Types.ObjectId(userId), productId: new Types.ObjectId(productId) }).lean();
    return rows.map((w) => ({ type: w.type, variantId: w.variantId?.toString() ?? null, price: w.price }));
  }

  async listMine(userId: string) {
    const rows = await this.watches.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).lean();
    const products = new Map(
      (await this.products.find({ _id: { $in: rows.map((w) => w.productId) } }).select('title images price sale variants totalStock status').lean()).map((p) => [
        p._id.toString(),
        p,
      ]),
    );
    return rows.flatMap((w) => {
      const p = products.get(w.productId.toString());
      if (!p) return [];
      const v = w.variantId ? p.variants.find((x) => x._id.equals(w.variantId!)) : null;
      return [
        {
          type: w.type,
          productId: p._id.toString(),
          variantId: w.variantId?.toString() ?? null,
          variantLabel: v ? [v.size, v.color].filter(Boolean).join(' · ') : null,
          title: p.title,
          imageUrl: optimizedImage(p.images[0]?.url, IMAGE_WIDTH.card),
          watchedPrice: w.price,
          price: currentPrice(p, v),
          inStock: v ? v.stock > 0 : p.totalStock > 0,
          available: p.status === ProductStatus.ACTIVE,
          createdAt: w.createdAt,
        },
      ];
    });
  }

  /** Sends due alerts for one product. Never throws: product saves must not fail because of it. */
  async check(productId: Types.ObjectId | string) {
    try {
      const product = await this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE }).lean();
      if (!product) return 0;
      const rows = await this.watches.find({ productId: product._id }).lean();
      let sent = 0;
      for (const w of rows) {
        const v = w.variantId ? product.variants.find((x) => x._id.equals(w.variantId!)) : null;
        if (w.variantId && !v) {
          await this.watches.deleteOne({ _id: w._id });
          continue;
        }
        const label = v ? ` (${[v.size, v.color].filter(Boolean).join(' · ')})` : '';
        if (w.type === WatchType.BACK_IN_STOCK && (v ? v.stock > 0 : product.totalStock > 0)) {
          await this.alert(w.userId, {
            type: 'BACK_IN_STOCK',
            title: 'رجع تاني!',
            body: `«${product.title}»${label} رجع متوفر. اطلبه قبل ما يخلص.`,
            productId: product._id,
            dedupeKey: `stock-${w._id.toString()}-${Date.now()}`,
          });
          await this.watches.deleteOne({ _id: w._id });
          sent++;
        } else if (w.type === WatchType.PRICE_DROP && w.price != null) {
          const now = currentPrice(product, v);
          if (now < w.price) {
            await this.alert(w.userId, {
              type: 'PRICE_DROP',
              title: 'السعر نزل!',
              body: `«${product.title}»${label} بقى بـ ${now} ج.م بدل ${w.price} ج.م.`,
              productId: product._id,
              dedupeKey: `price-${w._id.toString()}-${now}`,
            });
            await this.watches.updateOne({ _id: w._id }, { $set: { price: now } });
            sent++;
          }
        }
      }
      return sent;
    } catch (e) {
      this.logger.warn(`alert check failed for ${String(productId)}: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Daily: products with price watches, for sales that started on schedule. */
  async checkScheduled() {
    const ids = await this.watches.distinct('productId', { type: WatchType.PRICE_DROP });
    let sent = 0;
    for (const id of ids.slice(0, 1000)) sent += await this.check(id);
    return sent;
  }

  private async alert(userId: Types.ObjectId, a: { type: string; title: string; body: string; productId: Types.ObjectId; dedupeKey: string }) {
    await this.notifications.notify(userId.toString(), { type: a.type, title: a.title, body: a.body, data: { productId: a.productId.toString() }, dedupeKey: a.dedupeKey });
    const user = await this.users.getById(userId.toString()).catch(() => null);
    if (user?.email) {
      await this.mail.sendNotice({ to: user.email, subject: `${a.title} · فاترينة`, title: a.title, lines: [a.body, 'افتح تطبيق فاترينة واطلبه.'] }).catch(() => undefined);
    }
  }

  // ---------- Following stores ----------

  async follow(userId: string, brandId: string) {
    if (!(await this.brands.exists({ _id: brandId }))) throw AppError.notFound('Brand');
    await this.follows.updateOne({ userId: new Types.ObjectId(userId), brandId: new Types.ObjectId(brandId) }, { $setOnInsert: {} }, { upsert: true });
    return this.followState(brandId, userId);
  }

  async unfollow(userId: string, brandId: string) {
    await this.follows.deleteOne({ userId: new Types.ObjectId(userId), brandId: new Types.ObjectId(brandId) });
    return this.followState(brandId, userId);
  }

  async followState(brandId: string, userId?: string) {
    const [followers, mine] = await Promise.all([
      this.follows.countDocuments({ brandId: new Types.ObjectId(brandId) }),
      userId ? this.follows.exists({ brandId: new Types.ObjectId(brandId), userId: new Types.ObjectId(userId) }) : null,
    ]);
    return { following: !!mine, followers };
  }

  async followedBrandIds(userId: string) {
    return (await this.follows.find({ userId: new Types.ObjectId(userId) }).select('brandId').lean()).map((f) => f.brandId);
  }

  /** Tells a store's followers about a newly published product or a new sale (once each). */
  async notifyFollowers(product: Lean<Product> | (Product & { _id: Types.ObjectId }), kind: 'NEW_PRODUCT' | 'NEW_SALE') {
    try {
      const brand = await this.brands.findById(product.brandId).select('name').lean();
      if (!brand) return 0;
      const followers = await this.follows.find({ brandId: product.brandId }).select('userId').limit(5000).lean();
      const body =
        kind === 'NEW_PRODUCT'
          ? `${brand.name} نزّل «${product.title}»`
          : `${brand.name} عامل خصم ${product.sale?.percent ?? ''}% على «${product.title}»`;
      for (const f of followers) {
        await this.notifications.notify(f.userId.toString(), {
          type: kind === 'NEW_PRODUCT' ? 'FOLLOWED_NEW_PRODUCT' : 'FOLLOWED_SALE',
          title: kind === 'NEW_PRODUCT' ? 'جديد من متجر بتتابعه' : 'عرض من متجر بتتابعه',
          body,
          data: { productId: product._id.toString() },
          dedupeKey: `follow-${kind}-${product._id.toString()}-${kind === 'NEW_SALE' ? (product.sale?.startsAt?.toISOString() ?? '') : ''}-${f.userId.toString()}`,
        });
      }
      return followers.length;
    } catch (e) {
      this.logger.warn(`follower notice failed: ${(e as Error).message}`);
      return 0;
    }
  }
}

/** What a watched product (or variant) costs right now; the cheapest variant for the product. */
function currentPrice(
  p: { price: number; sale?: Product['sale']; variants: { price?: number | null; stock: number }[] },
  v?: { price?: number | null } | null,
) {
  if (v) return unitPriceNow(p, v);
  const prices = p.variants.map((x) => unitPriceNow(p, x));
  return prices.length ? Math.min(...prices) : unitPriceNow(p, {});
}
