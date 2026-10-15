import { AppError } from '@/common/errors';
import { computeQuote, ShippingRules } from './pricing';

const rules: ShippingRules = {
  shippingZones: [
    { governorate: 'CAI', fee: 50 },
    { governorate: 'GIZ', fee: 60 },
  ],
  defaultShippingFee: null,
  freeShippingThreshold: null,
  minOrderAmount: 0,
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return null;
};

describe('computeQuote', () => {
  it('sums lines and applies the zone fee', () => {
    const q = computeQuote(
      [
        { unitPrice: 350, quantity: 2 },
        { unitPrice: 99.5, quantity: 1 },
      ],
      rules,
      'CAI',
    );
    expect(q).toEqual({ subtotal: 799.5, shippingFee: 50, discountTotal: 0, grandTotal: 849.5, currency: 'EGP' });
  });

  it('falls back to the default fee for other governorates', () => {
    const q = computeQuote([{ unitPrice: 100, quantity: 1 }], { ...rules, defaultShippingFee: 90 }, 'ASN');
    expect(q.shippingFee).toBe(90);
  });

  it('rejects governorates the brand does not deliver to', () => {
    expect(code(() => computeQuote([{ unitPrice: 100, quantity: 1 }], rules, 'ASN'))).toBe('NOT_DELIVERABLE');
  });

  it('gives free shipping above the threshold', () => {
    const q = computeQuote([{ unitPrice: 500, quantity: 2 }], { ...rules, freeShippingThreshold: 1000 }, 'GIZ');
    expect(q.shippingFee).toBe(0);
    expect(q.grandTotal).toBe(1000);
  });

  it('enforces the minimum order amount', () => {
    expect(code(() => computeQuote([{ unitPrice: 100, quantity: 1 }], { ...rules, minOrderAmount: 200 }, 'CAI'))).toBe(
      'BELOW_MIN_ORDER',
    );
  });

  it('avoids floating point drift', () => {
    const q = computeQuote([{ unitPrice: 0.1, quantity: 3 }], { ...rules, shippingZones: [{ governorate: 'CAI', fee: 0.2 }] }, 'CAI');
    expect(q.grandTotal).toBe(0.5);
  });
});
