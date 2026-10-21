import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CONTACT_CHANNEL, ContactChannel } from '@/auth/contact-channel';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { round2 } from '@/commissions/commission-math';
import { CommissionsService } from '@/commissions/commissions.service';
import { BrandStatus, OrderStatus } from '@/common/enums';
import { NotificationsService } from '@/notifications/notifications.service';
import { Order } from '@/orders/order.schema';
import { UsersService } from '@/users/users.service';

/** Searches per day and term, with how many products they found. */
@Schema({ collection: 'searchStats' })
export class SearchStat {
  @Prop({ required: true }) day: string;
  @Prop({ required: true }) term: string;
  @Prop({ default: 0 }) count: number;
  /** Results of the latest search for the term that day. */
  @Prop({ default: 0 }) results: number;
}
export const SearchStatSchema = SchemaFactory.createForClass(SearchStat);
SearchStatSchema.index({ day: 1, term: 1 }, { unique: true });

/** Searches that showed a store's products on the first page. */
@Schema({ collection: 'searchHits' })
export class SearchHit {
  @Prop({ required: true }) day: string;
  @Prop({ required: true }) term: string;
  @Prop({ type: Types.ObjectId, required: true }) brandId: Types.ObjectId;
  @Prop({ default: 0 }) count: number;
}
export const SearchHitSchema = SchemaFactory.createForClass(SearchHit);
SearchHitSchema.index({ day: 1, term: 1, brandId: 1 }, { unique: true });
SearchHitSchema.index({ brandId: 1, day: 1 });

/** One weekly report per store per week, even if the cron runs twice. */
@Schema({ collection: 'weeklyReports' })
export class WeeklyReport {
  @Prop({ type: Types.ObjectId, required: true }) brandId: Types.ObjectId;
  @Prop({ required: true }) week: string;
  @Prop({ default: () => new Date() }) sentAt: Date;
}
export const WeeklyReportSchema = SchemaFactory.createForClass(WeeklyReport);
WeeklyReportSchema.index({ brandId: 1, week: 1 }, { unique: true });

const DAY = 86_400_000;
/** Cairo time as UTC+2; summer time can shift a day bucket by an hour, which is fine for stats. */
const cairo = (d: Date) => new Date(d.getTime() + 2 * 3_600_000);
const dayKey = (d = new Date()) => cairo(d).toISOString().slice(0, 10);
const dayKeys = (days: number, now = new Date()) => Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - i * DAY)));
/** A search with no results means "people looked and didn't find it". */
export const LOW_RESULTS = 1;

/**
 * "What people search for and can't find" for stores, which searches bring them customers, and
 * a weekly email report per store.
 */
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @InjectModel(SearchStat.name) private readonly stats: Model<SearchStat>,
    @InjectModel(SearchHit.name) private readonly hits: Model<SearchHit>,
    @InjectModel(WeeklyReport.name) private readonly reports: Model<WeeklyReport>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    private readonly members: BrandMembersService,
    private readonly users: UsersService,
    private readonly commissions: CommissionsService,
    private readonly notifications: NotificationsService,
    @Inject(CONTACT_CHANNEL) private readonly mail: ContactChannel,
  ) {}

  /** Called by product search (first page only). Never throws. */
  async recordSearch(rawTerm: string, results: number, brandIds: Types.ObjectId[]) {
    const term = rawTerm.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
    if (term.length < 2) return;
    const day = dayKey();
    try {
      await this.stats.updateOne({ day, term }, { $inc: { count: 1 }, $set: { results } }, { upsert: true });
      const unique = [...new Set(brandIds.map(String))].slice(0, 10);
      if (unique.length) {
        await this.hits.bulkWrite(unique.map((b) => ({ updateOne: { filter: { day, term, brandId: new Types.ObjectId(b) }, update: { $inc: { count: 1 } }, upsert: true } })));
      }
    } catch (e) {
      this.logger.warn(`search stat failed: ${(e as Error).message}`);
    }
  }

  /** Searches with (almost) nothing to show, most frequent first. */
  async missing(days = 30, limit = 20) {
    return this.stats.aggregate<{ term: string; searches: number; results: number }>([
      { $match: { day: { $in: dayKeys(days) } } },
      { $sort: { day: -1 } },
      { $group: { _id: '$term', searches: { $sum: '$count' }, results: { $first: '$results' } } },
      { $match: { results: { $lt: LOW_RESULTS } } },
      { $sort: { searches: -1 } },
      { $limit: limit },
      { $project: { _id: 0, term: '$_id', searches: 1, results: 1 } },
    ]);
  }

  /** Searches that showed this store's products. */
  async forBrand(brandId: string | Types.ObjectId, days = 30, limit = 20) {
    return this.hits.aggregate<{ term: string; searches: number }>([
      { $match: { brandId: new Types.ObjectId(String(brandId)), day: { $in: dayKeys(days) } } },
      { $group: { _id: '$term', searches: { $sum: '$count' } } },
      { $sort: { searches: -1 } },
      { $limit: limit },
      { $project: { _id: 0, term: '$_id', searches: 1 } },
    ]);
  }

  async brandInsights(brandId: string, days = 30) {
    const [yours, missing] = await Promise.all([this.forBrand(brandId, days), this.missing(days)]);
    return { days, yours, missing };
  }

  // ---------- Weekly report ----------

  /** The store's last 7 days, as numbers the report and the app can show. */
  async weekSummary(brandId: Types.ObjectId, now = new Date()) {
    const from = new Date(now.getTime() - 7 * DAY);
    const [byStatus, top, balance] = await Promise.all([
      this.orders.aggregate<{ _id: OrderStatus; n: number; sales: number }>([
        { $match: { brandId, createdAt: { $gte: from, $lt: now }, status: { $ne: OrderStatus.AWAITING_CONFIRMATION }, deletedAt: null } },
        { $group: { _id: '$status', n: { $sum: 1 }, sales: { $sum: { $subtract: ['$subtotal', { $ifNull: ['$discountTotal', 0] }] } } } },
      ]),
      this.orders.aggregate<{ _id: string; qty: number }>([
        { $match: { brandId, createdAt: { $gte: from, $lt: now }, status: { $nin: [OrderStatus.AWAITING_CONFIRMATION, OrderStatus.CANCELLED] }, deletedAt: null } },
        { $unwind: '$items' },
        { $group: { _id: '$items.title', qty: { $sum: '$items.quantity' } } },
        { $sort: { qty: -1 } },
        { $limit: 3 },
      ]),
      this.commissions.balance(brandId),
    ]);
    const orders = byStatus.reduce((n, r) => n + r.n, 0);
    const delivered = byStatus.find((r) => r._id === OrderStatus.DELIVERED);
    const cancelled = byStatus.filter((r) => r._id === OrderStatus.CANCELLED || r._id === OrderStatus.REFUSED).reduce((n, r) => n + r.n, 0);
    const [yours, missing] = await Promise.all([this.forBrand(brandId, 7, 5), this.missing(7, 5)]);
    return {
      orders,
      deliveredOrders: delivered?.n ?? 0,
      deliveredSales: round2(delivered?.sales ?? 0),
      cancelled,
      topProducts: top.map((t) => ({ title: t._id, quantity: t.qty })),
      commissionBalance: balance,
      searches: yours,
      missing,
    };
  }

  /** Sunday (Cairo): emails every active store owner its week. Safe to run every day. */
  async sendWeekly(now = new Date(), force = false) {
    if (!force && cairo(now).getUTCDay() !== 0) return 0;
    const week = dayKey(now);
    const brands = await this.brands.find({ status: BrandStatus.ACTIVE, deletedAt: null }).select('_id name ownerUserId').limit(2000).lean();
    let sent = 0;
    for (const b of brands) {
      const fresh = await this.reports.updateOne({ brandId: b._id, week }, { $setOnInsert: { sentAt: now } }, { upsert: true });
      if (!fresh.upsertedCount) continue;
      try {
        const s = await this.weekSummary(b._id, now);
        const owner = await this.users.getById(b.ownerUserId.toString()).catch(() => null);
        const lines = [
          `الطلبات: ${s.orders} (اتسلم ${s.deliveredOrders} بقيمة ${s.deliveredSales} ج.م، اتلغى أو اترفض ${s.cancelled})`,
          s.topProducts.length ? `الأكتر طلباً: ${s.topProducts.map((p) => `${p.title} (${p.quantity})`).join('، ')}` : 'مفيش طلبات الأسبوع ده. جرّب عرض أو كوبون أو إعلان مميز.',
          s.searches.length ? `الناس لقيتك وهي بتدوّر على: ${s.searches.map((x) => x.term).join('، ')}` : '',
          s.missing.length ? `الناس بتدوّر على ومش لاقية: ${s.missing.map((x) => x.term).join('، ')}. لو عندك منها، ضيفها!` : '',
          s.commissionBalance > 0 ? `مستحق لفاترينة: ${s.commissionBalance} ج.م` : '',
        ].filter(Boolean);
        if (owner?.email) {
          await this.mail.sendNotice({ to: owner.email, subject: `تقرير ${b.name} الأسبوعي على فاترينة`, title: `أسبوعك على فاترينة`, lines });
        }
        await this.notifications.notify(await this.members.memberUserIds(b._id), {
          type: 'WEEKLY_REPORT',
          title: 'تقريرك الأسبوعي',
          body: lines[0],
          data: {},
          dedupeKey: `weekly-${b._id.toString()}-${week}`,
        });
        sent++;
      } catch (e) {
        this.logger.warn(`weekly report for ${b._id.toString()} failed: ${(e as Error).message}`);
      }
    }
    return sent;
  }
}
