import type { Order } from '../features/contracts';

export const orderStatusLabels: Record<Order['status'], string> = {
  pending: 'Awaiting payment',
  paid: 'Paid - awaiting fulfillment',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

export const paymentStatusLabels: Record<Order['payment_status'], string> = {
  pending: 'Not confirmed',
  confirmed: 'Confirmed',
};

export function isOpenOrder(order: Order): boolean {
  return order.status === 'pending' || order.status === 'paid';
}

export const orderRefreshInterval = 5_000;
