export type TrustLevel = 'NEW' | 'GOOD' | 'RISKY';

export interface CustomerTrust {
  delivered: number;
  refused: number;
  level: TrustLevel;
}

/**
 * How reliably a customer takes delivery, across every store on the platform. Stores only ever
 * see these counts, never which stores the orders came from.
 * NEW = no finished order yet; RISKY = has refused parcels and accepts fewer than 70% of them.
 */
export function trustLevel(delivered: number, refused: number): TrustLevel {
  const total = delivered + refused;
  if (total === 0) return 'NEW';
  if (refused > 0 && delivered / total < 0.7) return 'RISKY';
  return 'GOOD';
}

/** New and risky customers confirm cash orders with an email code before the store sees them. */
export const needsConfirmation = (level: TrustLevel) => level !== 'GOOD';
