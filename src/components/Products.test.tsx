import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Products from './Products';
import { groupPlans } from '../data/plan-options';
import type { Plan } from '../features/contracts';

const mocks = vi.hoisted(() => ({ resource: vi.fn(), cart: vi.fn(), add: vi.fn(), setCurrency: vi.fn() }));
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
let plans: Plan[];
let currency: 'USD' | 'ETB';
let lines: { product: Plan; qty: number }[];

beforeEach(() => {
  plans = [mail, single];
  currency = 'USD';
  lines = [];
  vi.clearAllMocks();
  mocks.cart.mockImplementation(() => ({ add: mocks.add, currency, setCurrency: mocks.setCurrency, lines }));
  mocks.resource.mockImplementation((name: string) => ({
    data: name === 'catalog' ? plans : [{ id: 'streaming', name: 'Streaming', archived: false }],
    isPending: false, isError: false,
  }));
});

describe('grouped streaming plan cards', () => {
  it('shows one service card and adds the exact selected plan with its own price and stock', () => {
    render(<Products />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Netflix' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).not.toBeChecked();
    expect(screen.getByText('USD 4.99')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Netflix - 1 user to cart' }));
    expect(mocks.add).toHaveBeenLastCalledWith('single');
    fireEvent.click(screen.getByRole('switch', { name: 'Netflix: On mail' }));
    expect(screen.getByText('USD 12.99')).toBeInTheDocument();
    expect(screen.getByText('2 left')).toBeInTheDocument();
    expect(screen.queryByText('USD 4.99')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Netflix - On mail to cart' }));
    expect(mocks.add).toHaveBeenLastCalledWith('mail');
  });

  it('keeps the selected option when changing currency and displays its independent ETB price', () => {
    const view = render(<Products />);
    fireEvent.click(screen.getByRole('switch', { name: 'Netflix: On mail' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Display currency' }), { target: { value: 'ETB' } });
    expect(mocks.setCurrency).toHaveBeenCalledWith('ETB');
    currency = 'ETB';
    view.rerender(<Products />);
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeChecked();
    expect(screen.getByText('ETB 1,950.00')).toBeInTheDocument();
  });

  it('disables sold-out and missing options without creating a substitute plan', () => {
    plans = [single, { ...mail, available: 0 }];
    const view = render(<Products />);
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeDisabled();
    plans = [single];
    view.rerender(<Products />);
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeDisabled();
    expect(screen.getByText(/On mail is not available/)).toBeInTheDocument();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('does not guess an option from an existing plan description', () => {
    plans = [{ ...single, name: 'Netflix', description: 'on mail 5 users', option_code: null, users_included: null }];
    render(<Products />);
    expect(screen.queryByRole('combobox', { name: 'Netflix plan' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeDisabled();
    expect(screen.getByText('Options not set for this plan.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Netflix to cart' }));
    expect(mocks.add).toHaveBeenCalledWith('single');
  });

  it('keeps both options accessible when a search or Featured filter matches only one', () => {
    render(<Products />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'On mail' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Featured' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeEnabled();
  });

  it('requires a new choice if the selected plan disappears rather than silently changing the price', () => {
    const view = render(<Products />);
    fireEvent.click(screen.getByRole('switch', { name: 'Netflix: On mail' }));
    plans = [single];
    view.rerender(<Products />);
    expect(screen.getByRole('alert')).toHaveTextContent('selected plan is no longer published');
    expect(screen.getByRole('button', { name: 'Choose a Netflix option' })).toBeDisabled();
    expect(screen.queryByText('USD 4.99')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Netflix plan' }), { target: { value: 'single' } });
    expect(screen.getByText('USD 4.99')).toBeInTheDocument();
  });

  it('offers separate billing plans without collapsing their IDs', () => {
    plans.push({ ...single, id: 'yearly', slug: 'netflix-1-user-yearly', billing_days: 365, usd_minor: 4999 });
    render(<Products />);
    const terms = screen.getByRole('combobox', { name: 'Netflix billing plan' });
    expect(within(terms).getAllByRole('option')).toHaveLength(2);
    fireEvent.change(terms, { target: { value: 'yearly' } });
    expect(screen.getByText('USD 49.99')).toBeInTheDocument();
    expect(screen.getByText('/ 365 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Netflix - 1 user to cart' }));
    expect(mocks.add).toHaveBeenCalledWith('yearly');
  });

  it('keeps cart limits independent for each option', () => {
    lines = [{ product: single, qty: 5 }];
    render(<Products />);
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Netflix: On mail' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Netflix - On mail to cart' })).toBeEnabled();
  });

  it('supports Space and Enter to switch in both directions without adding anything to the cart', async () => {
    const user = userEvent.setup();
    render(<Products />);
    const toggle = screen.getByRole('switch', { name: 'Netflix: On mail' });
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
    expect(screen.getByText('USD 12.99')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('USD 4.99')).toBeInTheDocument();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('keeps the default card minimal and places extra information in collapsed details', () => {
    const { container } = render(<Products />);
    expect(screen.getByText('One shared seat.')).not.toBeVisible();
    expect(screen.getByText('Netflix - 1 user')).not.toBeVisible();
    expect(screen.getByText('Off: 1 user. On: On mail.')).not.toBeVisible();
    expect(container.querySelector('.card-category, .card-flag, .card-selected-plan')).toBeNull();
    const details = container.querySelector('details');
    expect(details).not.toHaveAttribute('open');
    if (!details) throw new Error('Plan details must remain accessible.');
    fireEvent.click(within(details).getByText('Details'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('One shared seat.')).toBeVisible();
    fireEvent.click(screen.getByRole('switch', { name: 'Netflix: On mail' }));
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Delivery on mail.')).not.toBeVisible();
    expect(screen.getByText('2 left')).toBeVisible();
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
  it('keeps options working after arbitrary display-name changes', () => {
    plans = [{ ...single, name: 'Shared monthly' }, { ...mail, name: 'Family monthly' }];
    render(<Products />);
    fireEvent.click(screen.getByRole('switch', { name: 'Netflix: On mail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Family monthly to cart' }));
    expect(mocks.add).toHaveBeenCalledWith('mail');
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText('On mail · 5 users per purchase')).toBeVisible();
  });
});
