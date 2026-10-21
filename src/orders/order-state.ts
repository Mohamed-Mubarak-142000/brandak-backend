import { OrderStatus } from '@/common/enums';

export type OrderActor = 'CUSTOMER' | 'BRAND' | 'ADMIN' | 'SYSTEM';

const { AWAITING_CONFIRMATION, PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUSED } = OrderStatus;

/** Forward-only lifecycle. A parcel refused at the door ends as REFUSED. */
const BRAND_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Not visible to the store until the customer confirms it.
  [AWAITING_CONFIRMATION]: [],
  [PENDING]: [CONFIRMED, CANCELLED],
  [CONFIRMED]: [PROCESSING, CANCELLED],
  [PROCESSING]: [SHIPPED, CANCELLED],
  [SHIPPED]: [DELIVERED, REFUSED],
  [DELIVERED]: [],
  [CANCELLED]: [],
  [REFUSED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  switch (actor) {
    case 'CUSTOMER':
      // Customers confirm their own order, and can cancel only before the brand confirms.
      if (from === AWAITING_CONFIRMATION) return to === PENDING || to === CANCELLED;
      return from === PENDING && to === CANCELLED;
    case 'SYSTEM':
      // Unconfirmed orders expire.
      return from === AWAITING_CONFIRMATION && to === CANCELLED;
    case 'ADMIN':
      // Admins can cancel any open order (e.g. after a complaint), but not move fulfilment forward.
      return to === CANCELLED && ![SHIPPED, DELIVERED, CANCELLED, REFUSED].includes(from);
    case 'BRAND':
      return BRAND_TRANSITIONS[from].includes(to);
  }
}

export function allowedNext(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return Object.values(OrderStatus).filter((to) => canTransition(from, to, actor));
}

/** Stock goes back to the shelf if the goods never left the brand, or came back refused. */
export function restocks(from: OrderStatus, to: OrderStatus): boolean {
  if (to === REFUSED) return true;
  return to === CANCELLED && [AWAITING_CONFIRMATION, PENDING, CONFIRMED, PROCESSING].includes(from);
}

/** @deprecated kept for older callers; use restocks(from, to). */
export function restocksOnCancel(from: OrderStatus): boolean {
  return restocks(from, CANCELLED);
}
