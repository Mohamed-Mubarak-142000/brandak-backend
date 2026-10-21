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
