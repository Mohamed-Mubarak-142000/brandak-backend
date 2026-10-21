/** Commission on an order: rate × items total after discounts; shipping is never commissioned. */
export function commissionFor(order: { subtotal: number; discountTotal?: number }, rate: number) {
  const base = Math.max(0, round2(order.subtotal - (order.discountTotal ?? 0)));
  return { rate, base, amount: round2(base * rate) };
}

/**
 * A store stops receiving orders when it owes more than the limit, or has owed something for
 * longer than the settlement window.
 */
export function isBlocked(
  balance: number,
  dueSince: Date | null | undefined,
  terms: { settlementDays: number; maxUnpaidBalance: number },
  now = new Date(),
) {
  if (balance <= 0) return false;
  if (balance > terms.maxUnpaidBalance) return true;
  return !!dueSince && now.getTime() - dueSince.getTime() > terms.settlementDays * 86_400_000;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
