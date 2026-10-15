import { computePeriod, monthlyEquivalent } from './subscription-period';

describe('computePeriod', () => {
  const now = new Date('2026-10-01T10:00:00Z');

  it('starts now for a new subscription', () => {
    const p = computePeriod(now, null, 30);
    expect(p.startsAt).toEqual(now);
    expect(p.endsAt).toEqual(new Date('2026-10-31T10:00:00Z'));
  });

  it('starts after the current period when renewing early', () => {
    const paidUntil = new Date('2026-10-10T00:00:00Z');
    const p = computePeriod(now, paidUntil, 30);
    expect(p.startsAt).toEqual(paidUntil);
    expect(p.endsAt).toEqual(new Date('2026-11-09T00:00:00Z'));
  });

  it('starts now when the previous period already ended', () => {
    const p = computePeriod(now, new Date('2026-09-01T00:00:00Z'), 365);
    expect(p.startsAt).toEqual(now);
  });
});

describe('monthlyEquivalent', () => {
  it('normalizes yearly prices to a month', () => {
    expect(monthlyEquivalent(199, 30)).toBe(199);
    expect(monthlyEquivalent(1990, 365)).toBeCloseTo(163.56, 2);
  });
});
