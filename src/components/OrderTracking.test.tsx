import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyOrders, OrderPage } from './Checkout';
import type { OrderDetail } from '../features/contracts';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc } }));
const orderId = '30000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000001';
const createdAt = '2026-01-01T00:00:00Z';
const initial: OrderDetail = {
  order: {
    id: orderId, reference: 'BRN-TRACKING', customer_id: customerId, customer_name: 'Tracking customer',
    phone: '+251900000000', telegram: '', currency: 'USD', total_minor: 1497,
    status: 'pending', payment_status: 'pending', created_at: createdAt, updated_at: createdAt,
  },
  items: [{
    id: 'item-one', plan_id: 'plan-one', name: 'Monthly subscription', description: 'Test fixture',
    qty: 3, unit_minor: 499, billing_days: 30, player_id: null,
  }],
  events: [], payment: null, deliveries: [],
};
let detail: OrderDetail;
let failure: { message: string; code: string } | null;
let clients: QueryClient[];

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  detail = structuredClone(initial);
  failure = null;
  clients = [];
  rpc.mockReset().mockImplementation(async (_name: string, input: { resource: string }) => {
    if (input.resource === 'order' || input.resource === 'my_orders') {
      return {
        data: failure ? null : input.resource === 'order' ? structuredClone(detail)
          : { rows: [structuredClone(detail.order)], page: 1, page_size: 10, total: 1 },
        error: failure,
      };
    }
    if (input.resource === 'profile') return { data: { id: customerId, name: 'Tracking customer', email: 'tracking@example.test', phone: '', telegram: '', created_at: createdAt }, error: null };
    return { data: { telegram_url: 'https://t.me/brenstore', manual_payment_instructions: 'Contact staff first.' }, error: null };
  });
});

afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

function setup(path = `/orders/${orderId}`) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/orders/:id" element={<OrderPage />} />
    <Route path="/orders" element={<MyOrders />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

async function tick(ms = 10) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function reads(resource = 'order') {
  return rpc.mock.calls.filter(([, input]) => input.resource === resource).length;
}

function confirmPayment() {
  detail.order.status = 'paid';
  detail.order.payment_status = 'confirmed';
  detail.payment = { reference: 'PAYMENT-TRACKING', amount_minor: 1497, currency: 'USD', confirmed_by: 'staff', confirmed_at: createdAt };
}

describe('customer order tracking through the real query hook', () => {
  it('separates a saved order from payment and delivery without exposing staff events', async () => {
    detail.events = [{ id: 'event', actor_id: 'staff', action: 'note', note: 'Private staff note', created_at: createdAt }];
    setup(); await tick();
    const progress = screen.getByRole('region', { name: 'Order progress' });
    expect(within(progress).getByRole('status')).toHaveTextContent('Order saved, but payment is not yet confirmed.');
    expect(within(progress).getAllByText('Complete')).toHaveLength(1);
    expect(within(progress).getAllByText('Pending')).toHaveLength(2);
    expect(within(progress).getByText('Payment confirmed').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
    expect(screen.getByText(/Last successful check:/)).toBeInTheDocument();
    expect(screen.queryByText('Private staff note')).not.toBeInTheDocument();
  });

  it('polls at five-second intervals, observes staff transitions, and stops when fulfilled', async () => {
    setup(); await tick();
    expect(reads()).toBe(1);
    confirmPayment();
    await tick(4_900);
    expect(reads()).toBe(1);
    await tick(100);
    expect(reads()).toBe(2);
    expect(screen.getByText('Paid - awaiting fulfillment')).toBeInTheDocument();
    expect(screen.getByText('Access delivered').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('heading', { name: 'Payment instructions' })).not.toBeInTheDocument();
    detail.order.status = 'fulfilled';
    await tick(5_000);
    expect(screen.getByText('Fulfillment complete.')).toBeInTheDocument();
    expect(reads()).toBe(3);
    await tick(20_000);
    expect(reads()).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh order status' }));
    await tick();
    expect(reads()).toBe(4);
  });

  it('counts partial top-up delivery across all quantities and does not promise a refund or notification', async () => {
    confirmPayment();
    detail.items = [
      { ...initial.items[0], name: '100 diamonds', qty: 2, player_id: '123456789' },
      { ...initial.items[0], id: 'item-two', plan_id: 'plan-two', name: '210 diamonds', qty: 1, player_id: '987654321' },
    ];
    detail.deliveries = [
      { id: 'one', order_item_id: 'item-one', unit_index: 1, player_id: '123456789', package_name: '100 diamonds', status: 'delivered', delivered_at: createdAt },
      { id: 'two', order_item_id: 'item-one', unit_index: 2, player_id: '123456789', package_name: '100 diamonds', status: 'processing', delivered_at: null },
      { id: 'three', order_item_id: 'item-two', unit_index: 1, player_id: '987654321', package_name: '210 diamonds', status: 'failed', delivered_at: null },
    ];
    setup(); await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Partially delivered: 1 of 3 units.');
    expect(screen.getByText(/does not automatically refund your payment/)).toBeInTheDocument();
    expect(screen.getByText('Delivery issue — contact staff')).toBeInTheDocument();
    expect(screen.queryByText(/team has been notified/)).not.toBeInTheDocument();
    expect(screen.queryByText('Fulfillment complete.')).not.toBeInTheDocument();
  });

  it('shows fulfilled top-ups as complete only after the backend marks the order fulfilled', async () => {
    confirmPayment();
    detail.order.status = 'fulfilled';
    detail.items[0].player_id = '123456789';
    setup(); await tick();
    expect(screen.getByText('All purchased top-up units are delivered.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Order progress' })).getAllByText('Complete')).toHaveLength(3);
  });

  it('shows cancellation without payment instructions or automatic refund claims and stops polling', async () => {
    detail.order.status = 'cancelled';
    setup(); await tick();
    expect(screen.getByText(/Order cancelled. Do not send payment/)).toHaveTextContent('cancellation does not issue a refund');
    expect(screen.queryByRole('heading', { name: 'Payment instructions' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Not completed')).toHaveLength(2);
    await tick(15_000);
    expect(reads()).toBe(1);
  });

  it('retains the last successful status and timestamp on refresh failure, then recovers', async () => {
    setup(); await tick();
    const checkedAt = screen.getByText(/Last successful check:/).textContent;
    failure = { message: 'Connection unavailable', code: '08006' };
    await tick(5_000);
    expect(screen.getByRole('alert')).toHaveTextContent('Showing the last saved status; it may be out of date.');
    expect(screen.getByText('BRN-TRACKING')).toBeInTheDocument();
    expect(screen.getByText(/Last successful check:/).textContent).toBe(checkedAt);
    failure = null;
    confirmPayment();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh order status' }));
    await tick();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Paid - awaiting fulfillment')).toBeInTheDocument();
    expect(screen.getByText(/Last successful check:/).textContent).not.toBe(checkedAt);
  });

  it('shows an initial failure with a working retry instead of simulated order data', async () => {
    failure = { message: 'Order not found', code: '42501' };
    setup(); await tick();
    expect(screen.getByRole('heading', { name: 'Order unavailable' })).toBeInTheDocument();
    expect(screen.queryByText('BRN-TRACKING')).not.toBeInTheDocument();
    await tick(10_000);
    expect(reads()).toBe(1);
    failure = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry order' }));
    await tick();
    expect(screen.getByText('BRN-TRACKING')).toBeInTheDocument();
  });

  it('pauses interval requests when hidden and resumes when visible', async () => {
    setup(); await tick();
    focusManager.setFocused(false);
    await tick(15_000);
    expect(reads()).toBe(1);
    await act(async () => { focusManager.setFocused(true); });
    await tick();
    expect(reads()).toBe(2);
    await tick(5_000);
    expect(reads()).toBe(3);
  });

  it('cancels interval requests when leaving the page', async () => {
    const view = setup(); await tick();
    view.unmount();
    await tick(15_000);
    expect(reads()).toBe(1);
  });

  it('does not request an invalid order or its payment instructions', async () => {
    setup('/orders/not-a-uuid'); await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid order link.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refreshes open orders in My Orders and uses the same payment and fulfillment labels', async () => {
    setup('/orders'); await tick();
    expect(screen.getByRole('link', { name: /BRN-TRACKING/ })).toHaveTextContent('Awaiting payment · Payment: Not confirmed');
    confirmPayment();
    await tick(5_000);
    expect(screen.getByRole('link', { name: /BRN-TRACKING/ })).toHaveTextContent('Paid - awaiting fulfillment · Payment: Confirmed');
    detail.order.status = 'fulfilled';
    await tick(5_000);
    expect(reads('my_orders')).toBe(3);
    await tick(15_000);
    expect(reads('my_orders')).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh orders' }));
    await tick();
    expect(reads('my_orders')).toBe(4);
  });

  it('keeps a stale order list visible with a working retry after a failed refresh', async () => {
    setup('/orders'); await tick();
    failure = { message: 'Network unavailable', code: '08006' };
    await tick(5_000);
    expect(screen.getByRole('alert')).toHaveTextContent('Showing the last saved list; it may be out of date.');
    expect(screen.getByRole('link', { name: /BRN-TRACKING/ })).toBeInTheDocument();
    failure = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry orders' }));
    await tick();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
