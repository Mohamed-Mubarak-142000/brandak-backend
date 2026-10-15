import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BrandStatus, SubscriptionStatus } from '@/common/enums';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { Subscription } from './subscription.schema';

const DAY_MS = 86_400_000;

@Injectable()
export class SubscriptionJobs {
  private readonly logger = new Logger(SubscriptionJobs.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptions: Model<Subscription>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly members: BrandMembersService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Hourly so expiry is reflected quickly; notifications are de-duplicated per period end. */
  @Cron(CronExpression.EVERY_HOUR)
  async run(now = new Date()) {
    const expired = await this.expireEnded(now);
    const reminded = await this.sendReminders(now);
    if (expired || reminded) this.logger.log(`Expired ${expired} subscriptions, sent ${reminded} reminders`);
  }

  async expireEnded(now: Date) {
    const res = await this.subscriptions.updateMany(
      { status: SubscriptionStatus.ACTIVE, endsAt: { $lte: now } },
      { $set: { status: SubscriptionStatus.EXPIRED } },
    );
    return res.modifiedCount;
  }

  /** Reminders 7 and 3 days before the paid period ends, on the last day, and once it has ended. */
  async sendReminders(now: Date) {
    const brands = await this.brands
      .find({
        status: BrandStatus.ACTIVE,
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
