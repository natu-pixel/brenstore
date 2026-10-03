import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Products from './Products';
import { groupPlans } from '../data/plan-options';
import type { Plan, Service } from '../features/contracts';

const mocks = vi.hoisted(() => ({ resource: vi.fn(), cart: vi.fn(), setCurrency: vi.fn() }));
vi.mock('../features/api', () => ({ useResource: mocks.resource }));
vi.mock('../cart', () => ({ MAX_QUANTITY: 9, useCart: mocks.cart }));

const single: Plan = {
  id: 'single', name: 'Netflix - 1 user', slug: 'netflix-1-user', description: 'One shared seat.',
  category_id: 'streaming', category_name: 'Streaming', brand_key: 'netflix', initial: 'N',
  color_start: '#141414', color_end: '#242424', usd_minor: 499, etb_minor: 85000,
  usd_compare_minor: null, etb_compare_minor: null, capacity: 5, allocated: 0, available: 5,
  low_stock_threshold: 2, billing_days: 30, status: 'active', featured: false,
  updated_at: '2026-01-01T00:00:00Z', kind: 'seat',
  service_id: 'netflix-service', service_name: 'Netflix', option_code: 'single_user', users_included: 1,
};
const mail: Plan = { ...single, id: 'mail', name: 'Netflix - On mail', slug: 'netflix-on-mail',
  description: 'Delivery on mail.', usd_minor: 1299, etb_minor: 195000, available: 2, capacity: 2, featured: true,
  option_code: 'on_mail', users_included: 5 };
const netflix: Service = {
  id: 'netflix-service', name: 'Netflix', slug: 'netflix', category_id: 'streaming', category_name: 'Streaming',
  brand_key: 'netflix', initial: 'N', color_start: '#141414', color_end: '#242424',
  badge: 'recommended', tagline: 'NETFLIX PREMIUM', description: 'Movies and series.',
  features: ['HD streaming'], requirements: ['A supported device'], notes: 'Use your exact email.',
};
let plans: Plan[];
let services: Service[];
let currency: 'USD' | 'ETB';

function renderProducts() {
  return render(<MemoryRouter><Products /></MemoryRouter>);
}

beforeEach(() => {
  plans = [mail, single];
  services = [netflix];
  currency = 'USD';
  vi.clearAllMocks();
  mocks.cart.mockImplementation(() => ({ add: vi.fn(), currency, setCurrency: mocks.setCurrency, lines: [] }));
  mocks.resource.mockImplementation((name: string) => ({
    data: name === 'catalog' ? plans : name === 'public_services' ? services : [{ id: 'streaming', name: 'Streaming', archived: false }],
    isPending: false, isError: false,
  }));
});

describe('service cards', () => {
  it('shows one card per service with badge, category, tagline, availability and lowest price', () => {
    renderProducts();
    const card = screen.getByRole('article');
    expect(within(card).getByRole('heading', { name: 'Netflix' })).toBeInTheDocument();
    expect(within(card).getByText('Recommended')).toBeInTheDocument();
    expect(within(card).getByText('Streaming')).toBeInTheDocument();
    expect(within(card).getByText('NETFLIX PREMIUM')).toBeInTheDocument();
    expect(within(card).getByText('Available')).toBeInTheDocument();
    expect(within(card).getByText('From')).toBeInTheDocument();
    expect(within(card).getByText('USD 4.99')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'View Netflix plans' })).toHaveAttribute('href', '/services/netflix-service');
    expect(within(card).getByRole('link', { name: 'Order Netflix' })).toHaveAttribute('href', '/services/netflix-service#plans');
    expect(within(card).queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows the lowest price in the selected currency', () => {
    currency = 'ETB';
    renderProducts();
    expect(screen.getByText('ETB 850.00')).toBeInTheDocument();
  });

  it('ignores sold-out plans for the From price and marks fully sold-out services unavailable', () => {
    plans = [{ ...single, available: 0 }, mail];
    const view = renderProducts();
    expect(screen.getByText('USD 12.99')).toBeInTheDocument();
    plans = [{ ...single, available: 0 }, { ...mail, available: 0 }];
    view.rerender(<MemoryRouter><Products /></MemoryRouter>);
    expect(screen.getByText('Currently Unavailable')).toBeInTheDocument();
    expect(screen.getByText('USD 4.99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Order Netflix' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'View Netflix plans' })).toBeInTheDocument();
  });

  it('falls back to plan copy without service details and links standalone plans by plan ID', () => {
    services = [];
    plans = [single, { ...single, id: 'standalone', name: 'Standalone', service_id: null, service_name: null,
      option_code: null, users_included: null, description: 'Standalone copy' }];
    renderProducts();
    expect(screen.getByText('One shared seat.')).toBeInTheDocument();
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Standalone plans' })).toHaveAttribute('href', '/services/plan-standalone');
  });

  it('has no in-page currency or duration dropdowns and prices cards from every term', () => {
    plans = [{ ...single, usd_minor: 4999, billing_days: 365 }, { ...single, id: 'quarterly', billing_days: 90, usd_minor: 1299 },
      { ...single, id: 'game', name: 'Game', kind: 'topup', service_id: null, service_name: null, option_code: null,
        users_included: null, billing_days: 0, available: null, usd_minor: 199 }];
    renderProducts();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('USD 12.99')).toBeInTheDocument();
    expect(screen.getByText('USD 1.99')).toBeInTheDocument();
  });

  it('searches service copy and combines search with category filters', () => {
    renderProducts();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'movies and series' } });
    expect(screen.getByRole('article')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'On mail' } });
    expect(screen.getByRole('article')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Featured' }));
    expect(screen.getByRole('article')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing matches' } });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all plans' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('groups only by database service ID, never by plan name or branding', () => {
    const grouped = groupPlans([
      single, mail, { ...single, id: 'another-service', service_id: 'different' },
      { ...single, id: 'unlinked', service_id: null },
      { ...single, id: 'renamed', name: 'Any display name', brand_key: 'custom' },
      { ...single, id: 'game', kind: 'topup' },
    ]);
    expect(grouped).toHaveLength(4);
    expect(grouped[0].plans.map(plan => plan.id)).toEqual(['single', 'mail', 'renamed']);
  });
});
