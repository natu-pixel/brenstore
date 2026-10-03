import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServiceDetail from './ServiceDetail';
import type { StoreOutletContext } from './ServiceDetail';
import type { Plan, Service } from '../features/contracts';

const mocks = vi.hoisted(() => ({ resource: vi.fn(), cart: vi.fn(), add: vi.fn(), openCart: vi.fn() }));
vi.mock('../features/api', () => ({ useResource: mocks.resource }));
vi.mock('../cart', () => ({ MAX_QUANTITY: 9, useCart: mocks.cart }));

const single: Plan = {
  id: 'single', name: 'Netflix - 1 user', slug: 'netflix-1-user', description: '',
  category_id: 'streaming', category_name: 'Streaming', brand_key: 'netflix', initial: 'N',
  color_start: '#141414', color_end: '#242424', usd_minor: 499, etb_minor: 85000,
  usd_compare_minor: 699, etb_compare_minor: null, capacity: 5, allocated: 0, available: 5,
  low_stock_threshold: 2, billing_days: 30, status: 'active', featured: false,
  updated_at: '2026-01-01T00:00:00Z', kind: 'seat',
  service_id: 'netflix-service', service_name: 'Netflix', option_code: 'single_user', users_included: 1,
};
const mail: Plan = { ...single, id: 'mail', name: 'Netflix - On mail', slug: 'netflix-on-mail',
  usd_minor: 1299, etb_minor: 195000, usd_compare_minor: null, available: 2, capacity: 2,
  option_code: 'on_mail', users_included: 5 };
const yearly: Plan = { ...single, id: 'yearly', billing_days: 365, usd_minor: 4999, usd_compare_minor: null };
const netflix: Service = {
  id: 'netflix-service', name: 'Netflix', slug: 'netflix', category_id: 'streaming', category_name: 'Streaming',
  brand_key: 'netflix', initial: 'N', color_start: '#141414', color_end: '#242424',
  badge: 'popular', tagline: 'NETFLIX PREMIUM', description: 'Movies and series.',
  features: ['HD streaming', 'Any device'], requirements: ['A supported device'], notes: 'Use your exact email.',
};
let plans: Plan[];
let services: Service[];
let currency: 'USD' | 'ETB';
let lines: { product: Plan; qty: number }[];
let catalogState: { isPending: boolean; isError: boolean };

function Layout() {
  return <Outlet context={{ openCart: mocks.openCart } satisfies StoreOutletContext} />;
}
function renderDetail(key = 'netflix-service') {
  return render(<MemoryRouter initialEntries={[`/services/${key}`]}>
    <Routes><Route element={<Layout />}>
      <Route path="/services/:key" element={<ServiceDetail />} />
      <Route path="/checkout" element={<p>Checkout page</p>} />
    </Route></Routes>
  </MemoryRouter>);
}
const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`${name}$`) });
const price = () => document.querySelector('.plan-picker-price strong')?.textContent?.replace(/\s/g, ' ');

beforeEach(() => {
  plans = [yearly, mail, single];
  services = [netflix];
  currency = 'USD';
  lines = [];
  catalogState = { isPending: false, isError: false };
  vi.clearAllMocks();
  mocks.cart.mockImplementation(() => ({ add: mocks.add, currency, lines }));
  mocks.resource.mockImplementation((name: string) => name === 'catalog'
    ? { data: plans, ...catalogState, error: new Error('offline'), refetch: vi.fn() }
    : { data: services, isPending: false, isError: false });
});

describe('service detail page', () => {
  it('shows the hero, a picker with duration and type chips, and the storefront details', () => {
    renderDetail();
    expect(screen.getByRole('heading', { level: 1, name: 'Netflix' })).toBeInTheDocument();
    expect(screen.getByText('Popular')).toBeInTheDocument();
    expect(screen.getByText('NETFLIX PREMIUM')).toBeInTheDocument();
    expect(screen.getByText('Movies and series.')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    const picker = screen.getByRole('region', { name: 'Choose a Plan' });
    expect(within(picker).getByRole('radiogroup', { name: 'Duration' })).toBeInTheDocument();
    expect(within(within(picker).getByRole('radiogroup', { name: 'Duration' })).getAllByRole('radio').map(chip => chip.textContent))
      .toEqual(['1 month', '1 year']);
    expect(within(within(picker).getByRole('radiogroup', { name: 'Select type' })).getAllByRole('radio').map(chip => chip.textContent))
      .toEqual(['1 user', 'On mail (5 users)']);
    expect(radio('1 month')).toHaveAttribute('aria-checked', 'true');
    expect(radio('1 user')).toHaveAttribute('aria-checked', 'true');
    expect(price()).toBe('USD 4.99');
    expect(within(picker).getByText('USD 6.99').tagName).toBe('S');
    expect(within(picker).getByText('1 user · 1 month')).toBeInTheDocument();
    expect(within(picker).getByText('5 in stock')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Features' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: 'Requirements' })).getByText('A supported device')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Important Notes' })).getByText('Use your exact email.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to services' })).toHaveAttribute('href', '/services');
  });

  it('updates the price for the chosen type and duration, switching to an offered combination', () => {
    renderDetail();
    fireEvent.click(radio('On mail \\(5 users\\)'));
    expect(price()).toBe('USD 12.99');
    expect(screen.getByText('Only 2 left')).toBeInTheDocument();
    expect(screen.getByText('Best value')).toBeInTheDocument();
    fireEvent.click(radio('1 year'));
    expect(price()).toBe('USD 49.99');
    expect(radio('1 user')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Best value')).not.toBeInTheDocument();
  });

  it('adds the exact selected plan to the cart, or goes straight to checkout with Buy now', () => {
    renderDetail();
    fireEvent.click(radio('On mail \\(5 users\\)'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Netflix - On mail to cart' }));
    expect(mocks.add).toHaveBeenCalledWith('mail');
    expect(mocks.openCart).toHaveBeenCalledTimes(1);
    fireEvent.click(radio('1 year'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy Netflix - 1 user now' }));
    expect(mocks.add).toHaveBeenLastCalledWith('yearly');
    expect(screen.getByText('Checkout page')).toBeInTheDocument();
  });

  it('marks sold-out options, defaults to an available one and blocks unpriced or capped plans', () => {
    plans = [{ ...single, available: 0 }, mail, { ...yearly, available: 3 }];
    const view = renderDetail();
    expect(radio('On mail \\(5 users\\)')).toHaveAttribute('aria-checked', 'true');
    expect(radio('1 user')).toHaveTextContent('Sold out');
    fireEvent.click(radio('1 user'));
    expect(screen.getByRole('status')).toHaveTextContent('sold out');
    expect(screen.getByRole('button', { name: /^Add .* to cart$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Buy .* now$/ })).toBeDisabled();
    view.unmount();

    currency = 'ETB';
    plans = [{ ...mail, etb_minor: null }, { ...yearly, available: 3 }];
    lines = [{ product: plans[1], qty: 3 }];
    renderDetail();
    expect(screen.getByRole('status')).toHaveTextContent(/Not priced|Quantity limit reached/);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('hides empty sections and does not repeat the description for standalone plans', () => {
    plans = [{ ...single, id: 'solo', name: 'Solo plan', description: 'Standalone details', service_id: null,
      service_name: null, option_code: null, users_included: null }];
    renderDetail('plan-solo');
    expect(screen.getByRole('heading', { level: 1, name: 'Solo plan' })).toBeInTheDocument();
    expect(screen.getAllByText('Standalone details')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Features' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Important Notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Select type' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Solo plan to cart' }));
    expect(mocks.add).toHaveBeenCalledWith('solo');
  });

  it('explains unknown services and catalog errors', () => {
    const view = renderDetail('missing');
    expect(screen.getByText('This service is not available.')).toBeInTheDocument();
    view.unmount();
    catalogState = { isPending: false, isError: true };
    renderDetail();
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable: offline');
  });
});
