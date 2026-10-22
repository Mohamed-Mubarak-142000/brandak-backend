import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BrandStatus, OrderStatus, PaymentStatus, ProductStatus, ReportStatus, SubscriptionStatus } from '@/common/enums';
import { Brand } from '@/brands/brand.schema';
import { BrandsService } from '@/brands/brands.service';
import { Order } from '@/orders/order.schema';
import { Product } from '@/products/product.schema';
import { Report } from '@/reviews/review.schema';
import { Payment } from '@/subscriptions/payment.schema';
import { Subscription } from '@/subscriptions/subscription.schema';
import { monthlyEquivalent } from '@/subscriptions/subscription-period';
import { SubscriptionsService } from '@/subscriptions/subscriptions.service';
import { CommissionsService } from '@/commissions/commissions.service';
import { User } from '@/users/user.schema';

const DAY_MS = 86_400_000;
const LOW_STOCK_THRESHOLD = 3;
const TIMEZONE = 'Africa/Cairo';
const NOT_CANCELLED = { $nin: [OrderStatus.CANCELLED, OrderStatus.REFUSED, OrderStatus.AWAITING_CONFIRMATION] };

export interface Range {
  from: Date;
  to: Date;
}

/** Defaults to the last 30 days; the previous period has the same length, right before it. */
export function resolveRange(from?: string, to?: string): Range & { previous: Range } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * DAY_MS);
  const length = Math.max(end.getTime() - start.getTime(), DAY_MS);
  return { from: start, to: end, previous: { from: new Date(start.getTime() - length), to: start } };
}

const pctChange = (current: number, previous: number) =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<Subscription>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    private readonly brands: BrandsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly commissions: CommissionsService,
  ) {}

  async brandOverview(brandId: string, range: ReturnType<typeof resolveRange>) {
    const id = new Types.ObjectId(brandId);
    const inRange = (r: Range) => ({ brandId: id, deletedAt: null, createdAt: { $gte: r.from, $lt: r.to } });

    // Same rule as the checkout limit: this calendar month in Cairo, cancelled orders don't count.
    const commission = await this.commissions.statusFor(id);
    const [byStatus, previous, pending, daily, topProducts, lowStock, activeProducts] = await Promise.all([
      this.orders.aggregate<{ _id: OrderStatus; count: number; total: number }>([
        { $match: inRange(range) },
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$grandTotal' } } },
      ]),
      this.orders.aggregate<{ count: number; total: number }>([
        { $match: { ...inRange(range.previous), status: NOT_CANCELLED } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } },
      ]),
      this.orders.countDocuments({ brandId: id, status: OrderStatus.PENDING, deletedAt: null }),
      this.orders.aggregate<{ _id: string; orders: number; sales: number }>([
        { $match: { ...inRange(range), status: NOT_CANCELLED } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TIMEZONE } },
            orders: { $sum: 1 },
            sales: { $sum: '$grandTotal' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.orders.aggregate([
        { $match: { ...inRange(range), status: NOT_CANCELLED } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            title: { $last: '$items.title' },
            imageUrl: { $last: '$items.imageUrl' },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { quantity: -1 } },
        { $limit: 5 },
      ]),
      this.products
        .find({ brandId: id, status: ProductStatus.ACTIVE, 'variants.stock': { $lte: LOW_STOCK_THRESHOLD } })
        .select('title variants images')
        .limit(10)
        .lean(),
      this.products.countDocuments({ brandId: id, status: ProductStatus.ACTIVE }),
    ]);

    const live = byStatus.filter((s) => s._id !== OrderStatus.CANCELLED);
    const ordersCount = live.reduce((n, s) => n + s.count, 0);
    const salesValue = live.reduce((n, s) => n + s.total, 0);
    const prev = previous[0] ?? { count: 0, total: 0 };

    return {
      range: { from: range.from, to: range.to },
      orders: {
        count: ordersCount,
        changePct: pctChange(ordersCount, prev.count),
        pendingNow: pending,
        byStatus: Object.fromEntries(Object.values(OrderStatus).map((s) => [s, byStatus.find((b) => b._id === s)?.count ?? 0])),
      },
      // Sales value = non-cancelled orders; delivered revenue = cash actually collected (COD).
      salesValue: round(salesValue),
      salesChangePct: pctChange(salesValue, prev.total),
      deliveredRevenue: round(byStatus.find((s) => s._id === OrderStatus.DELIVERED)?.total ?? 0),
      averageOrderValue: ordersCount ? round(salesValue / ordersCount) : 0,
      daily: daily.map((d) => ({ date: d._id, orders: d.orders, sales: round(d.sales) })),
      topProducts: topProducts.map(({ _id, ...p }) => ({ productId: _id.toString(), ...p, revenue: round(p.revenue) })),
      lowStock: lowStock.map((p) => ({
        productId: p._id.toString(),
        title: p.title,
        imageUrl: p.images[0]?.url ?? null,
        variants: p.variants
          .filter((v) => v.stock <= LOW_STOCK_THRESHOLD)
          .map((v) => ({ id: v._id.toString(), size: v.size ?? null, color: v.color ?? null, stock: v.stock })),
      })),
      // Plans were replaced by a per-order commission; kept null for older app versions.
      plan: null,
      activeProducts,
      commission: {
        rate: commission.commissionRate,
        balance: commission.balance,
        dueBy: commission.dueBy,
        blocked: commission.blocked,
        pendingSettlement: !!commission.pendingSettlement,
      },
    };
  }

  async adminOverview(range: ReturnType<typeof resolveRange>) {
    const now = new Date();
    const [
      brandsByStatus,
      visibleBrands,
      usersTotal,
      newUsers,
      currentSubs,
      collected,
      renewals,
      pendingPayments,
      openReports,
      orderStats,
      expiringSoon,
    ] = await Promise.all([
      this.brandModel.aggregate<{ _id: BrandStatus; count: number }>([
        { $match: { deletedAt: null } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.brandModel.countDocuments(this.brands.visibleFilter()),
      this.users.countDocuments({ deletedAt: null }),
      this.users.countDocuments({ deletedAt: null, createdAt: { $gte: range.from, $lt: range.to } }),
      this.subscriptions
        .find({ status: SubscriptionStatus.ACTIVE, startsAt: { $lte: now }, endsAt: { $gt: now } })
        .select('planSnapshot')
        .lean(),
      this.payments.aggregate<{ total: number; count: number }>([
        { $match: { status: PaymentStatus.APPROVED, deletedAt: null, reviewedAt: { $gte: range.from, $lt: range.to } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      this.payments.aggregate<{ count: number }>([
        { $match: { status: PaymentStatus.APPROVED, deletedAt: null, reviewedAt: { $gte: range.from, $lt: range.to } } },
        { $lookup: { from: 'subscriptions', localField: 'subscriptionId', foreignField: '_id', as: 'sub' } },
        { $match: { 'sub.renewalOf': { $exists: true, $ne: null } } },
        { $count: 'count' },
      ]),
      this.payments.countDocuments({ status: PaymentStatus.PENDING_REVIEW }),
      this.reports.countDocuments({ status: ReportStatus.OPEN }),
      this.orders.aggregate<{ count: number; gmv: number }>([
        { $match: { createdAt: { $gte: range.from, $lt: range.to }, status: NOT_CANCELLED, deletedAt: null } },
        { $group: { _id: null, count: { $sum: 1 }, gmv: { $sum: '$grandTotal' } } },
      ]),
      this.brandModel.countDocuments({
        status: BrandStatus.ACTIVE,
        deletedAt: null,
        subscriptionEndsAt: { $gt: now, $lte: new Date(now.getTime() + 7 * DAY_MS) },
      }),
    ]);

    const mrr = currentSubs.reduce((sum, s) => sum + monthlyEquivalent(s.planSnapshot.price, s.planSnapshot.durationDays), 0);
    const byPlan = currentSubs.reduce<Record<string, number>>((acc, s) => {
      acc[s.planSnapshot.code] = (acc[s.planSnapshot.code] ?? 0) + 1;
      return acc;
    }, {});

    return {
      range: { from: range.from, to: range.to },
      brands: {
        byStatus: Object.fromEntries(Object.values(BrandStatus).map((s) => [s, brandsByStatus.find((b) => b._id === s)?.count ?? 0])),
        visible: visibleBrands,
        expiringIn7Days: expiringSoon,
      },
      users: { total: usersTotal, newInRange: newUsers },
      subscriptions: {
        active: currentSubs.length,
        byPlan,
        // Monthly recurring revenue from subscriptions running right now (yearly plans counted per month).
        mrr: round(mrr),
        collectedInRange: round(collected[0]?.total ?? 0),
        approvedPaymentsInRange: collected[0]?.count ?? 0,
        renewalsInRange: renewals[0]?.count ?? 0,
      },
      queues: { pendingPayments, pendingBrandApplications: brandsByStatus.find((b) => b._id === BrandStatus.PENDING_REVIEW)?.count ?? 0, openReports },
      // GMV is the value of orders placed between customers and brands — not Fatrina revenue.
      orders: { count: orderStats[0]?.count ?? 0, gmv: round(orderStats[0]?.gmv ?? 0) },
    };
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
