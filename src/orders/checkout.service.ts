import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { OrderPaymentMethod, OrderStatus, ProductStatus } from '@/common/enums';
import { AppError, ErrorDetail } from '@/common/errors';
import { cairoMonthStart } from '@/common/utils/month';
import { withTransaction } from '@/common/utils/transaction';
import { AddressesService, toView as addressView } from '@/addresses/addresses.service';
import { BrandDocument } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { BrandsService } from '@/brands/brands.service';
import { CartsService } from '@/carts/carts.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { Product } from '@/products/product.schema';
import { SubscriptionsService } from '@/subscriptions/subscriptions.service';
import { UsersService } from '@/users/users.service';
import { Counter, Order } from './order.schema';
import { PlaceOrderDto, QuoteDto } from './orders.dto';
import { computeQuote } from './pricing';
import { OrdersService } from './orders.service';

@Injectable()
export class CheckoutService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectConnection() private readonly connection: Connection,
    private readonly brands: BrandsService,
    private readonly members: BrandMembersService,
    private readonly carts: CartsService,
    private readonly addresses: AddressesService,
    private readonly users: UsersService,
    private readonly ordersService: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** Read-only preview with the same rules as placing the order. */
  async quote(userId: string, brandId: string, dto: QuoteDto) {
    const brand = await this.orderableBrand(brandId);
    const address = await this.addresses.getOwned(userId, dto.addressId);
    const cart = await this.carts.find(userId, brandId);
    if (!cart?.items.length) throw AppError.unprocessable('CART_EMPTY', 'Your cart is empty');
    const lines = await this.carts.priceLines(brandId, cart.items);
    const issues = lines.filter((l) => l.issue);
    if (issues.length) throw this.cartIssues(issues.map((l) => ({ field: l.itemId, reason: l.issue! })));
    return {
      items: lines,
      ...computeQuote(lines, brand.settings, address.governorate),
      paymentMethods: [OrderPaymentMethod.COD],
    };
  }

  async placeOrder(userId: string, brandId: string, dto: PlaceOrderDto, idempotencyKey?: string) {
    if (!idempotencyKey || idempotencyKey.length > 100) {
      throw AppError.unprocessable('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (max 100 chars)');
    }
    // A retry of an order that already went through returns the same order.
    const existing = await this.orders.findOne({ userId: new Types.ObjectId(userId), idempotencyKey }).lean();
    if (existing) return this.ordersService.toView(existing);

    const brand = await this.orderableBrand(brandId);
    const usage = await this.orderUsage(brand._id);
    const [user, address, cart] = await Promise.all([
      this.users.getById(userId),
      this.addresses.getOwned(userId, dto.addressId),
      this.carts.find(userId, brandId),
    ]);
    if (!cart?.items.length) throw AppError.unprocessable('CART_EMPTY', 'Your cart is empty');

    let order;
    try {
      order = await withTransaction(this.connection, async (session) => {
        const items = [];
        const problems: ErrorDetail[] = [];
        for (const line of cart.items) {
          const product = await this.products
            .findOne({ _id: line.productId, brandId: brand._id, status: ProductStatus.ACTIVE })
            .session(session);
          const variant = product?.variants.find((v) => v._id.equals(line.variantId));
          if (!product || !variant) {
            problems.push({ field: line._id.toString(), reason: 'UNAVAILABLE' });
            continue;
          }
          // Conditional decrement: never lets stock go negative, even with concurrent checkouts.
          const res = await this.products.updateOne(
            { _id: product._id, variants: { $elemMatch: { _id: variant._id, stock: { $gte: line.quantity } } } },
            { $inc: { 'variants.$.stock': -line.quantity, totalStock: -line.quantity, soldCount: line.quantity } },
            { session },
          );
          if (res.modifiedCount !== 1) {
            problems.push({ field: line._id.toString(), reason: 'INSUFFICIENT_STOCK' });
            continue;
          }
          const unitPrice = variant.price ?? product.price;
          items.push({
            productId: product._id,
            variantId: variant._id,
            title: product.title,
            imageUrl: product.images[0]?.url,
            size: variant.size,
            color: variant.color,
            sku: variant.sku,
            unitPrice,
            quantity: line.quantity,
            lineTotal: Math.round(unitPrice * line.quantity * 100) / 100,
          });
        }
        // Throwing aborts the transaction, which also rolls back the stock already decremented.
        if (problems.length) throw this.cartIssues(problems);

        const totals = computeQuote(items, brand.settings, address.governorate);
        if (dto.expectedTotal !== undefined && Math.abs(dto.expectedTotal - totals.grandTotal) > 0.009) {
          throw new AppError('PRICE_CHANGED', 'Prices or shipping changed. Please review the new total.', HttpStatus.CONFLICT, [
            { field: 'grandTotal', reason: String(totals.grandTotal) },
          ]);
        }

        const counter = await this.counters.findOneAndUpdate(
          { _id: 'order' },
          { $inc: { seq: 1 } },
          { upsert: true, new: true, session },
        );
        const now = new Date();
        const [created] = await this.orders.create(
          [
            {
              orderNumber: `BR-${String(counter.seq).padStart(6, '0')}`,
              userId: user._id,
              brandId: brand._id,
              brandSnapshot: { name: brand.name, slug: brand.slug, phone: brand.contact?.phone },
              customer: { name: address.recipientName || user.name, phone: address.phone || user.phone },
              items,
              addressSnapshot: addressView(address),
              subtotal: totals.subtotal,
              shippingFee: totals.shippingFee,
              discountTotal: totals.discountTotal,
              grandTotal: totals.grandTotal,
              paymentMethod: dto.paymentMethod ?? OrderPaymentMethod.COD,
              status: OrderStatus.PENDING,
              statusHistory: [{ status: OrderStatus.PENDING, at: now, by: user._id, actor: 'CUSTOMER' }],
              notes: dto.notes ?? '',
              idempotencyKey,
            },
          ],
          { session },
        );
        await this.carts.deleteById(cart._id, session);
        return created;
      });
    } catch (e: any) {
      // Two concurrent requests with the same key: the loser returns the winner's order.
      if (e?.code === 11000 && e?.keyPattern?.idempotencyKey) {
        const winner = await this.orders.findOne({ userId: new Types.ObjectId(userId), idempotencyKey }).lean();
        if (winner) return this.ordersService.toView(winner);
      }
      throw e;
    }

    const sellers = await this.members.memberUserIds(brand._id);
    await this.notifications.notify(sellers, {
      type: 'ORDER_PLACED',
      title: 'طلب جديد',
      body: `طلب ${order.orderNumber} بقيمة ${order.grandTotal} ج.م`,
      data: { orderId: order.id },
    });
    // Warn the store once at 80% of its monthly orders and once when it hits the limit.
    if (usage.limit) {
      const used = usage.used + 1;
      if (used === usage.limit || used === Math.ceil(usage.limit * 0.8)) {
        const full = used === usage.limit;
        await this.notifications.notify(sellers, {
          type: 'ORDER_LIMIT',
          title: full ? 'وصلت لحد طلبات الشهر' : 'قربت من حد طلبات الشهر',
          body: full
            ? `استقبلت ${used} طلب الشهر ده، وده حد باقتك. متجرك مش هيستقبل طلبات جديدة لحد أول الشهر الجاي أو لحد ما تطوّر باقتك.`
            : `استقبلت ${used} من ${usage.limit} طلب مسموحين في باقتك الشهر ده. طوّر باقتك عشان متوقفش.`,
          data: { used: String(used), limit: String(usage.limit) },
        });
      }
    }
    return this.ordersService.toView(order.toObject());
  }

  private async orderableBrand(brandId: string): Promise<BrandDocument> {
    const brand = await this.brands.getById(brandId);
    if (!this.brands.isVisible(brand)) throw AppError.notFound('Brand');
    if (!brand.settings.acceptsOrders) {
      throw AppError.unprocessable('BRAND_NOT_ACCEPTING_ORDERS', 'This brand is not accepting orders right now');
    }
    const { used, limit } = await this.orderUsage(brand._id);
    if (limit != null && used >= limit) {
      throw AppError.unprocessable('STORE_ORDER_LIMIT', 'This store reached its monthly order limit');
    }
    return brand;
  }

  /** Orders this calendar month (Cairo time) that count against the plan; cancelled ones don't. */
  async orderUsage(brandId: Types.ObjectId) {
    const current = await this.subscriptions.currentFor(brandId);
    const limit = current?.planSnapshot.limits.maxOrdersPerMonth ?? null;
    if (limit == null) return { used: 0, limit: null };
    const used = await this.orders.countDocuments({
      brandId,
      createdAt: { $gte: cairoMonthStart() },
      status: { $ne: OrderStatus.CANCELLED },
    });
    return { used, limit };
  }

  private cartIssues(details: ErrorDetail[]) {
    return new AppError('CART_HAS_ISSUES', 'Some items are unavailable or out of stock', HttpStatus.CONFLICT, details);
  }
}

