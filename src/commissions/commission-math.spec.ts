import { commissionFor, isBlocked } from './commission-math';

describe('commission math', () => {
  it('charges the rate on items after discounts, never on shipping', () => {
    expect(commissionFor({ subtotal: 700, discountTotal: 100 }, 0.05)).toEqual({ rate: 0.05, base: 600, amount: 30 });
    expect(commissionFor({ subtotal: 333 }, 0.05)).toEqual({ rate: 0.05, base: 333, amount: 16.65 });
    expect(commissionFor({ subtotal: 50, discountTotal: 80 }, 0.05).amount).toBe(0);
  });

  it('blocks a store that owes more than the limit or past the settlement window', () => {
    const terms = { settlementDays: 14, maxUnpaidBalance: 2000 };
    const now = new Date('2026-10-21T12:00:00Z');
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    expect(isBlocked(0, daysAgo(30), terms, now)).toBe(false);
    expect(isBlocked(500, daysAgo(10), terms, now)).toBe(false);
    expect(isBlocked(500, daysAgo(15), terms, now)).toBe(true);
    expect(isBlocked(2001, daysAgo(1), terms, now)).toBe(true);
    expect(isBlocked(2000, null, terms, now)).toBe(false);
  });
});
