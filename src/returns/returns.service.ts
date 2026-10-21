import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { AlertsService } from '@/alerts/alerts.service';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { round2 } from '@/commissions/commission-math';
import { CommissionsService } from '@/commissions/commissions.service';
import { FilePurpose, OrderStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
import { withTransaction } from '@/common/utils/transaction';
import { NotificationsService } from '@/notifications/notifications.service';
import { Order } from '@/orders/order.schema';
import { Product } from '@/products/product.schema';
import { UploadsService } from '@/uploads/uploads.service';
import { HOLDING_STATUSES, ReturnRequest, ReturnStatus } from './return.schema';
import { CreateReturnDto, ReturnsQueryDto } from './returns.dto';

type Actor = 'CUSTOMER' | 'BRAND' | 'ADMIN';

/** Allowed moves, and who may make them. */
const FLOW: Record<ReturnStatus, Partial<Record<ReturnStatus, Actor[]>>> = {
  [ReturnStatus.REQUESTED]: {
    [ReturnStatus.APPROVED]: ['BRAND', 'ADMIN'],
    [ReturnStatus.REJECTED]: ['BRAND', 'ADMIN'],
    [ReturnStatus.CANCELLED]: ['CUSTOMER'],
  },
  [ReturnStatus.APPROVED]: {
    [ReturnStatus.RECEIVED]: ['BRAND', 'ADMIN'],
    [ReturnStatus.CANCELLED]: ['CUSTOMER'],
  },
  [ReturnStatus.RECEIVED]: { [ReturnStatus.REFUNDED]: ['BRAND', 'ADMIN'] },
  [ReturnStatus.REJECTED]: { [ReturnStatus.APPROVED]: ['ADMIN'] },
  [ReturnStatus.REFUNDED]: {},
  [ReturnStatus.CANCELLED]: {},
};

const CUSTOMER_TEXT: Partial<Record<ReturnStatus, string>> = {
  [ReturnStatus.APPROVED]: 'المتجر وافق على طلب الإرجاع، جهّز المنتجات للاستلام',
  [ReturnStatus.REJECTED]: 'المتجر رفض طلب الإرجاع',
  [ReturnStatus.RECEIVED]: 'المتجر استلم المنتجات المرتجعة',
  [ReturnStatus.REFUNDED]: 'المتجر رجّعلك فلوس المرتجع',
};

/**
 * Organized returns: within the store's return window after delivery, the customer picks the
 * items, a reason and photos. The store approves or rejects, receives the items (stock goes back)
 * and refunds (the commission on those items is given back).
 */
@Injectable()
export class ReturnsService {
  constructor(
    @InjectModel(ReturnRequest.name) private readonly returns: Model<ReturnRequest>,
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectConnection() private readonly connection: Connection,
    private readonly commissions: CommissionsService,
    private readonly uploads: UploadsService,
    private readonly members: BrandMembersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
    private readonly alerts: AlertsService,
  ) {}

  /** What the customer can still return from an order, and until when. */
  async eligibility(userId: string, orderId: string) {
    const order = await this.ownOrder(userId, orderId);
    const returnDays = await this.returnDaysFor(order.brandId);
    const until = order.deliveredAt && returnDays > 0 ? new Date(order.deliveredAt.getTime() + returnDays * 86_400_000) : null;
    const taken = await this.takenQuantities(order._id);
    const items = order.items.map((i) => ({
      variantId: i.variantId.toString(),
      title: i.title,
      imageUrl: i.imageUrl,
      size: i.size,
      color: i.color,
      unitPrice: i.unitPrice,
      returnable: Math.max(0, i.quantity - (taken.get(i.variantId.toString()) ?? 0)),
    }));
    const open = order.status === OrderStatus.DELIVERED && !!until && until.getTime() > Date.now();
    return { returnDays, until, open: open && items.some((i) => i.returnable > 0), items };
  }

  async create(userId: string, orderId: string, dto: CreateReturnDto) {
    const order = await this.ownOrder(userId, orderId);
    if (order.status !== OrderStatus.DELIVERED || !order.deliveredAt) {
      throw AppError.unprocessable('RETURN_NOT_ALLOWED', 'Only delivered orders can be returned');
    }
    const returnDays = await this.returnDaysFor(order.brandId);
    if (returnDays <= 0) throw AppError.unprocessable('RETURNS_DISABLED', 'This store does not accept returns');
    if (Date.now() > order.deliveredAt.getTime() + returnDays * 86_400_000) {
      throw AppError.unprocessable('RETURN_WINDOW_CLOSED', `Returns are accepted within ${returnDays} days of delivery`);
    }

    const taken = await this.takenQuantities(order._id);
    const wanted = new Map<string, number>();
    for (const i of dto.items) wanted.set(i.variantId, (wanted.get(i.variantId) ?? 0) + i.quantity);
    const items = [...wanted].map(([variantId, quantity]) => {
      const line = order.items.find((i) => i.variantId.toString() === variantId);
      if (!line) throw AppError.unprocessable('RETURN_ITEM_INVALID', 'An item is not part of this order');
      if (quantity > line.quantity - (taken.get(variantId) ?? 0)) {
        throw AppError.unprocessable('RETURN_QUANTITY_EXCEEDED', `You can't return more of "${line.title}" than you have left`);
      }
      return {
        productId: line.productId,
        variantId: line.variantId,
        title: line.title,
        imageUrl: line.imageUrl,
        size: line.size,
        color: line.color,
        unitPrice: line.unitPrice,
        quantity,
      };
    });
    const images = dto.imageFileIds?.length ? await this.uploads.imageRefs(userId, dto.imageFileIds, FilePurpose.CLAIM_IMAGE) : [];

    const r = await this.returns.create({
      orderId: order._id,
      orderNumber: order.orderNumber,
      brandId: order.brandId,
      userId: order.userId,
      customerName: order.customer.name,
      items,
      reason: dto.reason,
      note: dto.note?.trim() ?? '',
      images,
      refundAmount: refundFor(order, items),
      history: [{ status: ReturnStatus.REQUESTED, at: new Date(), actor: 'CUSTOMER' }],
    });
    await this.notifications.notify(await this.members.memberUserIds(order.brandId), {
      type: 'RETURN_REQUESTED',
      title: 'طلب إرجاع جديد',
      body: `طلب ${order.orderNumber}: ${items.length} منتج`,
      data: { returnId: r.id, orderId: order._id.toString() },
    });
    return this.toView(r.toObject());
  }

  listMine(userId: string, query: ReturnsQueryDto) {
    return this.list({ userId: new Types.ObjectId(userId) }, query);
  }

  listForBrand(brandId: string, query: ReturnsQueryDto) {
    return this.list({ brandId: new Types.ObjectId(brandId) }, query);
  }

  listAll(query: ReturnsQueryDto) {
    return this.list({}, query);
  }

  async getMine(userId: string, id: string) {
    return this.toView(await this.find({ _id: id, userId: new Types.ObjectId(userId) }));
  }

  async getForBrand(brandId: string, id: string) {
    return this.toView(await this.find({ _id: id, brandId: new Types.ObjectId(brandId) }));
  }

  /** Customer withdraws a request before the store receives the items. */
  async cancel(userId: string, id: string) {
    await this.find({ _id: id, userId: new Types.ObjectId(userId) });
    return this.move(id, ReturnStatus.CANCELLED, { actor: 'CUSTOMER', userId });
  }

  async brandMove(brandId: string, userId: string, id: string, to: ReturnStatus, note?: string) {
    await this.find({ _id: id, brandId: new Types.ObjectId(brandId) });
    return this.move(id, to, { actor: 'BRAND', userId, note });
  }

  async adminMove(adminId: string, id: string, to: ReturnStatus, note?: string) {
    return this.move(id, to, { actor: 'ADMIN', userId: adminId, note });
  }

  private async move(id: string, to: ReturnStatus, by: { actor: Actor; userId: string; note?: string }) {
    const updated = await withTransaction(this.connection, async (session) => {
      const r = await this.returns.findById(id).session(session);
      if (!r) throw AppError.notFound('Return');
      const from = r.status;
      if (!FLOW[from][to]?.includes(by.actor)) {
        throw AppError.unprocessable('INVALID_RETURN_TRANSITION', `Can't move a return from ${from} to ${to}`);
      }
      // Guard against a concurrent move.
      const set: Record<string, unknown> = { status: to };
      if (to === ReturnStatus.RECEIVED) {
        for (const item of r.items) {
          await this.products.updateOne(
            { _id: item.productId, 'variants._id': item.variantId },
            { $inc: { 'variants.$.stock': item.quantity, totalStock: item.quantity, soldCount: -item.quantity } },
            { session },
          );
        }
      }
      if (to === ReturnStatus.REFUNDED) {
        const order = await this.orders.findById(r.orderId).session(session).lean();
        if (order) {
          const itemsValue = r.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
          set.commissionReversed = await this.commissions.reverseForReturn(order, itemsValue, session);
        }
      }
      const res = await this.returns.findOneAndUpdate(
        { _id: r._id, status: from },
        { $set: set, $push: { history: { status: to, at: new Date(), actor: by.actor, note: by.note?.trim() || undefined } } },
        { new: true, session },
      );
      if (!res) throw AppError.conflict('RETURN_CHANGED', 'This return was just updated, refresh and try again');
      return res.toObject();
    });

    if (to === ReturnStatus.RECEIVED) for (const id of new Set(updated.items.map((i) => i.productId.toString()))) await this.alerts.check(id);
    if (by.actor !== 'CUSTOMER') {
      await this.audit.log({
        actorId: by.userId,
        actorType: by.actor === 'ADMIN' ? 'ADMIN' : 'USER',
        action: `RETURN_${to}`,
        entityType: 'ReturnRequest',
        entityId: updated._id,
      });
      const text = CUSTOMER_TEXT[to];
      if (text) {
        await this.notifications.notify(updated.userId.toString(), {
          type: 'RETURN_UPDATED',
          title: `مرتجع طلب ${updated.orderNumber}`,
          body: by.note ? `${text}: ${by.note}` : text,
          data: { returnId: updated._id.toString(), orderId: updated.orderId.toString() },
        });
      }
    } else {
      await this.notifications.notify(await this.members.memberUserIds(updated.brandId), {
        type: 'RETURN_CANCELLED',
        title: 'العميل لغى طلب الإرجاع',
        body: `طلب ${updated.orderNumber}`,
        data: { returnId: updated._id.toString() },
      });
    }
    return this.toView(updated);
  }

  private async list(base: FilterQuery<ReturnRequest>, query: ReturnsQueryDto) {
    const filter = { ...base, ...(query.status ? { status: query.status } : {}) };
    const page = await paginate(this.returns, filter, query, { sort: { createdAt: -1 } });
    return new PageResult(page.items.map((r) => this.toView(r)), page.page, page.limit, page.total);
  }

  private async find(filter: FilterQuery<ReturnRequest>) {
    const r = await this.returns.findOne(filter).lean();
    if (!r) throw AppError.notFound('Return');
    return r;
  }

  private async ownOrder(userId: string, orderId: string) {
    const order = await this.orders.findOne({ _id: orderId, userId: new Types.ObjectId(userId), deletedAt: null }).lean();
    if (!order) throw AppError.notFound('Order');
    return order;
  }

  private async returnDaysFor(brandId: Types.ObjectId) {
    const brand = await this.brands.findById(brandId).select('settings.returnDays').lean();
    return brand?.settings?.returnDays ?? 14;
  }

  /** Quantities per variant already in returns that still hold them. */
  private async takenQuantities(orderId: Types.ObjectId) {
    const open = await this.returns.find({ orderId, status: { $in: HOLDING_STATUSES } }).select('items').lean();
    const taken = new Map<string, number>();
    for (const r of open) for (const i of r.items) taken.set(i.variantId.toString(), (taken.get(i.variantId.toString()) ?? 0) + i.quantity);
    return taken;
  }

  private toView(r: Lean<ReturnRequest>) {
    return {
      id: r._id.toString(),
      orderId: r.orderId.toString(),
      orderNumber: r.orderNumber,
      brandId: r.brandId.toString(),
      customerName: r.customerName,
      items: r.items.map((i) => ({ ...i, productId: i.productId.toString(), variantId: i.variantId.toString() })),
      reason: r.reason,
      note: r.note,
      images: r.images.map((i) => i.url),
      refundAmount: r.refundAmount,
      status: r.status,
      history: r.history,
      commissionReversed: r.commissionReversed,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

/** Items value minus their share of the order's discount: what the customer actually paid for them. */
export function refundFor(order: { subtotal: number; discountTotal?: number }, items: { unitPrice: number; quantity: number }[]) {
  const value = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const discountShare = order.subtotal > 0 ? ((order.discountTotal ?? 0) * value) / order.subtotal : 0;
  return Math.max(0, round2(value - discountShare));
}
