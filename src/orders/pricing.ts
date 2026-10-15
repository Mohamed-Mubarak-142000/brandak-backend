import { AppError } from '@/common/errors';

export interface PriceLine {
  unitPrice: number;
  quantity: number;
}

export interface ShippingRules {
  shippingZones: { governorate: string; fee: number }[];
  defaultShippingFee: number | null;
  freeShippingThreshold: number | null;
  minOrderAmount: number;
}

export interface Quote {
  subtotal: number;
  shippingFee: number;
  discountTotal: number;
  grandTotal: number;
  currency: 'EGP';
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Server-side order total. The app may display a quote but never decides the price. */
export function computeQuote(lines: PriceLine[], rules: ShippingRules, governorate: string): Quote {
  const subtotal = round(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));

  if (subtotal < rules.minOrderAmount) {
    throw AppError.unprocessable('BELOW_MIN_ORDER', `Minimum order is ${rules.minOrderAmount} EGP`, [
      { field: 'subtotal', reason: `min_${rules.minOrderAmount}` },
    ]);
  }

  const zone = rules.shippingZones.find((z) => z.governorate === governorate);
  const baseFee = zone ? zone.fee : rules.defaultShippingFee;
  if (baseFee === null || baseFee === undefined) {
    throw AppError.unprocessable('NOT_DELIVERABLE', 'This brand does not deliver to the selected governorate', [
      { field: 'governorate', reason: 'not_covered' },
    ]);
  }
  const freeShipping = rules.freeShippingThreshold !== null && subtotal >= rules.freeShippingThreshold;
  const shippingFee = freeShipping ? 0 : round(baseFee);
  const discountTotal = 0; // coupons are out of MVP scope

  return { subtotal, shippingFee, discountTotal, grandTotal: round(subtotal + shippingFee - discountTotal), currency: 'EGP' };
}
