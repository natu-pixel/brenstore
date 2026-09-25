import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Checkout, { intentKey, loadCheckoutIntent, OrderPage, saveCheckoutIntent, verifySavedOrder } from './Checkout';
import { safeTelegramUrl } from '../lib/telegram';
import type { CheckoutIntent } from './Checkout';
import { DatabaseError } from '../features/api';
import type { OrderDetail, Plan } from '../features/api';

const { command, read, resource, cartHook } = vi.hoisted(() => ({ command: vi.fn(), read: vi.fn(), resource: vi.fn(), cartHook: vi.fn() }));
const customerId = '20000000-0000-4000-8000-000000000001';
const planId = '10000000-0000-4000-8000-000000000001';
const orderId = '30000000-0000-4000-8000-000000000001';
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: '20000000-0000-4000-8000-000000000001' } }) }));
vi.mock('../cart', () => ({ useCart: cartHook }));
vi.mock('../features/api', async (original) => ({
  ...await original<typeof import('../features/api')>(),
  runCommand: command, readResource: read,
  useResource: resource,
}));
const plan: Plan = {
  id: planId, name: 'Test plan', slug: 'test', description: 'Shared test plan',
  category_id: null, category_name: null, brand_key: 'netflix', initial: 'T', color_start: '#000', color_end: '#111',
  usd_minor: 499, etb_minor: 54321, usd_compare_minor: null, etb_compare_minor: null, capacity: 10,
  allocated: 0, available: 10, low_stock_threshold: 2, billing_days: 30, status: 'active',
  featured: false, updated_at: '2026-01-01T00:00:00Z', kind: 'seat',
};
const detail: OrderDetail = {
  order: { id: orderId, reference: 'BRN-TEST', customer_id: customerId, customer_name: 'Test Customer', phone: '+251900000000', telegram: '@test', currency: 'USD', total_minor: 499, status: 'pending', payment_status: 'pending', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  items: [{ id: '40000000-0000-4000-8000-000000000001', plan_id: planId, name: 'Test plan', description: 'Shared test plan', qty: 1, unit_minor: 499, billing_days: 30, player_id: null }],
  events: [], payment: null, deliveries: [],
};
const intent = (): CheckoutIntent => ({
  version: 1, customer_id: customerId, state: 'pending', names: ['Test plan'], createdAt: '2026-01-01T00:00:00Z',
  payload: { idempotency_key: '50000000-0000-4000-8000-000000000001', currency: 'USD', name: 'Test Customer', phone: '+251900000000', telegram: '@test', items: [{ plan_id: planId, qty: 1, unit_minor: 499 }] },
});
const cleared = vi.fn();

beforeEach(() => {
  localStorage.clear(); command.mockReset(); read.mockReset().mockResolvedValue(detail); cleared.mockReset();
  resource.mockImplementation((name: string) => ({
    data: name === 'profile' ? { name: 'Test Customer', phone: '+251900000000', telegram: '@test' }
      : name === 'order' ? detail
      : name === 'payment_instructions' ? { telegram_url: '', manual_payment_instructions: '' } : [],
    isError: false, isPending: false, refetch: vi.fn(),
  }));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, task: () => Promise<unknown>) => task() } });
  cartHook.mockReturnValue({
    lines: [{ product: plan, current: plan, qty: 1, unitMinor: 499, errors: [] }],
    ready: true, currency: 'USD', subtotalMinor: 499, clearPurchased: cleared, setCurrency: vi.fn(), setQty: vi.fn(), remove: vi.fn(),
  });
});
function setup() {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/checkout']}><Routes>
    <Route path="/checkout" element={<Checkout />} /><Route path="/orders/:id" element={<p>Persisted order page</p>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

describe('durable, idempotent checkout', () => {
  it('persists an exact intent and keeps the key across reloads', () => {
    saveCheckoutIntent(intent());
    expect(loadCheckoutIntent(customerId)).toEqual(intent());
  });
  it('does not discard malformed saved attempts or cross-customer payloads', () => {
    localStorage.setItem(intentKey(customerId), '{broken');
    expect(() => loadCheckoutIntent(customerId)).toThrow();
    localStorage.setItem(intentKey(customerId), JSON.stringify({ ...intent(), customer_id: orderId }));
    expect(() => loadCheckoutIntent(customerId)).toThrow();
  });
  it('rejects a persisted order that does not match the submitted quote', () => {
    expect(() => verifySavedOrder(detail, intent())).not.toThrow();
    expect(() => verifySavedOrder({ ...detail, order: { ...detail.order, total_minor: 599 } }, intent())).toThrow('did not match');
    expect(() => verifySavedOrder({ ...detail, order: { ...detail.order, customer_id: orderId } }, intent())).toThrow();
  });
  it('separates a new three-seat cart from an earlier one-seat order and submits the full new quantity', async () => {
    const previous = { ...intent(), state: 'verified' as const, orderId };
    saveCheckoutIntent(previous);
    cartHook.mockReturnValue({
      ...cartHook(), lines: [{ product: plan, current: plan, qty: 3, unitMinor: 499, errors: [] }], subtotalMinor: 1497,
    });
    const newOrderId = '30000000-0000-4000-8000-000000000002';
    command.mockResolvedValue({ id: newOrderId });
    read.mockResolvedValue({
      ...detail, order: { ...detail.order, id: newOrderId, total_minor: 1497 },
      items: [{ ...detail.items[0], qty: 3 }],
    });
    setup();
    const current = await screen.findByRole('region', { name: 'Current cart (3 seats)' });
    expect(within(current).getByText('3 × Test plan')).toBeInTheDocument();
    expect(within(current).getAllByText('USD 14.97')).toHaveLength(2);
    const saved = screen.getByRole('region', { name: 'Previous order — already saved' });
    expect(within(saved).getByText('1 × Test plan')).toBeInTheDocument();
    expect(command).not.toHaveBeenCalled();
    expect(loadCheckoutIntent(customerId)).toEqual(previous);
    fireEvent.click(within(current).getByRole('button', { name: 'Review this cart' }));
    expect(await screen.findByRole('button', { name: /Place pending order/ })).toBeInTheDocument();
    expect(screen.getByText('3 × USD 4.99 · 30 days')).toBeInTheDocument();
    expect(command).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Place pending order/ }));
    expect(await screen.findByText('Persisted order page')).toBeInTheDocument();
    expect(command).toHaveBeenCalledExactlyOnceWith('create_order', expect.objectContaining({
      items: [{ plan_id: planId, qty: 3, unit_minor: 499 }],
      idempotency_key: expect.not.stringMatching(previous.payload.idempotency_key),
    }));
    expect(cleared).toHaveBeenCalledWith([{ plan_id: planId, qty: 3, unit_minor: 499 }], 'USD');
  });
  it('requires an explicit new-cart review even when it matches the previous order', async () => {
    const previous = { ...intent(), state: 'verified' as const, orderId };
    saveCheckoutIntent(previous);
    setup();
    expect(await screen.findByRole('region', { name: 'Current cart (1 seat)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place pending order/ })).not.toBeInTheDocument();
    expect(command).not.toHaveBeenCalled();
    expect(loadCheckoutIntent(customerId)).toEqual(previous);
  });
  it('does not offer an empty cart as a new order', async () => {
    saveCheckoutIntent({ ...intent(), state: 'verified', orderId });
    cartHook.mockReturnValue({ ...cartHook(), lines: [], ready: false, subtotalMinor: 0 });
    setup();
    expect(await screen.findByRole('region', { name: 'Previous order — already saved' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review this cart' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View saved order' })).toHaveAttribute('href', `/orders/${orderId}`);
  });
  it('never replaces an unresolved one-seat request with a new three-seat cart', async () => {
    saveCheckoutIntent(intent());
    cartHook.mockReturnValue({
      ...cartHook(), lines: [{ product: plan, current: plan, qty: 3, unitMinor: 499, errors: [] }], subtotalMinor: 1497,
    });
    command.mockResolvedValue({ id: orderId });
    setup();
    expect(await screen.findByRole('heading', { name: 'Resolve your previous attempt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review this cart' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve saved order attempt' }));
    expect(await screen.findByText('Persisted order page')).toBeInTheDocument();
    expect(command).toHaveBeenCalledExactlyOnceWith('create_order', intent().payload);
  });
  it('preserves an unresolved attempt started in another tab before the new-cart review', async () => {
    saveCheckoutIntent({ ...intent(), state: 'verified', orderId });
    setup();
    const review = await screen.findByRole('button', { name: 'Review this cart' });
    saveCheckoutIntent(intent());
    fireEvent.click(review);
    expect(await screen.findByText('An unresolved order attempt exists. Resolve it before starting a new order.')).toBeInTheDocument();
    expect(loadCheckoutIntent(customerId)).toEqual(intent());
    expect(command).not.toHaveBeenCalled();
  });
  it('retries the same payload after a lost response, reload and changed cart', async () => {
    command.mockRejectedValueOnce(new Error('Network response lost')).mockResolvedValueOnce({ id: orderId });
    const first = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Place pending order/ }));
    expect(await screen.findByText('Network response lost')).toBeInTheDocument();
    const submitted = command.mock.calls[0][1];
    expect(loadCheckoutIntent(customerId)?.payload).toEqual(submitted);
    expect(cleared).not.toHaveBeenCalled();
    first.unmount();
    cartHook.mockReturnValue({ ...cartHook(), lines: [], ready: false, currency: 'ETB', subtotalMinor: 0 });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve saved order attempt' }));
    expect(await screen.findByText('Persisted order page')).toBeInTheDocument();
    expect(command.mock.calls[1]).toEqual(['create_order', submitted]);
    expect(cleared).toHaveBeenCalledWith(submitted.items, 'USD');
    expect(loadCheckoutIntent(customerId)?.state).toBe('verified');
  });
  it('never clears the cart or starts a new key when the order read cannot verify success', async () => {
    command.mockResolvedValue({ id: orderId }); read.mockRejectedValue(new Error('Order lookup offline'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Place pending order/ }));
    expect(await screen.findByText('Order lookup offline')).toBeInTheDocument();
    expect(cleared).not.toHaveBeenCalled();
    expect(loadCheckoutIntent(customerId)?.state).toBe('pending');
    expect(screen.queryByRole('button', { name: 'Review this cart' })).not.toBeInTheDocument();
  });
  it('does not submit when durable storage is unavailable', async () => {
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Place pending order/ }));
    expect(await screen.findByText('Storage disabled')).toBeInTheDocument();
    expect(command).not.toHaveBeenCalled();
    failure.mockRestore();
  });
  it('only unlocks a definitively rejected transaction for explicit quote review', async () => {
    command.mockRejectedValue(new DatabaseError('Price changed', '23514'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Place pending order/ }));
    await waitFor(() => expect(loadCheckoutIntent(customerId)?.state).toBe('rejected'));
    expect(await screen.findByText('Review cart for a new attempt')).toBeInTheDocument();
    expect(cleared).not.toHaveBeenCalled();
  });
  it.each(['23505', '42501', '22023'])('keeps database failure %s locked with its original key', async (code) => {
    command.mockRejectedValue(new DatabaseError('Database request conflict', code));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Place pending order/ }));
    expect(await screen.findByText('Database request conflict')).toBeInTheDocument();
    expect(loadCheckoutIntent(customerId)?.state).toBe('pending');
    expect(screen.queryByText('Review cart for a new attempt')).not.toBeInTheDocument();
  });
});

describe('customer order visibility', () => {
  it('renders saved order details when the server returns no internal events or notes', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/orders/${orderId}`]}><Routes>
      <Route path="/orders/:id" element={<OrderPage />} />
    </Routes></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('BRN-TEST')).toBeInTheDocument();
    expect(screen.getByText('Saved Order')).toBeInTheDocument();
    expect(screen.getByText(/This pending order does not reserve seats/)).toBeInTheDocument();
  });
});

describe('Telegram reference links', () => {
  it('allows only Telegram HTTPS username links without bot start parameters', () => {
    const url = new URL(safeTelegramUrl('https://t.me/brenstore?start=automate', 'BRN-123')!);
    expect(url.searchParams.has('start')).toBe(false);
    expect(url.searchParams.get('text')).toContain('BRN-123');
    expect(safeTelegramUrl('javascript:alert(1)')).toBeNull();
    expect(safeTelegramUrl('https://evil.test')).toBeNull();
    expect(safeTelegramUrl('https://t.me@evil.test/name')).toBeNull();
  });
});

describe('top-up checkout', () => {
  const topupPlanId = '10000000-0000-4000-8000-000000000002';
  const topupPlan: Plan = { ...plan, id: topupPlanId, name: 'FF 100 Diamonds', kind: 'topup', available: null, billing_days: 1 };
  const topupCart = () => cartHook.mockReturnValue({
    lines: [{ product: topupPlan, current: topupPlan, qty: 1, unitMinor: 499, errors: [] }],
    ready: true, currency: 'USD', subtotalMinor: 499, clearPurchased: cleared, setCurrency: vi.fn(), setQty: vi.fn(), remove: vi.fn(),
  });
  it('collects a numeric player ID per top-up line and submits it in the saved payload', async () => {
    topupCart();
    command.mockResolvedValue({ id: orderId });
    read.mockResolvedValue({
      ...detail,
      items: [{ ...detail.items[0], plan_id: topupPlanId, name: 'FF 100 Diamonds', billing_days: 1, player_id: '123456789' }],
    });
    setup();
    const playerInput = await screen.findByLabelText(/Free Fire player ID/i);
    expect(screen.getByText(/one-time top-up/)).toBeInTheDocument();
    fireEvent.change(playerInput, { target: { value: 'FF123456789!!' } });
    expect(playerInput).toHaveValue('123456789');
    fireEvent.click(screen.getByRole('button', { name: /Place pending order/ }));
    expect(await screen.findByText('Persisted order page')).toBeInTheDocument();
    expect(command).toHaveBeenCalledExactlyOnceWith('create_order', expect.objectContaining({
      items: [{ plan_id: topupPlanId, qty: 1, unit_minor: 499, player_id: '123456789' }],
    }));
    expect(cleared).toHaveBeenCalledWith([{ plan_id: topupPlanId, qty: 1, unit_minor: 499, player_id: '123456789' }], 'USD');
  });
  it('blocks submission until every top-up line has a valid player ID', async () => {
    topupCart();
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Place pending order/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/player ID/i);
    expect(command).not.toHaveBeenCalled();
    expect(loadCheckoutIntent(customerId)).toBeNull();
  });
  it('rejects a saved order whose player ID does not match the checkout quote', () => {
    const topupIntent = intent();
    topupIntent.payload.items = [{ plan_id: planId, qty: 1, unit_minor: 499, player_id: '123456789' }];
    const topupDetail = { ...detail, items: [{ ...detail.items[0], player_id: '123456789' }] };
    expect(() => verifySavedOrder(topupDetail, topupIntent)).not.toThrow();
    expect(() => verifySavedOrder({ ...detail, items: [{ ...detail.items[0], player_id: '987654321' }] }, topupIntent)).toThrow('did not match');
  });
});
