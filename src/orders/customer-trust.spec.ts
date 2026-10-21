import { needsConfirmation, trustLevel } from './customer-trust';
import { canTransition, restocks } from './order-state';
import { OrderStatus as S } from '@/common/enums';

describe('customer trust', () => {
  it('rates customers by how often they accept parcels', () => {
    expect(trustLevel(0, 0)).toBe('NEW');
    expect(trustLevel(3, 0)).toBe('GOOD');
    expect(trustLevel(4, 1)).toBe('GOOD'); // 80% accepted
    expect(trustLevel(1, 1)).toBe('RISKY');
    expect(trustLevel(0, 1)).toBe('RISKY');
    expect(needsConfirmation('NEW')).toBe(true);
    expect(needsConfirmation('RISKY')).toBe(true);
    expect(needsConfirmation('GOOD')).toBe(false);
  });

  it('lets only the customer confirm, the system expire, and the store refuse shipped parcels', () => {
    expect(canTransition(S.AWAITING_CONFIRMATION, S.PENDING, 'CUSTOMER')).toBe(true);
    expect(canTransition(S.AWAITING_CONFIRMATION, S.PENDING, 'BRAND')).toBe(false);
    expect(canTransition(S.AWAITING_CONFIRMATION, S.CANCELLED, 'SYSTEM')).toBe(true);
    expect(canTransition(S.PENDING, S.CANCELLED, 'SYSTEM')).toBe(false);
    expect(canTransition(S.SHIPPED, S.REFUSED, 'BRAND')).toBe(true);
    expect(canTransition(S.PROCESSING, S.REFUSED, 'BRAND')).toBe(false);
    expect(restocks(S.SHIPPED, S.REFUSED)).toBe(true);
    expect(restocks(S.SHIPPED, S.CANCELLED)).toBe(false);
    expect(restocks(S.AWAITING_CONFIRMATION, S.CANCELLED)).toBe(true);
  });
});
