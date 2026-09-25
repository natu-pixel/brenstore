import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { addCartItem, CART_KEY, CartProvider, cartLine, parseCart, useCart } from './cart';
import type { CartState } from './cart';
import type { Plan } from './features/api';

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }));
vi.mock('./features/api', async (original) => ({ ...await original<typeof import('./features/api')>(), useResource: resource }));
const plan: Plan = {
  id: '10000000-0000-4000-8000-000000000001', name: 'Test plan', slug: 'test-plan',
  description: 'Test description', category_id: null, category_name: null,
  brand_key: 'netflix', initial: 'T', color_start: '#000000', color_end: '#333333',
  usd_minor: 499, etb_minor: 71234, usd_compare_minor: null, etb_compare_minor: null,
  capacity: 20, allocated: 0, available: 20, low_stock_threshold: 2, billing_days: 30,
  status: 'active', featured: false, updated_at: '2026-01-01T00:00:00Z', kind: 'seat',
};
const state = (qty = 1): CartState => ({ version: 1, currency: 'USD', items: [{ product: plan, qty }] });
const topupPlan: Plan = {
  ...plan, id: '10000000-0000-4000-8000-000000000002', slug: 'ff-100', name: 'FF 100 Diamonds',
  kind: 'topup', capacity: 0, allocated: 0, available: null, low_stock_threshold: 0, billing_days: 1,
};
const topupState = (qty = 1): CartState => ({ version: 1, currency: 'USD', items: [{ product: topupPlan, qty }] });

beforeEach(() => {
  localStorage.clear();
  resource.mockReturnValue({ data: [plan], isError: false, isFetching: false });
});

describe('persistent catalog-backed cart', () => {
  it('defaults to USD without invented catalog items', () => {
    expect(parseCart(null)).toEqual({ version: 1, currency: 'USD', items: [] });
  });
  it('uses independent minor-unit USD and ETB prices', () => {
    expect(cartLine(state().items[0], [plan], 'USD').unitMinor).toBe(499);
    expect(cartLine(state().items[0], [plan], 'ETB').unitMinor).toBe(71234);
  });
  it('enforces both the quantity-nine and current availability limits when adding', () => {
    expect(() => addCartItem(state(9), plan)).toThrow('at most 9');
    expect(() => addCartItem(state(2), { ...plan, available: 2 })).toThrow('at most 2');
    expect(addCartItem(state(8), plan).items[0].qty).toBe(9);
  });
  it('counts three additions of the same plan as three seats on one persisted line', () => {
    function Probe() {
      const cart = useCart();
      return <><span data-testid="count">{cart.count}</span><button onClick={() => cart.add(plan.id)}>Add</button></>;
    }
    const first = render(<CartProvider><Probe /></CartProvider>);
    for (let index = 0; index < 3; index++) fireEvent.click(screen.getByText('Add'));
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    const saved = parseCart(localStorage.getItem(CART_KEY));
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].qty).toBe(3);
    first.unmount();
    render(<CartProvider><Probe /></CartProvider>);
    expect(screen.getByTestId('count')).toHaveTextContent('3');
  });
  it('keeps missing and archived items visible with a blocking error', () => {
    const missing = cartLine(state().items[0], [], 'USD');
    expect(missing.product.name).toBe('Test plan');
    expect(missing.errors.join()).toContain('no longer available');
    expect(cartLine(state().items[0], [{ ...plan, status: 'archived' }], 'USD').canIncrease).toBe(false);
  });
  it('does not silently adopt a changed price or treat a fetch error as an empty catalog', () => {
    const changed = cartLine(state().items[0], [{ ...plan, usd_minor: 599 }], 'USD');
    expect(changed.unitMinor).toBe(499);
    expect(changed.errors.join()).toContain('price has changed');
    expect(() => addCartItem(state(), { ...plan, usd_minor: 599 })).toThrow('changed price');
    expect(cartLine(state().items[0], undefined, 'USD', true).errors.join()).toContain('could not be verified');
  });
  it('rejects malformed saved quantities and duplicate plan rows', () => {
    expect(() => parseCart(JSON.stringify(state(10)))).toThrow();
    expect(() => parseCart(JSON.stringify({ ...state(), items: [...state().items, ...state().items] }))).toThrow();
  });
  it('blocks unsafe line totals without silently rounding money', () => {
    const huge = { ...plan, usd_minor: Number.MAX_SAFE_INTEGER };
    expect(cartLine({ product: huge, qty: 2 }, [huge], 'USD').errors.join()).toContain('supported amount');
    expect(() => addCartItem({ ...state(), items: [{ product: huge, qty: 1 }] }, huge)).toThrow('monetary amount');
  });
  it('blocks mixing top-up and subscription plans in one cart', () => {
    expect(() => addCartItem(state(), topupPlan)).toThrow('Game top-ups are ordered separately');
    expect(() => addCartItem(topupState(), plan)).toThrow('Subscription plans are ordered separately');
    expect(addCartItem(topupState(), { ...topupPlan, id: '10000000-0000-4000-8000-000000000003', slug: 'ff-210' }).items).toHaveLength(2);
  });
  it('caps top-ups at nine units per plan without seat availability limits', () => {
    expect(() => addCartItem(topupState(9), topupPlan)).toThrow('at most 9');
    expect(addCartItem(topupState(8), topupPlan).items[0].qty).toBe(9);
    const line = cartLine(topupState(9).items[0], [topupPlan], 'USD');
    expect(line.errors).toEqual([]);
    expect(line.canIncrease).toBe(false);
    expect(cartLine(topupState(1).items[0], [topupPlan], 'USD').canIncrease).toBe(true);
  });
  it('retains the cart across provider reloads and prevents increasing past available seats', () => {
    resource.mockReturnValue({ data: [{ ...plan, available: 1 }], isError: false, isFetching: false });
    function Probe() {
      const cart = useCart();
      return <><span data-testid="count">{cart.count}</span><button onClick={() => cart.add(plan.id)}>Add</button><button onClick={() => cart.setQty(plan.id, 2)}>Increase</button><p>{cart.error}</p></>;
    }
    const first = render(<CartProvider><Probe /></CartProvider>);
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('Increase'));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByText(/Cannot increase/)).toBeInTheDocument();
    expect(parseCart(localStorage.getItem(CART_KEY)).items[0].qty).toBe(1);
    first.unmount();
    render(<CartProvider><Probe /></CartProvider>);
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });
});
