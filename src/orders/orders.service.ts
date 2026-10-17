import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { OrderStatus } from '@/common/enums';

/** Only finished orders can be deleted, so stock and the order flow are never left half-way. */
const DELETABLE: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.CANCELLED];
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
import { escapeRegex, normalizeEgyptPhone } from '@/common/utils/text';
import { withTransaction } from '@/common/utils/transaction';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { BrandMembersService } from '@/brands/brand-members.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { Product } from '@/products/product.schema';
import { Order } from './order.schema';
import { allowedNext, canTransition, OrderActor, restocksOnCancel } from './order-state';
import { AdminOrdersQueryDto, BrandOrdersQueryDto, OrdersQueryDto } from './orders.dto';

const STATUS_AR: Record<OrderStatus, string> = {
  PENDING: 'قيد المراجعة',
  CONFIRMED: 'تم التأكيد',
  PROCESSING: 'قيد التجهيز',
  SHIPPED: 'تم الشحن',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectConnection() private readonly connection: Connection,
    private readonly members: BrandMembersService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
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
    return this.page(this.searchFilter({ brandId: new Types.ObjectId(brandId), deletedAt: null }, query), query, 'BRAND');
  }

  async getForBrand(brandId: string, id: string) {
    const order = await this.orders.findOne({ _id: id, brandId: new Types.ObjectId(brandId), deletedAt: null }).lean();
    if (!order) throw AppError.notFound('Order');
    return this.toView(order, 'BRAND');
  }

  updateByBrand(userId: string, brandId: string, id: string, status: OrderStatus, note?: string) {
    if (status === OrderStatus.CANCELLED && !note) {
      throw AppError.unprocessable('REASON_REQUIRED', 'A cancellation reason is required', [
        { field: 'note', reason: 'required' },
      ]);
    }
    return this.changeStatus({ _id: id, brandId: new Types.ObjectId(brandId), deletedAt: null }, status, { actor: 'BRAND', userId, note });
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

      if (to === OrderStatus.CANCELLED && restocksOnCancel(from)) {
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
            actorType: by.actor === 'ADMIN' ? 'ADMIN' : 'USER',
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
    if (actor !== 'BRAND') await this.notifications.notify(await this.members.memberUserIds(order.brandId), payload);
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
      history: order.statusHistory.map((h) => ({ status: h.status, at: h.at, actor: h.actor, note: h.note ?? null })),
      allowedNextStatuses: allowedNext(order.status, actor),
    };
  }
}
