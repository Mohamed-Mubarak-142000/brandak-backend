import { OrderStatus as S } from '@/common/enums';
import { allowedNext, canTransition, restocksOnCancel } from './order-state';

describe('order state machine', () => {
  it('lets the brand move an order forward step by step', () => {
    expect(canTransition(S.PENDING, S.CONFIRMED, 'BRAND')).toBe(true);
    expect(canTransition(S.CONFIRMED, S.PROCESSING, 'BRAND')).toBe(true);
    expect(canTransition(S.PROCESSING, S.SHIPPED, 'BRAND')).toBe(true);
    expect(canTransition(S.SHIPPED, S.DELIVERED, 'BRAND')).toBe(true);
  });

  it('blocks skipping steps and going backwards', () => {
    expect(canTransition(S.PENDING, S.SHIPPED, 'BRAND')).toBe(false);
    expect(canTransition(S.SHIPPED, S.PROCESSING, 'BRAND')).toBe(false);
    expect(canTransition(S.CANCELLED, S.PROCESSING, 'BRAND')).toBe(false);
    expect(canTransition(S.DELIVERED, S.CANCELLED, 'BRAND')).toBe(false);
  });

  it('lets the brand cancel until shipping', () => {
    expect(allowedNext(S.PROCESSING, 'BRAND')).toEqual([S.SHIPPED, S.CANCELLED]);
    expect(canTransition(S.SHIPPED, S.CANCELLED, 'BRAND')).toBe(false);
  });

  it('lets customers cancel only pending orders', () => {
    expect(canTransition(S.PENDING, S.CANCELLED, 'CUSTOMER')).toBe(true);
    expect(canTransition(S.CONFIRMED, S.CANCELLED, 'CUSTOMER')).toBe(false);
    expect(canTransition(S.PENDING, S.CONFIRMED, 'CUSTOMER')).toBe(false);
  });

  it('lets admins only cancel open orders', () => {
    expect(canTransition(S.PROCESSING, S.CANCELLED, 'ADMIN')).toBe(true);
    expect(canTransition(S.PENDING, S.CONFIRMED, 'ADMIN')).toBe(false);
    expect(canTransition(S.SHIPPED, S.CANCELLED, 'ADMIN')).toBe(false);
  });

  it('restocks only orders that never shipped', () => {
    expect(restocksOnCancel(S.PROCESSING)).toBe(true);
    expect(restocksOnCancel(S.SHIPPED)).toBe(false);
  });
});
