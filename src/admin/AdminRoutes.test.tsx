import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import AdminRoutes from './AdminRoutes';
import type { Order, Role } from '../features/api';

const mocks = vi.hoisted(() => ({
  role: 'owner' as Role,
  resource: vi.fn(),
  read: vi.fn(),
  mutate: vi.fn(),
  invite: vi.fn(),
  process: vi.fn(),
  packages: vi.fn(),
  retry: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ role: mocks.role, user: { id: 'staff-1', email: 'staff@example.test' }, signOut: mocks.signOut, refreshRole: vi.fn(), loading: false, error: null }),
}));
vi.mock('../features/api', async importOriginal => ({
  ...await importOriginal<typeof import('../features/api')>(),
  useResource: (...args: unknown[]) => mocks.resource(...args),
  readResource: (...args: unknown[]) => mocks.read(...args),
  useCommand: () => ({ mutateAsync: mocks.mutate, isPending: false, error: null }),
  inviteStaff: (...args: unknown[]) => mocks.invite(...args),
  processTopupDeliveries: (...args: unknown[]) => mocks.process(...args),
  fetchTopupPackages: (...args: unknown[]) => mocks.packages(...args),
}));

const order: Order = {
  id: 'order-1', reference: 'BREN-TEST', customer_id: 'customer-1', customer_name: 'Test customer',
  phone: '+100000000', telegram: '@test', currency: 'USD', total_minor: 12345,
  status: 'pending', payment_status: 'pending', created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z',
};
const detail = { order, items: [{ id: 'item-1', plan_id: 'plan-1', name: 'Test subscription', description: '', qty: 1, unit_minor: 12345, billing_days: 30, player_id: null }], events: [], payment: null, deliveries: [] };
const dashboard = { pending_orders: 0, active_plans: 0, available_seats: 0, low_stock: 0, confirmed_usd_minor: 12345, confirmed_etb_minor: 98765, recent_orders: [] };
const page = { rows: [], total: 0, page: 1, page_size: 20 };

function ready(data: unknown) {
  return { data, isPending: false, error: null, refetch: mocks.retry };
}
function mount(path = '/admin') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: '/admin/*', element: <AdminRoutes /> }, { path: '/', element: <h1>Storefront</h1> }], { initialEntries: [path] });
  render(<QueryClientProvider client={cache}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, cache };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'owner';
  mocks.mutate.mockResolvedValue({ id: 'created' });
  mocks.invite.mockResolvedValue({ id: 'invited' });
  mocks.process.mockResolvedValue({ message: 'All top-up deliveries are complete.', order_status: 'fulfilled', delivered: 1, failed: 0, open: 0 });
  mocks.packages.mockResolvedValue([{ id: '6', name: '100 Diamonds', cost_points: 9 }]);
  mocks.read.mockResolvedValue(page);
  mocks.resource.mockImplementation((resource: string) => ready(resource === 'dashboard' ? dashboard : resource === 'order' ? detail : page));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('admin permissions and resource states', () => {
  it('hides financial summaries and catalog/owner navigation from support', () => {
    mocks.role = 'support';
    mount();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Confirmed payments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plans' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No orders yet' })).toBeInTheDocument();
  });
  it.each([['support', '/admin/plans'], ['support', '/admin/inventory'], ['manager', '/admin/team'], ['manager', '/admin/settings'], ['manager', '/admin/activity']] as const)('blocks %s direct navigation to %s before querying', (role, path) => {
    mocks.role = role;
    mount(path);
    expect(screen.getByRole('heading', { name: 'Restricted area' })).toBeInTheDocument();
    expect(mocks.resource).not.toHaveBeenCalled();
  });
  it('shows separate real currency totals for managers', () => {
    mocks.role = 'manager';
    mount();
    expect(screen.getByRole('heading', { name: 'Confirmed payments' })).toBeInTheDocument();
    expect(screen.getByText(/USD\s+123.45/)).toBeInTheDocument();
    expect(screen.getByText(/ETB\s+987.65/)).toBeInTheDocument();
  });
  it('shows an honest empty list without fabricated records', () => {
    mount('/admin/orders');
    expect(screen.getByRole('heading', { name: 'No orders yet' })).toBeInTheDocument();
    expect(screen.getByText('0 records')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  it('shows resource errors with a functional retry', async () => {
    mocks.resource.mockReturnValue({ data: undefined, isPending: false, error: new Error('Network unavailable'), refetch: mocks.retry });
    mount('/admin/orders');
    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
  it('shows an accessible loading state', () => {
    mocks.resource.mockReturnValue({ data: undefined, isPending: true, error: null, refetch: mocks.retry });
    mount('/admin/customers');
    expect(screen.getByRole('status')).toHaveTextContent('Loading records');
    expect(screen.queryByText('No customer profiles yet')).not.toBeInTheDocument();
  });
  it('submits search and filters as API query arguments', async () => {
    mount('/admin/orders');
    await userEvent.type(screen.getByRole('searchbox'), 'BREN-12');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.selectOptions(screen.getByLabelText('Order status'), 'paid');
    expect(mocks.resource).toHaveBeenLastCalledWith('orders', expect.objectContaining({ query: 'BREN-12', status: 'paid', page: 1 }));
  });
});

describe('server-aligned settings and input boundaries', () => {
  const settings = { store_name: 'Brenstore', telegram_url: '', manual_payment_instructions: '' };

  it.each(['https://telegram.me/store', 'https://t.me/', 'https://t.me/+invite', 'https://t.me/store/123'])(
    'rejects an unsupported customer contact link before saving: %s', async url => {
      mocks.resource.mockReturnValue(ready(settings));
      mount('/admin/settings');
      fireEvent.change(screen.getByLabelText(/Telegram contact URL/), { target: { value: url } });
      await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
      expect(screen.getByRole('alert')).toHaveTextContent('https://t.me/username');
      expect(mocks.mutate).not.toHaveBeenCalled();
    },
  );

  it('saves the same canonical Telegram link the storefront can display', async () => {
    mocks.resource.mockReturnValue(ready(settings));
    mount('/admin/settings');
    fireEvent.change(screen.getByLabelText(/Telegram contact URL/), { target: { value: 'https://t.me/brenstore?start=ignored#ignored' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'save_settings', input: { ...settings, telegram_url: 'https://t.me/brenstore' } });
    expect(await screen.findByText('Store settings saved.')).toBeInTheDocument();
  });

  it('limits the shared search control to the server contract', () => {
    mount('/admin/orders');
    expect(screen.getByRole('searchbox')).toHaveAttribute('maxlength', '200');
  });

  it('constrains the plan editor slug, billing term and warning threshold', async () => {
    mount('/admin/plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Create plan' });
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveAttribute('maxlength', '120');
    expect(within(dialog).getByLabelText('Billing term (days)')).toHaveAttribute('max', '3650');
    expect(within(dialog).getByLabelText(/^Low-stock threshold/)).toHaveAttribute('max', '1000000');
  });

  it('can save a category with the supported negative sort order', async () => {
    mount('/admin/categories');
    await userEvent.click(screen.getByRole('button', { name: 'Create category' }));
    await userEvent.type(screen.getByLabelText('Category name'), 'Priority');
    await userEvent.type(screen.getByLabelText('Slug'), 'priority');
    const sort = screen.getByLabelText(/^Sort order/);
    expect(sort).toHaveAttribute('min', '-1000000');
    expect(sort).toHaveAttribute('max', '1000000');
    fireEvent.change(sort, { target: { value: '-1000000' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'save_category', input: expect.objectContaining({ sort_order: -1000000 }) });
  });
});

describe('order actions', () => {
  it('matches server note and cancellation limits', async () => {
    mount('/admin/orders/order-1');
    expect(screen.getByLabelText(/Add an internal note/)).toHaveAttribute('maxlength', '2000');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel unpaid order' }));
    expect(within(screen.getByRole('dialog')).getByRole('textbox')).toHaveAttribute('maxlength', '2000');
  });
  it('allows support notes but not financial actions', async () => {
    mocks.role = 'support';
    mount('/admin/orders/order-1');
    expect(screen.queryByRole('button', { name: 'Confirm payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel unpaid order' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Add an internal note/), 'Customer contacted support.');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'add_order_note', input: { id: 'order-1', note: 'Customer contacted support.' } });
    expect(await screen.findByText('Note saved.')).toBeInTheDocument();
  });

  it('rejects mismatched payment amounts and submits exact minor units only after verification', async () => {
    mount('/admin/orders/order-1');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm manual payment' });
    await userEvent.type(within(dialog).getByLabelText('External payment reference'), 'BANK-TEST');
    const amount = within(dialog).getByLabelText('Verified amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '123.44');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm verified payment' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('match');
    expect(mocks.mutate).not.toHaveBeenCalled();
    await userEvent.clear(amount);
    await userEvent.type(amount, '123.45');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm verified payment' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'confirm_payment', input: { id: 'order-1', reference: 'BANK-TEST', amount_minor: 12345, currency: 'USD' } });
  });
  it('keeps a failed financial confirmation open with no success state', async () => {
    mocks.mutate.mockRejectedValue(new Error('Insufficient available seats'));
    mount('/admin/orders/order-1');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
    await userEvent.type(screen.getByLabelText('External payment reference'), 'BANK-TEST');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm verified payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient available seats');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('requires unpaid cancellation acknowledgement and a reason', async () => {
    mount('/admin/orders/order-1');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel unpaid order' }));
    await userEvent.type(screen.getByLabelText('Reason / staff note'), 'Customer requested cancellation');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'cancel_order', input: { id: 'order-1', note: 'Customer requested cancellation' } });
  });
  it('separates paid from fulfilled and prevents unpaid cancellation after confirmation', async () => {
    mocks.resource.mockImplementation((resource: string) => ready(resource === 'order' ? { ...detail, order: { ...order, status: 'paid', payment_status: 'confirmed' } } : page));
    mount('/admin/orders/order-1');
    expect(screen.getByRole('button', { name: 'Mark fulfilled' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel unpaid order' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark fulfilled' }));
    expect(screen.getByLabelText('Reason / staff note')).toHaveAttribute('maxlength', '2000');
  });
});

describe('top-up order handling', () => {
  const topupDetail = (overrides: Record<string, unknown> = {}) => ({
    order: { ...order, ...overrides },
    items: [{ id: 'item-1', plan_id: 'plan-1', name: 'FF 100 Diamonds', description: '', qty: 1, unit_minor: 12345, billing_days: 1, player_id: '123456789' }],
    events: [], payment: null, deliveries: [],
  });
  it('starts automatic delivery right after a top-up payment is confirmed', async () => {
    mocks.resource.mockImplementation((resource: string) => ready(resource === 'order' ? topupDetail() : page));
    mount('/admin/orders/order-1');
    expect(screen.getByText(/Player ID 123456789/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm manual payment' });
    expect(within(dialog).getByText(/immediately starts automatic top-up delivery/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('External payment reference'), 'BANK-TOPUP');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm verified payment' }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith({ action: 'confirm_payment', input: { id: 'order-1', reference: 'BANK-TOPUP', amount_minor: 12345, currency: 'USD' } }));
    await waitFor(() => expect(mocks.process).toHaveBeenCalledWith('order-1', false));
    expect(await screen.findByText('All top-up deliveries are complete.')).toBeInTheDocument();
  });
  it('shows per-unit delivery status and retries failed units explicitly', async () => {
    mocks.resource.mockImplementation((resource: string) => ready(resource === 'order' ? {
      ...topupDetail({ status: 'paid', payment_status: 'confirmed' }),
      payment: { reference: 'BANK-TOPUP', amount_minor: 12345, currency: 'USD', confirmed_by: 'staff-1', confirmed_at: '2026-01-01T10:00:00Z' },
      deliveries: [
        { id: 'delivery-1', order_item_id: 'item-1', unit_index: 1, player_id: '123456789', package_id: '6', package_name: 'FF 100 Diamonds', status: 'delivered', provider_order_id: 'prov-1', attempts: 1, last_error: '', delivered_at: '2026-01-01T10:05:00Z' },
        { id: 'delivery-2', order_item_id: 'item-1', unit_index: 2, player_id: '123456789', package_id: '6', package_name: 'FF 100 Diamonds', status: 'failed', provider_order_id: 'prov-2', attempts: 1, last_error: 'Provider timeout', delivered_at: null },
      ],
    } : page));
    mount('/admin/orders/order-1');
    expect(await screen.findByText('Provider timeout')).toBeInTheDocument();
    expect(screen.getByText('prov-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry 1 failed unit' }));
    await waitFor(() => expect(mocks.process).toHaveBeenCalledWith('order-1', true));
  });
  it('keeps the provider package picker staff-side in the plan editor', async () => {
    mocks.resource.mockImplementation((resource: string) => ready(resource === 'plans' ? { ...page, total: 0, rows: [] } : resource === 'categories' ? { ...page, total: 0, rows: [] } : page));
    mocks.read.mockImplementation((resource: string) => Promise.resolve(resource === 'categories' ? { rows: [], total: 0, page: 1, page_size: 100 } : page));
    mount('/admin/plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Create plan' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Product type/), 'topup');
    expect(await within(dialog).findByLabelText(/^Provider package/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.packages).toHaveBeenCalled());
    expect(within(dialog).queryByLabelText('Billing term (days)')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Product type/), 'seat');
    expect(within(dialog).queryByLabelText(/^Provider package/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Billing term (days)')).toBeInTheDocument();
  });
});

describe('catalog and owner workflows', () => {
  it.each([
    ['free-fire-diamonds', 'Free Fire Diamonds', 'FF'],
    ['pubg-uc', 'PUBG Mobile UC', 'UC'],
  ])('offers %s as a Gaming name choice without saving a product', async (key, name, initial) => {
    mocks.read.mockResolvedValue({ ...page, total: 1, rows: [
      { id: 'gaming', name: 'Gaming', slug: 'gaming', sort_order: 50, archived: false },
    ] });
    mount('/admin/plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const editor = within(screen.getByRole('dialog'));
    await editor.findByRole('option', { name: 'Gaming' });
    await userEvent.selectOptions(editor.getByLabelText('Category'), 'gaming');
    const service = editor.getByLabelText(/^Service \/ brand/);
    expect(within(service).getByRole('option', { name: 'Free Fire Diamonds (initials only)' })).toBeInTheDocument();
    expect(within(service).getByRole('option', { name: 'PUBG Mobile UC' })).toBeInTheDocument();
    await userEvent.selectOptions(service, key);
    expect(editor.getByLabelText('Plan name')).toHaveValue(name);
    expect(editor.getByLabelText(/^Slug/)).toHaveValue(key);
    expect(editor.getByLabelText(/^Brand key/)).toHaveValue(key);
    expect(editor.getByLabelText('Fallback initial')).toHaveValue(initial);
    expect(editor.getByLabelText(/^USD price/)).toHaveValue('');
    expect(editor.getByLabelText(/^ETB price/)).toHaveValue('');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('lists service names under the chosen category and previews branding without creating products', async () => {
    mocks.read.mockResolvedValue({ ...page, total: 2, rows: [
      { id: 'streaming', name: 'Streaming', slug: 'streaming', sort_order: 10, archived: false },
      { id: 'music', name: 'Music', slug: 'music', sort_order: 20, archived: false },
    ] });
    mount('/admin/plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const editor = within(screen.getByRole('dialog'));
    const service = editor.getByLabelText(/^Service \/ brand/);
    expect(service).toBeDisabled();
    await editor.findByRole('option', { name: 'Streaming' });
    await userEvent.selectOptions(editor.getByLabelText('Category'), 'streaming');
    expect(within(service).getByRole('option', { name: 'Netflix' })).toBeInTheDocument();
    expect(within(service).queryByRole('option', { name: 'Spotify' })).not.toBeInTheDocument();
    await userEvent.selectOptions(service, 'netflix');
    expect(editor.getByLabelText('Plan name')).toHaveValue('Netflix');
    expect(editor.getByLabelText(/^Slug/)).toHaveValue('netflix');
    expect(editor.getByLabelText(/^Brand key/)).toHaveValue('netflix');
    expect(editor.getByLabelText('Brand preview').querySelector('svg path')).toBeInTheDocument();
    expect(editor.getByLabelText(/^USD price/)).toHaveValue('');
    expect(editor.getByLabelText(/^ETB price/)).toHaveValue('');
    expect(mocks.mutate).not.toHaveBeenCalled();

    await userEvent.selectOptions(editor.getByLabelText('Category'), 'music');
    expect(within(service).getByRole('option', { name: 'Netflix (current branding)' })).toBeInTheDocument();
    await userEvent.selectOptions(service, 'spotify');
    expect(editor.getByLabelText('Plan name')).toHaveValue('Spotify');
    expect(editor.getByLabelText(/^Slug/)).toHaveValue('spotify');
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.change(editor.getByLabelText('Plan name'), { target: { value: 'My annual offer' } });
    fireEvent.change(editor.getByLabelText(/^Slug/), { target: { value: 'annual-offer' } });
    fireEvent.change(editor.getByLabelText(/^USD price/), { target: { value: '5.50' } });
    fireEvent.change(editor.getByLabelText('Billing term (days)'), { target: { value: '365' } });
    await userEvent.selectOptions(service, 'apple-music');
    expect(editor.getByLabelText('Plan name')).toHaveValue('My annual offer');
    expect(editor.getByLabelText(/^Slug/)).toHaveValue('annual-offer');
    expect(editor.getByLabelText(/^USD price/)).toHaveValue('5.50');
    expect(editor.getByLabelText('Billing term (days)')).toHaveValue(365);
    await userEvent.selectOptions(service, 'custom');
    expect(editor.getByLabelText('Brand preview').querySelector('svg')).toBeNull();
    expect(editor.getByLabelText('Plan name')).toHaveValue('My annual offer');
  });

  it('validates dual pricing before publishing a plan', async () => {
    mocks.read.mockResolvedValue({ ...page, total: 1, rows: [{ id: 'category-1', name: 'Subscriptions', slug: 'subscriptions', sort_order: 0, archived: false }] });
    mount('/admin/plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Plan name'), 'Test plan');
    await userEvent.type(within(dialog).getByLabelText(/^Slug/), 'test-plan');
    await userEvent.type(within(dialog).getByLabelText('Fallback initial'), 'T');
    await userEvent.type(within(dialog).getByLabelText(/^USD price/), '5.99');
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'active');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create plan' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('independent USD and ETB');
    expect(mocks.mutate).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/^ETB price/), '333.33');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create plan' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('active category');
    expect(mocks.mutate).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'category-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create plan' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'save_plan', input: expect.objectContaining({ usd_minor: 599, etb_minor: 33333, status: 'active' }) });
  });
  it('blocks dirty navigation when discard is rejected', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const { router } = mount('/admin/plans');
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    await userEvent.type(screen.getByLabelText('Plan name'), 'Unsaved');
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('Discard your unsaved changes?'));
    expect(router.state.location.pathname).toBe('/admin/plans');
  });
  it('sends invitations via the privileged endpoint and invalidates the team list', async () => {
    const { cache } = mount('/admin/team');
    const invalidation = vi.spyOn(cache, 'invalidateQueries');
    await userEvent.click(screen.getByRole('button', { name: 'Invite team member' }));
    expect(screen.getByText(/Existing accounts receive staff access without another email/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email address'), 'invited@example.test');
    await userEvent.selectOptions(screen.getByLabelText('Staff role'), 'manager');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledWith('invited@example.test', 'manager'));
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['bren', 'team'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('inventory controls', () => {
  beforeEach(() => {
    mocks.resource.mockImplementation((resource: string) => ready(resource === 'inventory' ? { ...page, total: 1, rows: [{
      id: 'plan-1', name: 'Inventory test plan', status: 'active', capacity: 5, allocated: 3, available: 2, low_stock_threshold: 2,
    }] } : resource === 'allocations' ? { ...page, total: 1, rows: [{
      id: 'allocation-1', order_id: 'order-1', order_reference: 'BREN-TEST', plan_id: 'plan-1', plan_name: 'Inventory test plan',
      customer_name: 'Test customer', qty: 1, started_at: '2026-01-01T00:00:00Z', ends_at: '2026-02-01T00:00:00Z', released_at: null, release_reason: null,
    }] } : page));
  });
  it('records a new total capacity with a reason, not a delta', async () => {
    mount('/admin/inventory');
    await userEvent.click(screen.getByRole('button', { name: 'Adjust Inventory test plan capacity' }));
    const input = screen.getByLabelText(/New total capacity/);
    expect(input).toHaveAttribute('max', '1000000');
    expect(screen.getByLabelText('Adjustment reason')).toHaveAttribute('maxlength', '1000');
    await userEvent.clear(input);
    await userEvent.type(input, '8');
    await userEvent.type(screen.getByLabelText('Adjustment reason'), 'Three additional seats verified');
    await userEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'adjust_capacity', input: { plan_id: 'plan-1', capacity: 8, reason: 'Three additional seats verified' } });
  });
  it('requires explicit access removal acknowledgement before release', async () => {
    mount('/admin/inventory');
    await userEvent.click(screen.getByRole('button', { name: 'Release allocation for Test customer' }));
    expect(screen.getByLabelText('Reason / staff note')).toHaveAttribute('maxlength', '1000');
    await userEvent.type(screen.getByLabelText('Reason / staff note'), 'Access manually revoked');
    await userEvent.click(screen.getByRole('button', { name: 'Release allocation' }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /removed the customer's access/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Release allocation' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ action: 'release_allocation', input: { id: 'allocation-1', reason: 'Access manually revoked' } });
  });
  it('supports keyboard switching to immutable movement history', async () => {
    mount('/admin/inventory');
    const allocations = screen.getByRole('tab', { name: 'Seat allocations' });
    allocations.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Movement history' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'No inventory movements' })).toBeInTheDocument();
  });
});
