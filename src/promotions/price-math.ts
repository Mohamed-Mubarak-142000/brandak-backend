/** Pure price rules shared by the catalog, the cart and checkout, so they can never disagree. */

export interface SaleWindow {
  percent: number;
  startsAt: Date;
  endsAt: Date;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** The sale percent running right now (0 when there is none). */
export function activeSalePercent(sale: SaleWindow | null | undefined, now = new Date()) {
  if (!sale) return 0;
  return sale.startsAt.getTime() <= now.getTime() && now.getTime() < sale.endsAt.getTime() ? sale.percent : 0;
}

export const salePrice = (base: number, percent: number) => (percent > 0 ? round2(base * (1 - percent / 100)) : base);

/** What one unit of a variant costs now: its own price (or the product's), minus a running sale. */
export function unitPriceNow(product: { price: number; sale?: SaleWindow | null }, variant: { price?: number | null }, now = new Date()) {
  return salePrice(variant.price ?? product.price, activeSalePercent(product.sale, now));
}

export interface CouponTerms {
  type: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscount?: number | null;
}

/** Discount a coupon gives on an items subtotal; never more than the subtotal itself. */
export function couponDiscount(c: CouponTerms, subtotal: number) {
  const raw = c.type === 'PERCENT' ? (subtotal * c.value) / 100 : c.value;
  const capped = c.type === 'PERCENT' && c.maxDiscount != null ? Math.min(raw, c.maxDiscount) : raw;
  return round2(Math.max(0, Math.min(capped, subtotal)));
}

export interface WholesaleTerms {
  /** Fewest pieces of the product (all variants together) a customer may order. */
  minQty: number;
  /** Unit price from each quantity up, e.g. [{ minQty: 12, price: 80 }, { minQty: 50, price: 70 }]. */
  tiers: { minQty: number; price: number }[];
}

/** The best wholesale unit price reached by `qty` pieces (null below the first tier). */
export function tierPrice(wholesale: WholesaleTerms | null | undefined, qty: number) {
  let best: number | null = null;
  for (const t of wholesale?.tiers ?? []) if (qty >= t.minQty && (best === null || t.price < best)) best = t.price;
  return best;
}

/**
 * Unit price for `productQty` pieces of the product in the cart (all variants count together):
 * the regular price now, or the wholesale tier price when that is lower.
 */
export function unitPriceFor(
  product: { price: number; sale?: SaleWindow | null; wholesale?: WholesaleTerms | null },
  variant: { price?: number | null },
  productQty: number,
  now = new Date(),
) {
  const regular = unitPriceNow(product, variant, now);
  const tier = tierPrice(product.wholesale, productQty);
  return tier !== null && tier < regular ? tier : regular;
}
