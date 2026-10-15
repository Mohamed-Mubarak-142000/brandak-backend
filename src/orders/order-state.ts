import { OrderStatus } from '@/common/enums';

export type OrderActor = 'CUSTOMER' | 'BRAND' | 'ADMIN';

const { PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED } = OrderStatus;

/** Forward-only lifecycle. Returns after shipping are out of MVP scope. */
const BRAND_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [PENDING]: [CONFIRMED, CANCELLED],
  [CONFIRMED]: [PROCESSING, CANCELLED],
  [PROCESSING]: [SHIPPED, CANCELLED],
  [SHIPPED]: [DELIVERED],
  [DELIVERED]: [],
  [CANCELLED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  switch (actor) {
    case 'CUSTOMER':
      // Customers can cancel only before the brand confirms.
      return from === PENDING && to === CANCELLED;
    case 'ADMIN':
      // Admins can cancel any open order (e.g. after a complaint), but not move fulfilment forward.
      return to === CANCELLED && ![SHIPPED, DELIVERED, CANCELLED].includes(from);
    case 'BRAND':
      return BRAND_TRANSITIONS[from].includes(to);
  }
}

export function allowedNext(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return Object.values(OrderStatus).filter((to) => canTransition(from, to, actor));
}

/** Stock goes back to the shelf only if the goods never left the brand. */
export function restocksOnCancel(from: OrderStatus): boolean {
  return [PENDING, CONFIRMED, PROCESSING].includes(from);
}
