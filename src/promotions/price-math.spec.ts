import { activeSalePercent, couponDiscount, salePrice, unitPriceNow } from './price-math';

describe('price math', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const sale = { percent: 20, startsAt: new Date('2026-11-27T00:00:00Z'), endsAt: new Date('2026-11-28T00:00:00Z') };

  it('applies a sale only inside its window', () => {
    expect(activeSalePercent(sale, now)).toBe(20);
    expect(activeSalePercent(sale, new Date('2026-11-28T00:00:00Z'))).toBe(0);
    expect(activeSalePercent(sale, new Date('2026-11-26T23:59:59Z'))).toBe(0);
    expect(activeSalePercent(null, now)).toBe(0);
  });

  it('prices variants with their own price, then the sale', () => {
    expect(salePrice(333, 15)).toBe(283.05);
    expect(unitPriceNow({ price: 350, sale }, { price: null }, now)).toBe(280);
    expect(unitPriceNow({ price: 350, sale }, { price: 400 }, now)).toBe(320);
    expect(unitPriceNow({ price: 350 }, {}, now)).toBe(350);
  });

  it('computes coupon discounts with caps', () => {
    expect(couponDiscount({ type: 'PERCENT', value: 10 }, 700)).toBe(70);
    expect(couponDiscount({ type: 'PERCENT', value: 50, maxDiscount: 100 }, 700)).toBe(100);
    expect(couponDiscount({ type: 'FIXED', value: 50 }, 700)).toBe(50);
    expect(couponDiscount({ type: 'FIXED', value: 900 }, 700)).toBe(700);
  });
});
