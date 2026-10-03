import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TelegramConnection from './TelegramConnection';

const operation = vi.hoisted(() => vi.fn());
vi.mock('../features/api', () => ({ telegramOperation: operation }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'customer', email: 'customer@example.test' } }) }));
const token = 'a'.repeat(43);
let state: string;
let linked: boolean;
function mount(path = `/account/telegram/link/${token}`) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/account/telegram" element={<TelegramConnection />} />
    <Route path="/account/telegram/link/:token" element={<TelegramConnection />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  state = 'pending'; linked = false;
  operation.mockReset().mockImplementation(async (op: string) => {
    if (op === 'unlink') { linked = false; state = 'revoked'; }
    if (op === 'status' || op === 'unlink') return { linked, connection: linked ? { name: 'Telegram customer', username: 'telegram_user', linked_at: '2026-10-02T00:00:00Z' } : null };
    if (op === 'approve') state = 'approved';
    if (op === 'reject') state = 'rejected';
    return { state, name: 'Telegram customer', username: 'telegram_user', expires_at: '2026-10-02T20:00:00Z' };
  });
});

describe('Telegram linking screens', () => {
  it('requires an explicit website click and keeps approval distinct from connection', async () => {
    const user = userEvent.setup();
    mount();
    const approve = await screen.findByRole('button', { name: 'Approve connection' });
    await waitFor(() => expect(approve).toBeEnabled());
    expect(operation).not.toHaveBeenCalledWith('approve', expect.anything());
    await user.click(approve);
    expect(operation).toHaveBeenCalledWith('approve', { token });
    expect(await screen.findByText(/Website approval saved/)).toBeVisible();
    expect(screen.queryByText(/^Telegram is connected/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect Telegram' })).not.toBeInTheDocument();
  });
  it('allows rejection and renders terminal states', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Reject connection' }));
    expect(await screen.findByText(/You rejected this connection/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve connection' })).not.toBeInTheDocument();
  });
  it.each(['expired', 'superseded', 'revoked'])('never offers approval for %s links', async value => {
    state = value; mount();
    await screen.findByText(/Telegram: Telegram customer/);
    expect(screen.queryByRole('button', { name: 'Approve connection' })).not.toBeInTheDocument();
  });
  it('requires explicit disconnect confirmation and preserves a truthful disconnected state', async () => {
    linked = true; state = 'connected';
    const user = userEvent.setup(); mount('/account/telegram');
    const disconnect = await screen.findByRole('button', { name: 'Disconnect Telegram' });
    expect(disconnect).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Disconnect Telegram and stop/ }));
    await user.click(disconnect);
    expect(await screen.findByText(/No active Telegram connection/)).toBeVisible();
    expect(operation).toHaveBeenCalledWith('unlink', {});
  });
  it('shows failed checks explicitly and does not claim successful connection', async () => {
    operation.mockRejectedValue(new Error('Service unavailable'));
    mount();
    expect(await screen.findByText(/Connection check failed/)).toBeVisible();
    expect(await screen.findByText(/Connection status unavailable/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve connection' })).not.toBeInTheDocument();
  });
  it('does not send malformed link tokens to the backend', async () => {
    mount('/account/telegram/link/invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid connection link');
    await waitFor(() => expect(operation).toHaveBeenCalledWith('status'));
    expect(operation).not.toHaveBeenCalledWith('preview', expect.anything());
  });
});
