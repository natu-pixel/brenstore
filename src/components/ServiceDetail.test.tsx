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
    </Route></Routes>
  </MemoryRouter>);
}

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
  it('shows the service hero, every plan and the storefront details', () => {
    renderDetail();
    expect(screen.getByRole('heading', { level: 1, name: 'Netflix' })).toBeInTheDocument();
    expect(screen.getByText('Popular')).toBeInTheDocument();
    expect(screen.getByText('NETFLIX PREMIUM')).toBeInTheDocument();
    expect(screen.getByText('Movies and series.')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    const plansList = screen.getByRole('region', { name: 'Choose a Plan' });
    expect(within(plansList).getAllByRole('listitem').map(item => item.querySelector('.service-plan-name')?.textContent))
      .toEqual(['1 user · Monthly', 'On mail · Monthly', '1 user · Yearly']);
    expect(within(plansList).getByText('USD 6.99').tagName).toBe('S');
    expect(within(plansList).getByText('5 users per purchase')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Features' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: 'Requirements' })).getByText('A supported device')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Important Notes' })).getByText('Use your exact email.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to services' })).toHaveAttribute('href', '/#products');
  });

  it('adds the exact plan and opens the cart when ordering', () => {
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Order Netflix - On mail (Monthly)' }));
    expect(mocks.add).toHaveBeenCalledWith('mail');
    expect(mocks.openCart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Order Netflix - 1 user (Yearly)' }));
    expect(mocks.add).toHaveBeenLastCalledWith('yearly');
  });

  it('marks only the cheapest plan per user per day as best value', () => {
    renderDetail();
    const best = screen.getByText('Best value').closest('li');
    expect(best).not.toBeNull();
    expect(within(best!).getByText('On mail · Monthly')).toBeInTheDocument();
    expect(screen.getAllByText('Best value')).toHaveLength(1);
  });

  it('disables plans that are sold out, unpriced in the selected currency or at the cart limit', () => {
    currency = 'ETB';
    plans = [{ ...single, available: 0 }, { ...mail, etb_minor: null }, { ...yearly, available: 3 }];
    lines = [{ product: plans[2], qty: 3 }];
    renderDetail();
    expect(screen.getByRole('button', { name: 'Order Netflix - 1 user (Monthly)' })).toHaveTextContent('Out of stock');
    expect(screen.getByRole('button', { name: 'Order Netflix - On mail (Monthly)' })).toHaveTextContent('Not priced');
    expect(screen.getByRole('button', { name: 'Order Netflix - 1 user (Yearly)' })).toHaveTextContent('Quantity limit reached');
    for (const button of screen.getAllByRole('button', { name: /^Order / })) expect(button).toBeDisabled();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.queryByText('Best value')).not.toBeInTheDocument();
  });

  it('hides empty sections and uses plan copy for standalone plans', () => {
    plans = [{ ...single, id: 'solo', name: 'Solo plan', description: 'Standalone details', service_id: null,
      service_name: null, option_code: null, users_included: null }];
    renderDetail('plan-solo');
    expect(screen.getByRole('heading', { level: 1, name: 'Solo plan' })).toBeInTheDocument();
    expect(screen.getByText('Standalone details')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Features' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Important Notes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Order Solo plan (Monthly)' })).toBeEnabled();
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
