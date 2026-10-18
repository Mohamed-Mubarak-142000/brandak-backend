import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BrandStatus, ProductStatus, SubscriptionStatus } from '@/common/enums';
import { Product } from '@/products/product.schema';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { Subscription } from './subscription.schema';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 86_400_000;

@Injectable()
export class SubscriptionJobs {
  private readonly logger = new Logger(SubscriptionJobs.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptions: Model<Subscription>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly members: BrandMembersService,
    private readonly notifications: NotificationsService,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly subs: SubscriptionsService,
  ) {}

  /** Hourly so expiry is reflected quickly; notifications are de-duplicated per period end. */
  @Cron(CronExpression.EVERY_HOUR)
  async run(now = new Date()) {
    const expired = await this.expireEnded(now);
    const reminded = await this.sendReminders(now);
    if (expired || reminded) this.logger.log(`Expired ${expired} subscriptions, sent ${reminded} reminders`);
  }

  async expireEnded(now: Date) {
    const ending = await this.subscriptions
      .find({ status: SubscriptionStatus.ACTIVE, endsAt: { $lte: now } })
      .select('brandId planSnapshot.price')
      .lean();
    if (!ending.length) return 0;
    const res = await this.subscriptions.updateMany(
      { _id: { $in: ending.map((s) => s._id) } },
      { $set: { status: SubscriptionStatus.EXPIRED } },
    );
    await this.fallBackToFree([...new Set(ending.filter((s) => s.planSnapshot.price > 0).map((s) => s.brandId.toString()))]);
    return res.modifiedCount;
  }

  /**
   * A store whose paid plan ended (and wasn't renewed) moves to the free plan instead of
   * disappearing. Published products beyond the free limit go back to drafts, newest kept.
   */
  async fallBackToFree(brandIds: string[]) {
    const free = await this.subs.freePlan();
    if (!free) return;
    for (const id of brandIds) {
      if (await this.subs.currentFor(id)) continue; // renewed or another plan already active
      const brandId = new Types.ObjectId(id);
      await this.subs.activateFree(null, brandId, free);
      const keep = free.limits.maxActiveProducts;
      const extra = await this.products
        .find({ brandId, status: ProductStatus.ACTIVE })
        .sort({ publishedAt: -1, updatedAt: -1 })
        .skip(keep)
        .select('_id')
        .lean();
      if (extra.length) {
        await this.products.updateMany({ _id: { $in: extra.map((p) => p._id) } }, { $set: { status: ProductStatus.DRAFT } });
      }
      await this.notifications.notify(await this.members.memberUserIds(brandId), {
        type: 'SUBSCRIPTION_FREE_FALLBACK',
        title: 'رجعت للباقة المجانية',
        body: extra.length
          ? `انتهت باقتك ومتجرك لسه ظاهر على الباقة المجانية. ${extra.length} منتج رجع مسودة عشان حد الباقة ${keep} منتج. جدّد عشان ترجعهم.`
          : 'انتهت باقتك ومتجرك لسه ظاهر على الباقة المجانية بحدودها. جدّد في أي وقت عشان ترجع لمزايا باقتك.',
        data: { brandId: id },
      });
    }
  }

  /** Reminders 7 and 3 days before the paid period ends, on the last day, and once it has ended. */
  async sendReminders(now: Date) {
    const brands = await this.brands
      .find({
        status: BrandStatus.ACTIVE,
        deletedAt: null,
        subscriptionEndsAt: { $gt: new Date(now.getTime() - 2 * DAY_MS), $lte: new Date(now.getTime() + 7 * DAY_MS) },
      })
      .select('subscriptionEndsAt name')
      .lean();

    let sent = 0;
    for (const brand of brands) {
      const endsAt = brand.subscriptionEndsAt!;
      const daysLeft = (endsAt.getTime() - now.getTime()) / DAY_MS;
      const stage = daysLeft <= 0 ? 'expired' : daysLeft <= 1 ? '1' : daysLeft <= 3 ? '3' : '7';
      const date = endsAt.toISOString().slice(0, 10);
      const body =
        stage === 'expired'
          ? 'انتهى اشتراكك وتم إخفاء متجرك عن العملاء. جدّد الاشتراك لاستقبال طلبات جديدة.'
          : `ينتهي اشتراكك يوم ${date}. جدّد الآن حتى لا يتوقف متجرك.`;
      await this.notifications.notify(await this.members.memberUserIds(brand._id), {
        type: stage === 'expired' ? 'SUBSCRIPTION_EXPIRED' : 'SUBSCRIPTION_EXPIRING',
        title: stage === 'expired' ? 'انتهى الاشتراك' : 'اشتراكك قارب على الانتهاء',
        body,
        data: { brandId: brand._id.toString() },
        dedupeKey: `sub-${stage}-${endsAt.toISOString()}`,
      });
      sent++;
    }
    return sent;
  }
}
