import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean } from '@/common/pagination';
import { Brand } from '@/brands/brand.schema';
import { BrandsService } from '@/brands/brands.service';
import { Product } from '@/products/product.schema';
import { Cart, CartDocument, CartItem } from './cart.schema';

export const MAX_QTY_PER_LINE = 50;
const MAX_LINES = 50;

export type LineIssue = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';

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
  issue: LineIssue | null;
}

@Injectable()
export class CartsService {
  constructor(
    @InjectModel(Cart.name) private readonly carts: Model<Cart>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly brands: BrandsService,
  ) {}

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
    this.assertQuantity(nextQty, variant.stock);
    if (existing) existing.quantity = nextQty;
    else {
      if (cart.items.length >= MAX_LINES) throw AppError.unprocessable('CART_FULL', 'Your cart is full');
      cart.items.push({ productId: product._id, variantId: variant._id, quantity } as CartItem);
    }
    await cart.save();
    return this.view(userId, brandId);
  }

  async updateItem(userId: string, brandId: string, itemId: string, quantity: number) {
    const cart = await this.find(userId, brandId);
    const item = cart?.items.find((i) => i._id.equals(itemId));
    if (!cart || !item) throw AppError.notFound('Cart item');
    const product = await this.products.findById(item.productId).lean();
    const variant = product?.variants.find((v) => v._id.equals(item.variantId));
    this.assertQuantity(quantity, variant?.stock ?? 0);
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
    return items.map((item) => {
      const product = products.find((p) => p._id.equals(item.productId));
      const variant = product?.variants.find((v) => v._id.equals(item.variantId));
      const unitPrice = variant ? (variant.price ?? product!.price) : 0;
      let issue: LineIssue | null = null;
      if (!product || !variant || product.status !== ProductStatus.ACTIVE) issue = 'UNAVAILABLE';
      else if (variant.stock === 0) issue = 'OUT_OF_STOCK';
      else if (variant.stock < item.quantity) issue = 'INSUFFICIENT_STOCK';
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
        available: variant ? Math.min(variant.stock, MAX_QTY_PER_LINE) : 0,
        issue,
      };
    });
  }

  private assertQuantity(quantity: number, stock: number) {
    if (quantity > MAX_QTY_PER_LINE) {
      throw AppError.unprocessable('QUANTITY_LIMIT', `Up to ${MAX_QTY_PER_LINE} pieces per item`);
    }
    if (quantity > stock) {
      throw AppError.unprocessable('INSUFFICIENT_STOCK', 'Not enough stock for this quantity', [
        { field: 'quantity', reason: `available_${stock}` },
      ]);
    }
  }
}
