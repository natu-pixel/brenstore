import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { addCartItem, CART_KEY, CartProvider, cartLine, changeCartDuration, durationChoices, parseCart, useCart } from './cart';
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
  it('loads pre-relationship carts but requires review after option/package changes', () => {
    expect(parseCart(JSON.stringify(state())).items[0].product.id).toBe(plan.id);
    expect(cartLine(state().items[0], [{ ...plan, option_code: null, users_included: null }], 'USD').errors).toEqual([]);
    const changed = { ...plan, service_id: 'service', option_code: 'on_mail' as const, users_included: 5 };
    expect(cartLine(state().items[0], [changed], 'USD').errors.join()).toContain('purchase option has changed');
    expect(() => addCartItem(state(), changed)).toThrow('purchase option has changed');
    expect(addCartItem({ version: 1, currency: 'USD', items: [] }, changed).items[0].qty).toBe(1);
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

describe('changing duration inside the cart', () => {
  const service = '20000000-0000-4000-8000-000000000001';
  const term = (id: string, days: number, usd: number, overrides: Partial<Plan> = {}): Plan => ({
    ...plan, id: `10000000-0000-4000-8000-0000000001${id}`, slug: `term-${id}`, name: `Netflix ${days}`,
    billing_days: days, usd_minor: usd, service_id: service, service_name: 'Netflix',
    option_code: 'single_user', users_included: 1, ...overrides,
  });
  const monthly = term('01', 30, 499);
  const quarterly = term('02', 90, 1299);
  const yearly = term('03', 365, 4499, { available: 2 });
  const onMail = term('04', 90, 1999, { option_code: 'on_mail', users_included: 5 });
  const otherService = term('05', 90, 999, { service_id: '20000000-0000-4000-8000-000000000002' });
  const unpricedEtb = term('06', 180, 2499, { etb_minor: null });
  const standalone = { ...plan, id: '10000000-0000-4000-8000-000000000199', billing_days: 90 };
  const catalog = [yearly, onMail, quarterly, monthly, otherService, unpricedEtb, standalone];
  const cart = (items: { product: Plan; qty: number }[], currency: CartState['currency'] = 'USD'): CartState => ({ version: 1, currency, items });

  it('offers only priced durations of the same service, option and package size, sorted by length', () => {
    const line = { product: monthly, qty: 1 };
    expect(durationChoices(line, catalog, 'USD').map((option) => option.id)).toEqual([monthly.id, quarterly.id, unpricedEtb.id, yearly.id]);
    expect(durationChoices(line, catalog, 'ETB').map((option) => option.id)).toEqual([monthly.id, quarterly.id, yearly.id]);
    expect(durationChoices({ product: standalone, qty: 1 }, catalog, 'USD')).toEqual([]);
    expect(durationChoices({ product: { ...monthly, option_code: null, users_included: null }, qty: 1 }, [{ ...monthly, option_code: null, users_included: null }], 'USD')).toEqual([]);
    expect(durationChoices(line, [{ ...monthly, users_included: 2 }, quarterly], 'USD')).toEqual([]);
    expect(cartLine(line, catalog, 'USD', true).durations).toEqual([]);
  });

  it('switches to the catalog plan, keeps quantity and position, and uses its own price', () => {
    const next = changeCartDuration(cart([{ product: standalone, qty: 1 }, { product: monthly, qty: 2 }]), monthly.id, quarterly.id, catalog);
    expect(next.items.map((item) => [item.product.id, item.qty])).toEqual([[standalone.id, 1], [quarterly.id, 2]]);
    expect(cartLine(next.items[1], catalog, 'USD')).toMatchObject({ unitMinor: 1299, errors: [] });
  });

  it('combines with an existing line for the chosen duration within limits', () => {
    const next = changeCartDuration(cart([{ product: monthly, qty: 2 }, { product: quarterly, qty: 3 }]), monthly.id, quarterly.id, catalog);
    expect(next.items).toEqual([{ product: quarterly, qty: 5 }]);
    expect(() => changeCartDuration(cart([{ product: monthly, qty: 5 }, { product: quarterly, qty: 5 }]), monthly.id, quarterly.id, catalog)).toThrow('at most 9');
  });

  it('rejects unavailable, foreign, sold-out, and stale-price targets without changing the cart', () => {
    const state = cart([{ product: monthly, qty: 3 }]);
    expect(() => changeCartDuration(state, monthly.id, yearly.id, catalog)).toThrow('at most 2 seats');
    expect(() => changeCartDuration(state, monthly.id, onMail.id, catalog)).toThrow('not available');
    expect(() => changeCartDuration(state, monthly.id, otherService.id, catalog)).toThrow('not available');
    expect(() => changeCartDuration(state, monthly.id, quarterly.id, [monthly, { ...quarterly, available: 0 }])).toThrow('sold out');
    expect(() => changeCartDuration(cart([{ product: monthly, qty: 1 }, { product: { ...quarterly, usd_minor: 999 }, qty: 1 }]), monthly.id, quarterly.id, catalog)).toThrow('changed');
    expect(() => changeCartDuration(cart([{ product: monthly, qty: 1 }], 'ETB'), monthly.id, unpricedEtb.id, catalog)).toThrow('not available');
    expect(changeCartDuration(state, monthly.id, monthly.id, catalog)).toBe(state);
  });

  it('persists the change from the provider and reports blocked changes', () => {
    resource.mockReturnValue({ data: catalog, isError: false, isFetching: false });
    localStorage.setItem(CART_KEY, JSON.stringify(cart([{ product: monthly, qty: 3 }])));
    function Probe() {
      const cartApi = useCart();
      return <><span data-testid="line">{cartApi.lines.map((line) => `${line.product.billing_days}:${line.qty}:${line.unitMinor}`).join()}</span>
        <button onClick={() => cartApi.changeDuration(monthly.id, quarterly.id)}>Quarterly</button>
        <button onClick={() => cartApi.changeDuration(quarterly.id, yearly.id)}>Yearly</button>
        <p>{cartApi.error}</p></>;
    }
    render(<CartProvider><Probe /></CartProvider>);
    fireEvent.click(screen.getByText('Quarterly'));
    expect(screen.getByTestId('line')).toHaveTextContent('90:3:1299');
    expect(parseCart(localStorage.getItem(CART_KEY)).items[0].product.id).toBe(quarterly.id);
    fireEvent.click(screen.getByText('Yearly'));
    expect(screen.getByTestId('line')).toHaveTextContent('90:3:1299');
    expect(screen.getByText(/at most 2 seats/)).toBeInTheDocument();
  });
});
