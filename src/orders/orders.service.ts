import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { OrderStatus, OtpPurpose } from '@/common/enums';

/** Only finished orders can be deleted, so stock and the order flow are never left half-way. */
export interface ShipmentInput {
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
}

const DELETABLE: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUSED];
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
import { escapeRegex, normalizeEgyptPhone } from '@/common/utils/text';
import { withTransaction } from '@/common/utils/transaction';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { OtpService } from '@/auth/otp.service';
import { CommissionsService } from '@/commissions/commissions.service';
import { PromotionsService } from '@/promotions/promotions.service';
import { UsersService } from '@/users/users.service';
import { BrandMembersService } from '@/brands/brand-members.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { Product } from '@/products/product.schema';
import { BrandBlock } from './brand-block.schema';
import { Order } from './order.schema';
import { CustomerTrust, trustLevel } from './customer-trust';
import { allowedNext, canTransition, OrderActor, restocks } from './order-state';
import { AdminOrdersQueryDto, BrandOrdersQueryDto, OrdersQueryDto } from './orders.dto';

const STATUS_AR: Record<OrderStatus, string> = {
  AWAITING_CONFIRMATION: 'مستني تأكيدك',
  PENDING: 'قيد المراجعة',
  CONFIRMED: 'تم التأكيد',
  PROCESSING: 'قيد التجهيز',
  SHIPPED: 'تم الشحن',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
  REFUSED: 'رفض الاستلام',
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(BrandBlock.name) private readonly blocks: Model<BrandBlock>,
    @InjectConnection() private readonly connection: Connection,
    private readonly members: BrandMembersService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly commissions: CommissionsService,
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly promotions: PromotionsService,
  ) {}

  // ---------- Customer ----------

  async listMine(userId: string, query: OrdersQueryDto) {
    const filter: FilterQuery<Order> = { userId: new Types.ObjectId(userId), deletedAt: null };
    if (query.status) filter.status = query.status;
    return this.page(filter, query, 'CUSTOMER');
  }

  async getMine(userId: string, id: string) {
    const order = await this.orders.findOne({ _id: id, userId: new Types.ObjectId(userId), deletedAt: null }).lean();
    if (!order) throw AppError.notFound('Order');
    return this.toView(order, 'CUSTOMER');
  }

  cancelByCustomer(userId: string, id: string, reason?: string) {
    return this.changeStatus(
      { _id: id, userId: new Types.ObjectId(userId), deletedAt: null },
      OrderStatus.CANCELLED,
      { actor: 'CUSTOMER', userId, note: reason || 'ألغاه العميل' },
    );
  }

  // ---------- Brand ----------

  listForBrand(brandId: string, query: BrandOrdersQueryDto) {
    // Orders still waiting for the customer's confirmation are not the store's business yet.
    const base: FilterQuery<Order> = { brandId: new Types.ObjectId(brandId), deletedAt: null, status: { $ne: OrderStatus.AWAITING_CONFIRMATION } };
    return this.page(this.searchFilter(base, query), query, 'BRAND');
  }

  async getForBrand(brandId: string, id: string) {
    const order = await this.orders
      .findOne({ _id: id, brandId: new Types.ObjectId(brandId), deletedAt: null, status: { $ne: OrderStatus.AWAITING_CONFIRMATION } })
      .lean();
    if (!order) throw AppError.notFound('Order');
    return { ...this.toView(order, 'BRAND'), customerTrust: await this.trustFor(order.userId) };
  }

  async blockCustomer(userId: string, brandId: string, orderId: string, note?: string) {
    const order = await this.orders.findOne({ _id: orderId, brandId: new Types.ObjectId(brandId) }).lean();
    if (!order) throw AppError.notFound('Order');
    await this.blocks.updateOne(
      { brandId: order.brandId, userId: order.userId },
      { $setOnInsert: { customer: order.customer, note: note ?? '', createdBy: new Types.ObjectId(userId) } },
      { upsert: true },
    );
    return this.listBlocks(brandId);
  }

  async listBlocks(brandId: string) {
    const rows = await this.blocks.find({ brandId: new Types.ObjectId(brandId) }).sort({ createdAt: -1 }).lean();
    return rows.map((b) => ({ id: b._id.toString(), customer: b.customer, note: b.note, createdAt: b.createdAt }));
  }

  async unblock(brandId: string, id: string) {
    await this.blocks.deleteOne({ _id: id, brandId: new Types.ObjectId(brandId) });
  }

  /** Delivered vs refused orders of a customer across all stores (counts only). */
  async trustFor(userId: Types.ObjectId | string): Promise<CustomerTrust> {
    const rows = await this.orders.aggregate<{ _id: OrderStatus; n: number }>([
      { $match: { userId: new Types.ObjectId(String(userId)), status: { $in: [OrderStatus.DELIVERED, OrderStatus.REFUSED] } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const delivered = rows.find((x) => x._id === OrderStatus.DELIVERED)?.n ?? 0;
    const refused = rows.find((x) => x._id === OrderStatus.REFUSED)?.n ?? 0;
    return { delivered, refused, level: trustLevel(delivered, refused) };
  }

  /**
   * One code confirms every order the customer is holding (several stores can be checked out
   * back to back). Confirmed orders then reach their stores like any new order.
   */
  async confirmPending(userId: string, code: string) {
    await this.otp.consume(userId, OtpPurpose.CONFIRM_ORDER, code);
    const waiting = await this.orders.find({ userId: new Types.ObjectId(userId), status: OrderStatus.AWAITING_CONFIRMATION, deletedAt: null }).lean();
    const confirmed = [];
    for (const o of waiting) {
      confirmed.push(
        await this.changeStatus({ _id: o._id, status: OrderStatus.AWAITING_CONFIRMATION }, OrderStatus.PENDING, {
          actor: 'CUSTOMER',
          userId,
          note: 'أكد الطلب بالكود',
        }),
      );
      await this.notifications.notify(await this.members.memberUserIds(o.brandId), {
        type: 'ORDER_PLACED',
        title: 'طلب جديد',
        body: `طلب ${o.orderNumber} بقيمة ${o.grandTotal} ج.م`,
        data: { orderId: o._id.toString() },
      });
    }
    return confirmed;
  }

  /** Sends a fresh confirmation code (subject to the usual one-minute cooldown). */
  async resendConfirmation(userId: string) {
    const user = await this.users.getById(userId);
    if (!(await this.orders.exists({ userId: user._id, status: OrderStatus.AWAITING_CONFIRMATION }))) {
      throw AppError.unprocessable('NOTHING_TO_CONFIRM', 'No order is waiting for confirmation');
    }
    await this.otp.issue(userId, OtpPurpose.CONFIRM_ORDER, 'email', user.email);
  }

  /** Cancels orders nobody confirmed within a day and puts their stock back. */
  async expireUnconfirmed(now = new Date()) {
    const stale = await this.orders
      .find({ status: OrderStatus.AWAITING_CONFIRMATION, createdAt: { $lte: new Date(now.getTime() - 24 * 3_600_000) } })
      .select('_id userId')
      .lean();
    for (const o of stale) {
      await this.changeStatus({ _id: o._id, status: OrderStatus.AWAITING_CONFIRMATION }, OrderStatus.CANCELLED, {
        actor: 'SYSTEM',
        userId: o.userId.toString(),
        note: 'اتلغى تلقائياً لأنه متأكدش خلال 24 ساعة',
      }).catch(() => undefined);
    }
    return stale.length;
  }

  updateByBrand(userId: string, brandId: string, id: string, status: OrderStatus, note?: string, shipment?: ShipmentInput) {
    if (status === OrderStatus.CANCELLED && !note) {
      throw AppError.unprocessable('REASON_REQUIRED', 'A cancellation reason is required', [
        { field: 'note', reason: 'required' },
      ]);
    }
    return this.changeStatus({ _id: id, brandId: new Types.ObjectId(brandId), deletedAt: null }, status, { actor: 'BRAND', userId, note }, shipment);
  }

  /** Adds or corrects the tracking details of a shipped order. */
  async setShipment(brandId: string, id: string, shipment: ShipmentInput) {
    const order = await this.orders.findOneAndUpdate(
      { _id: id, brandId: new Types.ObjectId(brandId), deletedAt: null, status: { $in: [OrderStatus.SHIPPED, OrderStatus.DELIVERED] } },
      { $set: { shipment: { ...shipment, trackingUrl: shipment.trackingUrl ?? null, shippedAt: new Date() } } },
      { new: true },
    );
    if (!order) throw AppError.conflict('INVALID_STATE', 'Tracking can be added once the order is shipped');
    await this.notifications.notify(order.userId.toString(), {
      type: 'ORDER_TRACKING',
      title: `طلب ${order.orderNumber} في الطريق`,
      body: `اتشحن مع ${shipment.carrier}، رقم الشحنة ${shipment.trackingNumber}`,
      data: { orderId: order.id },
    });
    return this.toView(order.toObject(), 'BRAND');
  }

  /** Customers who ordered from this brand, with totals. Only data from this brand's own orders. */
  async brandCustomers(brandId: string, query: { page: number; limit: number }) {
    const match = { brandId: new Types.ObjectId(brandId), deletedAt: null };
    const [rows, total] = await Promise.all([
      this.orders.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$userId',
            name: { $first: '$customer.name' },
            phone: { $first: '$customer.phone' },
            ordersCount: { $sum: 1 },
            deliveredCount: { $sum: { $cond: [{ $eq: ['$status', OrderStatus.DELIVERED] }, 1, 0] } },
            totalSpent: { $sum: { $cond: [{ $eq: ['$status', OrderStatus.DELIVERED] }, '$grandTotal', 0] } },
            lastOrderAt: { $first: '$createdAt' },
          },
        },
        { $sort: { lastOrderAt: -1 } },
        { $skip: (query.page - 1) * query.limit },
        { $limit: query.limit },
      ]),
      this.orders.distinct('userId', match).then((ids) => ids.length),
    ]);
    const items = rows.map(({ _id, ...r }) => ({ customerId: _id.toString(), ...r }));
    return new PageResult(items, query.page, query.limit, total);
  }

  // ---------- Admin ----------

  listAll(query: AdminOrdersQueryDto) {
    const base: FilterQuery<Order> = { deletedAt: query.deleted ? { $ne: null } : null };
    if (query.brandId) base.brandId = new Types.ObjectId(query.brandId);
    return this.page(this.searchFilter(base, query), query, 'ADMIN');
  }

  async getAny(id: string) {
    const order = await this.orders.findById(id).lean();
    if (!order) throw AppError.notFound('Order');
    return this.toView(order, 'ADMIN');
  }

  cancelByAdmin(adminId: string, id: string, reason: string) {
    return this.changeStatus({ _id: id, deletedAt: null }, OrderStatus.CANCELLED, { actor: 'ADMIN', userId: adminId, note: reason });
  }

  async softDelete(adminId: string, id: string) {
    const order = await this.orders.findOneAndUpdate(
      { _id: id, deletedAt: null, status: { $in: DELETABLE } },
      { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(adminId) } },
      { new: true },
    );
    if (!order) {
      const o = await this.orders.findById(id).select('status deletedAt').lean();
      if (!o) throw AppError.notFound('Order');
      if (!DELETABLE.includes(o.status)) throw AppError.conflict('ORDER_IN_PROGRESS', 'Only delivered or cancelled orders can be deleted');
      throw AppError.conflict('INVALID_STATE', 'Order is already deleted');
    }
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'ORDER_DELETED', entityType: 'Order', entityId: order._id });
    return this.toView(order.toObject(), 'ADMIN');
  }

  async restore(adminId: string, id: string) {
    const order = await this.orders.findOneAndUpdate({ _id: id, deletedAt: { $ne: null } }, { $unset: { deletedAt: 1, deletedBy: 1 } }, { new: true });
    if (!order) {
      if (!(await this.orders.exists({ _id: id }))) throw AppError.notFound('Order');
      throw AppError.conflict('INVALID_STATE', 'Order is not deleted');
    }
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'ORDER_RESTORED', entityType: 'Order', entityId: order._id });
    return this.toView(order.toObject(), 'ADMIN');
  }

  // ---------- Core ----------

  private async changeStatus(
    scope: FilterQuery<Order>,
    to: OrderStatus,
    by: { actor: OrderActor; userId: string; note?: string },
    shipment?: ShipmentInput,
  ) {
    const updated = await withTransaction(this.connection, async (session) => {
      const order = await this.orders.findOne(scope).session(session);
      if (!order) throw AppError.notFound('Order');
      const from = order.status;
      if (!canTransition(from, to, by.actor)) {
        throw AppError.conflict('INVALID_TRANSITION', `Cannot change order from ${from} to ${to}`);
      }
      const now = new Date();
      const set: Partial<Order> = { status: to };
      if (to === OrderStatus.CANCELLED) set.cancelReason = by.note;
      if (to === OrderStatus.SHIPPED && shipment) set.shipment = { ...shipment, trackingUrl: shipment.trackingUrl ?? null, shippedAt: now };
      if (to === OrderStatus.DELIVERED) Object.assign(set, { deliveredAt: now, paymentStatus: 'PAID' });

      // Matching on the current status makes concurrent updates safe: only one can win.
      const result = await this.orders.findOneAndUpdate(
        { _id: order._id, status: from },
        {
          $set: set,
          $push: {
            statusHistory: { status: to, at: now, by: new Types.ObjectId(by.userId), actor: by.actor, note: by.note },
          },
        },
        { new: true, session },
      );
      if (!result) throw AppError.conflict('CONCURRENT_UPDATE', 'The order was updated by someone else, please retry');

      if (to === OrderStatus.DELIVERED) {
        const commission = await this.commissions.recordForOrder(result, session);
        result.commission = commission;
        await this.orders.updateOne({ _id: result._id }, { $set: { commission } }, { session });
      }
      // A coupon used on an order that won't be delivered can be used again.
      if ((to === OrderStatus.CANCELLED || to === OrderStatus.REFUSED) && order.coupon) await this.promotions.release(order._id, session);
      if (restocks(from, to)) {
        for (const item of order.items) {
          // Variants deleted since the order simply don't match; nothing to restock.
          await this.products.updateOne(
            { _id: item.productId, 'variants._id': item.variantId },
            { $inc: { 'variants.$.stock': item.quantity, totalStock: item.quantity, soldCount: -item.quantity } },
            { session },
          );
        }
      }
      if (by.actor !== 'CUSTOMER') {
        await this.audit.log(
          {
            actorId: by.userId,
            actorType: by.actor === 'ADMIN' ? 'ADMIN' : by.actor === 'SYSTEM' ? 'SYSTEM' : 'USER',
            action: 'ORDER_STATUS_CHANGED',
            entityType: 'Order',
            entityId: order._id,
            data: { from, to, note: by.note },
          },
          session,
        );
      }
      return result;
    });

    await this.notifyStatus(updated.toObject(), by.actor);
    return this.toView(updated.toObject(), by.actor);
  }

  private async notifyStatus(order: Lean<Order>, actor: OrderActor) {
    const payload = {
      type: 'ORDER_STATUS_CHANGED',
      title: `طلب ${order.orderNumber}`,
      body: `حالة الطلب: ${STATUS_AR[order.status]}`,
      data: { orderId: order._id.toString(), status: order.status },
    };
    if (actor !== 'CUSTOMER') await this.notifications.notify(order.userId.toString(), payload);
    // The store never heard of an order that was still waiting for the customer's confirmation,
    // and gets its own "new order" notice when it is confirmed.
    const storeKnows = order.statusHistory.some((h) => h.status === OrderStatus.PENDING);
    if (actor !== 'BRAND' && storeKnows && order.status !== OrderStatus.PENDING) {
      await this.notifications.notify(await this.members.memberUserIds(order.brandId), payload);
    }
  }

  private searchFilter(base: FilterQuery<Order>, query: BrandOrdersQueryDto): FilterQuery<Order> {
    const filter: FilterQuery<Order> = { ...base };
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    const q = query.q?.trim();
    if (q) {
      const phone = normalizeEgyptPhone(q);
      filter.$or = [
        { orderNumber: new RegExp(`^${escapeRegex(q.toUpperCase())}`) },
        ...(phone ? [{ 'customer.phone': phone }] : []),
      ];
    }
    return filter;
  }

  private async page(filter: FilterQuery<Order>, query: { page: number; limit: number }, actor: OrderActor) {
    const page = await paginate(this.orders, filter, query);
    return new PageResult(page.items.map((o) => this.toView(o, actor, true)), page.page, page.limit, page.total);
  }

  toView(order: Lean<Order>, actor: OrderActor = 'CUSTOMER', summary = false) {
    const base = {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      brand: { id: order.brandId.toString(), ...order.brandSnapshot },
      status: order.status,
      statusLabelAr: STATUS_AR[order.status],
      itemsCount: order.items.reduce((n, i) => n + i.quantity, 0),
      grandTotal: order.grandTotal,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      customer: actor === 'CUSTOMER' ? undefined : order.customer,
    };
    if (summary) return { ...base, previewImageUrl: order.items[0]?.imageUrl ?? null };
    return {
      ...base,
      items: order.items.map((i) => ({ ...i, productId: i.productId.toString(), variantId: i.variantId.toString() })),
      address: order.addressSnapshot,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      discountTotal: order.discountTotal,
      notes: order.notes,
      cancelReason: order.cancelReason ?? null,
      deliveredAt: order.deliveredAt ?? null,
      coupon: order.coupon ? { code: order.coupon.code, discount: order.coupon.discount, fundedBy: order.coupon.fundedBy } : null,
      shipment: order.shipment ?? null,
      commission: actor === 'CUSTOMER' ? undefined : (order.commission ?? null),
      history: order.statusHistory.map((h) => ({ status: h.status, at: h.at, actor: h.actor, note: h.note ?? null })),
      allowedNextStatuses: allowedNext(order.status, actor),
    };
  }
}
