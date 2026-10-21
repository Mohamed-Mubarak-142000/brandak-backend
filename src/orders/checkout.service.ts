import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { OrderPaymentMethod, OrderStatus, OtpPurpose, ProductStatus } from '@/common/enums';
import { AppError, ErrorDetail } from '@/common/errors';
import { withTransaction } from '@/common/utils/transaction';
import { AddressesService, toView as addressView } from '@/addresses/addresses.service';
import { BrandDocument } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { BrandsService } from '@/brands/brands.service';
import { CartsService, productQuantities } from '@/carts/carts.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { Product } from '@/products/product.schema';
import { OtpService } from '@/auth/otp.service';
import { unitPriceFor } from '@/promotions/price-math';
import { PromotionsService } from '@/promotions/promotions.service';
import { CommissionsService } from '@/commissions/commissions.service';
import { UsersService } from '@/users/users.service';
import { BrandBlock } from './brand-block.schema';
import { needsConfirmation } from './customer-trust';
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
    private readonly commissions: CommissionsService,
    private readonly otp: OtpService,
    private readonly promotions: PromotionsService,
    @InjectModel(BrandBlock.name) private readonly blocks: Model<BrandBlock>,
  ) {}

  /** Read-only preview with the same rules as placing the order. */
  async quote(userId: string, brandId: string, dto: QuoteDto) {
    const brand = await this.orderableBrand(brandId);
    const where = await this.destination(userId, brand, dto);
    const cart = await this.carts.find(userId, brandId);
    if (!cart?.items.length) throw AppError.unprocessable('CART_EMPTY', 'Your cart is empty');
    const lines = await this.carts.priceLines(brandId, cart.items);
    const issues = lines.filter((l) => l.issue);
    if (issues.length) throw this.cartIssues(issues.map((l) => ({ field: l.itemId, reason: l.issue! })));
    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const coupon = dto.couponCode ? await this.promotions.resolve(dto.couponCode, brand._id, userId, subtotal) : null;
    return {
      items: lines,
      ...computeQuote(lines, brand.settings, where.governorate, coupon?.discount ?? 0),
      fulfillment: where.fulfillment,
      coupon: coupon && { code: coupon.code, discount: coupon.discount },
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
    if (await this.blocks.exists({ brandId: brand._id, userId: new Types.ObjectId(userId) })) {
      throw AppError.forbidden('ORDER_NOT_ALLOWED', 'This store cannot take your order');
    }
    // New customers, and those who refuse parcels, confirm the order with an email code first.
    const confirm = needsConfirmation((await this.ordersService.trustFor(userId)).level);
    const firstStatus = confirm ? OrderStatus.AWAITING_CONFIRMATION : OrderStatus.PENDING;
    const [user, where, cart] = await Promise.all([
      this.users.getById(userId),
      this.destination(userId, brand, dto),
      this.carts.find(userId, brandId),
    ]);
    const address = where.address;
    if (!cart?.items.length) throw AppError.unprocessable('CART_EMPTY', 'Your cart is empty');

    let order;
    try {
      order = await withTransaction(this.connection, async (session) => {
        const items = [];
        const problems: ErrorDetail[] = [];
        const perProduct = productQuantities(cart.items);
        for (const line of cart.items) {
          const product = await this.products
            .findOne({ _id: line.productId, brandId: brand._id, status: ProductStatus.ACTIVE })
            .session(session);
          const variant = product?.variants.find((v) => v._id.equals(line.variantId));
          if (!product || !variant) {
            problems.push({ field: line._id.toString(), reason: 'UNAVAILABLE' });
            continue;
          }
          const productQty = perProduct.get(product._id.toString()) ?? line.quantity;
          if (productQty < (product.wholesale?.minQty ?? 1)) {
            problems.push({ field: line._id.toString(), reason: 'BELOW_MIN_QTY' });
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
          const unitPrice = unitPriceFor(product, variant, productQty);
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

        const itemsTotal = items.reduce((s, i) => s + i.lineTotal, 0);
        const coupon = dto.couponCode ? await this.promotions.resolve(dto.couponCode, brand._id, userId, itemsTotal) : null;
        const totals = computeQuote(items, brand.settings, where.governorate, coupon?.discount ?? 0);
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
              customer: { name: address?.recipientName || user.name, phone: address?.phone || user.phone },
              items,
              addressSnapshot: address ? addressView(address) : null,
              fulfillment: where.fulfillment,
              pickup: where.pickup,
              subtotal: totals.subtotal,
              shippingFee: totals.shippingFee,
              discountTotal: totals.discountTotal,
              coupon: coupon ? { couponId: coupon.couponId, code: coupon.code, discount: totals.discountTotal, fundedBy: coupon.fundedBy } : undefined,
              grandTotal: totals.grandTotal,
              paymentMethod: dto.paymentMethod ?? OrderPaymentMethod.COD,
              status: firstStatus,
              statusHistory: [{ status: firstStatus, at: now, by: user._id, actor: 'CUSTOMER' }],
              notes: dto.notes ?? '',
              idempotencyKey,
            },
          ],
          { session },
        );
        if (coupon) await this.promotions.redeem({ ...coupon, discount: totals.discountTotal }, user._id, created._id, session);
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

    if (confirm) {
      // Several stores can be checked out back to back; one code (still valid) confirms them all.
      await this.otp.issue(userId, OtpPurpose.CONFIRM_ORDER, 'email', user.email).catch((e) => {
        if (e?.code !== 'OTP_COOLDOWN') throw e;
      });
    } else {
      await this.notifications.notify(await this.members.memberUserIds(brand._id), {
        type: 'ORDER_PLACED',
        title: 'طلب جديد',
        body: `طلب ${order.orderNumber} بقيمة ${order.grandTotal} ج.م`,
        data: { orderId: order.id },
      });
    }
    return this.ordersService.toView(order.toObject());
  }

  /** Delivery address (and its governorate for shipping) or the store's pickup point. */
  private async destination(userId: string, brand: BrandDocument, dto: QuoteDto) {
    if (dto.fulfillment === 'PICKUP') {
      const p = brand.settings.pickup;
      if (!p?.enabled) throw AppError.unprocessable('PICKUP_NOT_AVAILABLE', 'This store does not offer pickup');
      return {
        fulfillment: 'PICKUP' as const,
        governorate: null,
        address: null,
        pickup: { address: p.address, governorate: p.governorate, hours: p.hours, mapUrl: p.mapUrl },
      };
    }
    if (!dto.addressId) throw AppError.unprocessable('ADDRESS_REQUIRED', 'Choose a delivery address');
    const address = await this.addresses.getOwned(userId, dto.addressId);
    return { fulfillment: 'DELIVERY' as const, governorate: address.governorate as string, address, pickup: null };
  }

  private async orderableBrand(brandId: string): Promise<BrandDocument> {
    const brand = await this.brands.getById(brandId);
    if (!this.brands.isVisible(brand)) throw AppError.notFound('Brand');
    if (!brand.settings.acceptsOrders) {
      throw AppError.unprocessable('BRAND_NOT_ACCEPTING_ORDERS', 'This brand is not accepting orders right now');
    }
    // A store that owes too much commission (or for too long) pauses until it settles.
    await this.commissions.assertCanReceiveOrders(brand._id);
    return brand;
  }

  private cartIssues(details: ErrorDetail[]) {
    return new AppError('CART_HAS_ISSUES', 'Some items are unavailable or out of stock', HttpStatus.CONFLICT, details);
  }
}

