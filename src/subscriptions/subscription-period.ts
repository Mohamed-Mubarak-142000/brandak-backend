import { BillingPeriod } from '@/common/enums';

const DAY_MS = 86_400_000;

export const DURATION_DAYS: Record<BillingPeriod, number> = {
  [BillingPeriod.MONTHLY]: 30,
  [BillingPeriod.YEARLY]: 365,
};

/**
 * A paid period starts now, or — when the brand renews early — right after its current paid
 * period ends, so early renewals never lose days.
 */
export function computePeriod(now: Date, currentPaidUntil: Date | null, durationDays: number) {
  const startsAt =
    currentPaidUntil && currentPaidUntil.getTime() > now.getTime() ? new Date(currentPaidUntil) : new Date(now);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationDays * DAY_MS) };
}

/** Monthly-equivalent revenue of a subscription, for MRR. */
export function monthlyEquivalent(price: number, durationDays: number) {
  return Math.round((price * 30 * 100) / durationDays) / 100;
}
