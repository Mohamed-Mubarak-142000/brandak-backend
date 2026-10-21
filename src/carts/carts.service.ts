import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean } from '@/common/pagination';
import { Brand } from '@/brands/brand.schema';
import { BrandsService } from '@/brands/brands.service';
import { Product } from '@/products/product.schema';
import { Cart, CartDocument, CartItem } from './cart.schema';
import { unitPriceFor } from '@/promotions/price-math';
import { CONTACT_CHANNEL, ContactChannel } from '@/auth/contact-channel';
import { NotificationsService } from '@/notifications/notifications.service';
import { UsersService } from '@/users/users.service';
import { TrackingService } from '@/tracking/tracking.service';

export const MAX_QTY_PER_LINE = 50;
/** Wholesale products sell by the dozen or carton. */
export const MAX_WHOLESALE_QTY = 1000;
const MAX_LINES = 50;

/** BELOW_MIN_QTY: a wholesale product with fewer pieces in the cart than its minimum. */
export type LineIssue = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'BELOW_MIN_QTY';

export interface PricedLine {
  itemId: string;
  productId: string;
  variantId: string;
  title: string;
  imageUrl: string | null;
  size: string | null;
  color: string | null;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  available: number;
  /** Wholesale minimum for the product (1 when there is none). */
  minQty: number;
  issue: LineIssue | null;
}

@Injectable()
export class CartsService {
  constructor(
    @InjectModel(Cart.name) private readonly carts: Model<Cart>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly brands: BrandsService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    @Inject(CONTACT_CHANNEL) private readonly mail: ContactChannel,
    private readonly tracking: TrackingService,
  ) {}

  /**
   * Reminds customers of carts they left 1–3 days ago (once per cart change), in the app and
   * by email. Runs from the daily cron.
   */
  async remindAbandoned(now = new Date()) {
    const day = 86_400_000;
    const carts = await this.carts
      .find({
        'items.0': { $exists: true },
        updatedAt: { $lte: new Date(now.getTime() - day), $gte: new Date(now.getTime() - 3 * day) },
        $or: [{ remindedAt: null }, { $expr: { $lt: ['$remindedAt', '$updatedAt'] } }],
      })
      .limit(500)
      .lean();
    let sent = 0;
    for (const cart of carts) {
      const [brand, first, user] = await Promise.all([
        this.brands.getById(cart.brandId).catch(() => null),
        this.products.findById(cart.items[0].productId).select('title').lean(),
        this.users.getById(cart.userId.toString()).catch(() => null),
      ]);
      if (!brand || !user) continue;
      const count = cart.items.reduce((n, i) => n + i.quantity, 0);
      const what = first?.title ? `«${first.title}»${count > 1 ? ` و${count - 1} قطعة تانية` : ''}` : `${count} قطعة`;
      await this.notifications.notify(user._id.toString(), {
        type: 'CART_REMINDER',
        title: 'سلتك لسه مستنياك',
        body: `${what} في سلتك من ${brand.name}. كمّل طلبك قبل ما الكمية تخلص.`,
        data: { brandId: cart.brandId.toString() },
        dedupeKey: `cart-${cart._id.toString()}-${cart.updatedAt.toISOString()}`,
      });
      await this.mail
        .sendNotice({
          to: user.email,
          subject: 'سلتك في فاترينة لسه مستنياك',
          title: `لسه عايز ${what}؟`,
          lines: [`سبت منتجات في سلتك من ${brand.name}.`, 'الكميات محدودة، كمّل طلبك من التطبيق وادفع عند الاستلام.'],
        })
        .catch(() => undefined);
      // timestamps: false keeps updatedAt, so a reminded cart isn't reminded again until it changes.
      await this.carts.updateOne({ _id: cart._id }, { $set: { remindedAt: now } }, { timestamps: false });
      sent++;
    }
    return sent;
  }

  /** Summary of every non-empty cart, one per brand. */
  async listMine(userId: string) {
    const carts = await this.carts
      .find({ userId: new Types.ObjectId(userId), 'items.0': { $exists: true } })
      .sort({ updatedAt: -1 })
      .populate('brandId', 'name slug logo')
      .lean();
    return carts.map((c) => {
      const brand = c.brandId as unknown as Lean<Brand>;
      return {
        brand: { id: brand._id.toString(), name: brand.name, slug: brand.slug, logoUrl: brand.logo?.url ?? null },
        itemsCount: c.items.reduce((n, i) => n + i.quantity, 0),
        updatedAt: c.updatedAt,
      };
    });
  }

  async view(userId: string, brandId: string) {
    const cart = await this.find(userId, brandId);
    const brand = await this.brands.getById(brandId);
    const lines = cart ? await this.priceLines(brandId, cart.items) : [];
    const valid = lines.filter((l) => !l.issue);
    return {
      brand: { id: brand.id, name: brand.name, slug: brand.slug, logoUrl: brand.logo?.url ?? null },
      acceptingOrders: this.brands.isVisible(brand) && brand.settings.acceptsOrders,
      items: lines,
      subtotal: Math.round(valid.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
      hasIssues: lines.some((l) => l.issue),
    };
  }

  async addItem(userId: string, brandId: string, productId: string, variantId: string, quantity: number) {
    const brand = await this.brands.getById(brandId);
    if (!this.brands.isVisible(brand)) throw AppError.notFound('Brand');
    const product = await this.products.findOne({ _id: productId, brandId: brand._id, status: ProductStatus.ACTIVE });
    // A product from another brand is "not found" in this brand's cart.
    if (!product) throw AppError.notFound('Product');
    const variant = product.variants.find((v) => v._id.equals(variantId));
    if (!variant) throw AppError.notFound('Variant');

    const cart =
      (await this.find(userId, brandId)) ??
      new this.carts({ userId: new Types.ObjectId(userId), brandId: brand._id, items: [] });
    const existing = cart.items.find((i) => i.productId.equals(product._id) && i.variantId.equals(variant._id));
    const nextQty = (existing?.quantity ?? 0) + quantity;
    this.assertQuantity(nextQty, variant.stock, maxQty(product));
    if (existing) existing.quantity = nextQty;
    else {
      if (cart.items.length >= MAX_LINES) throw AppError.unprocessable('CART_FULL', 'Your cart is full');
      cart.items.push({ productId: product._id, variantId: variant._id, quantity } as CartItem);
    }
    await cart.save();
    const user = await this.users.getById(userId).catch(() => null);
    await this.tracking.event(brand._id, 'AddToCart', {
      contents: [{ id: product.id, quantity, price: unitPriceFor(product, variant, nextQty) }],
      user: user && { id: userId, email: user.email, phone: user.phone },
    });
    return this.view(userId, brandId);
  }

  async updateItem(userId: string, brandId: string, itemId: string, quantity: number) {
    const cart = await this.find(userId, brandId);
    const item = cart?.items.find((i) => i._id.equals(itemId));
    if (!cart || !item) throw AppError.notFound('Cart item');
    const product = await this.products.findById(item.productId).lean();
    const variant = product?.variants.find((v) => v._id.equals(item.variantId));
    this.assertQuantity(quantity, variant?.stock ?? 0, product ? maxQty(product) : MAX_QTY_PER_LINE);
    item.quantity = quantity;
    await cart.save();
    return this.view(userId, brandId);
  }

  async removeItem(userId: string, brandId: string, itemId: string) {
    await this.carts.updateOne(
      { userId: new Types.ObjectId(userId), brandId: new Types.ObjectId(brandId) },
      { $pull: { items: { _id: new Types.ObjectId(itemId) } } },
    );
    return this.view(userId, brandId);
  }

  async clear(userId: string, brandId: string) {
    await this.carts.deleteOne({ userId: new Types.ObjectId(userId), brandId: new Types.ObjectId(brandId) });
  }

  /** Used by checkout inside its transaction once the order is created. */
  async deleteById(cartId: Types.ObjectId, session: ClientSession) {
    await this.carts.deleteOne({ _id: cartId }, { session });
  }

  find(userId: string, brandId: string): Promise<CartDocument | null> {
    return this.carts.findOne({ userId: new Types.ObjectId(userId), brandId: new Types.ObjectId(brandId) });
  }

  /** Current price and availability for each cart line. */
  async priceLines(brandId: string, items: CartItem[]): Promise<PricedLine[]> {
    const products = await this.products
      .find({ _id: { $in: items.map((i) => i.productId) }, brandId: new Types.ObjectId(brandId) })
      .lean();
    const perProduct = productQuantities(items);
    return items.map((item) => {
      const product = products.find((p) => p._id.equals(item.productId));
      const variant = product?.variants.find((v) => v._id.equals(item.variantId));
      const productQty = perProduct.get(item.productId.toString()) ?? item.quantity;
      const unitPrice = variant ? unitPriceFor(product!, variant, productQty) : 0;
      const minQty = product?.wholesale?.minQty ?? 1;
      let issue: LineIssue | null = null;
      if (!product || !variant || product.status !== ProductStatus.ACTIVE) issue = 'UNAVAILABLE';
      else if (variant.stock === 0) issue = 'OUT_OF_STOCK';
      else if (variant.stock < item.quantity) issue = 'INSUFFICIENT_STOCK';
      else if (productQty < minQty) issue = 'BELOW_MIN_QTY';
      return {
        itemId: item._id.toString(),
        productId: item.productId.toString(),
        variantId: item.variantId.toString(),
        title: product?.title ?? '',
        imageUrl: product?.images[0]?.url ?? null,
        size: variant?.size ?? null,
        color: variant?.color ?? null,
        sku: variant?.sku ?? null,
        unitPrice,
        quantity: item.quantity,
        lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
        available: variant ? Math.min(variant.stock, product ? maxQty(product) : MAX_QTY_PER_LINE) : 0,
        minQty,
        issue,
      };
    });
  }

  private assertQuantity(quantity: number, stock: number, max = MAX_QTY_PER_LINE) {
    if (quantity > max) {
      throw AppError.unprocessable('QUANTITY_LIMIT', `Up to ${max} pieces per item`);
    }
    if (quantity > stock) {
      throw AppError.unprocessable('INSUFFICIENT_STOCK', 'Not enough stock for this quantity', [
        { field: 'quantity', reason: `available_${stock}` },
      ]);
    }
  }
}

const maxQty = (p: { wholesale?: unknown }) => (p.wholesale ? MAX_WHOLESALE_QTY : MAX_QTY_PER_LINE);

/** Pieces of each product in the cart, all variants together (wholesale tiers count them so). */
export function productQuantities(items: { productId: Types.ObjectId; quantity: number }[]) {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.productId.toString(), (map.get(i.productId.toString()) ?? 0) + i.quantity);
  return map;
}
