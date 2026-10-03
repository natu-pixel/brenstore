import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CART_KEY, CartProvider } from '../cart';
import type { Plan } from '../features/api';
import CartDrawer from './CartDrawer';

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }));
vi.mock('../features/api', async (original) => ({ ...await original<typeof import('../features/api')>(), useResource: resource }));
const base: Plan = {
  id: '10000000-0000-4000-8000-000000000101', name: 'Netflix - 1 user', slug: 'netflix-1', description: '',
  category_id: null, category_name: null, brand_key: 'netflix', initial: 'N', color_start: '#000000', color_end: '#333333',
  usd_minor: 499, etb_minor: 85000, usd_compare_minor: null, etb_compare_minor: null, capacity: 10, allocated: 0, available: 10,
  low_stock_threshold: 1, billing_days: 30, status: 'active', featured: false, updated_at: '2026-01-01T00:00:00Z', kind: 'seat',
  service_id: '20000000-0000-4000-8000-000000000001', service_name: 'Netflix', option_code: 'single_user', users_included: 1,
};
const quarterly = { ...base, id: '10000000-0000-4000-8000-000000000102', slug: 'netflix-1-q', name: 'Netflix - 1 user quarterly', billing_days: 90, usd_minor: 1299 };
const yearly = { ...base, id: '10000000-0000-4000-8000-000000000103', slug: 'netflix-1-y', name: 'Netflix - 1 user yearly', billing_days: 365, usd_minor: 4499, available: 1 };
const standalone = { ...base, id: '10000000-0000-4000-8000-000000000104', slug: 'other', name: 'Standalone plan', service_id: null, service_name: null, option_code: null, users_included: null };

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
});
beforeEach(() => {
  localStorage.clear();
  resource.mockReturnValue({ data: [base, quarterly, yearly, standalone], isError: false, isFetching: false });
});
function mount(items: { product: Plan; qty: number }[]) {
  localStorage.setItem(CART_KEY, JSON.stringify({ version: 1, currency: 'USD', items }));
  render(<CartProvider><CartDrawer open onClose={() => undefined} onCheckout={() => undefined} /></CartProvider>);
}

describe('cart duration selector', () => {
  it('switches duration and updates the line price and order total immediately', async () => {
    const user = userEvent.setup();
    mount([{ product: base, qty: 2 }]);
    const select = screen.getByRole('combobox', { name: 'Netflix - 1 user duration' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent?.replace(/\s/g, ' '))).toEqual([
      'Monthly', 'Quarterly · USD 12.99', 'Yearly · USD 44.99 · only 1 left',
    ]);
    expect(within(select).getByRole('option', { name: /Yearly/ })).toBeDisabled();
    await user.selectOptions(select, quarterly.id);
    const changed = screen.getByRole('combobox', { name: 'Netflix - 1 user quarterly duration' });
    expect(changed).toHaveValue(quarterly.id);
    expect(screen.getAllByText('USD 25.98')).toHaveLength(2);
  });

  it('keeps a fixed duration label when no alternatives exist', () => {
    mount([{ product: standalone, qty: 1 }]);
    expect(screen.queryByRole('combobox', { name: /duration/ })).not.toBeInTheDocument();
    expect(screen.getByText('Monthly (30 days)')).toBeVisible();
  });
});
