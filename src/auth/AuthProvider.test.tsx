import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';
import ProtectedRoute from './ProtectedRoute';

const { roleRpc, subscribe, signOut, config } = vi.hoisted(() => ({
  roleRpc: vi.fn(), subscribe: vi.fn(), signOut: vi.fn(), config: { available: true, error: null as string | null },
}));
vi.mock('../features/api', () => ({ getMyRole: roleRpc }));
vi.mock('../supabase', () => ({
  get supabaseConfigurationError() { return config.error; },
  get supabase() { return config.available ? { auth: { onAuthStateChange: subscribe, signOut } } : null; },
}));
let emit: (event: string, session: { user: User } | null) => void;
const customer = { id: '10000000-0000-4000-8000-000000000001', email: 'customer@example.test', user_metadata: { role: 'owner' } } as unknown as User;

beforeEach(() => {
  config.available = true; config.error = null;
  roleRpc.mockReset().mockResolvedValue(null);
  signOut.mockReset().mockResolvedValue({ error: null });
  subscribe.mockReset().mockImplementation((callback) => {
    emit = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

function Probe() {
  const auth = useAuth();
  return <><p data-testid="identity">{auth.user?.id ?? 'anonymous'}</p><p data-testid="role">{auth.role ?? 'customer'}</p><p data-testid="loading">{String(auth.loading)}</p><p>{auth.error}</p><button onClick={() => void auth.signOut().catch(() => {})}>Sign out</button></>;
}
function setup(path = '/', staff = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(['private'], 'previous customer details');
  render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><AuthProvider><Probe /><Routes>
    <Route element={<ProtectedRoute staff={staff} />}><Route path="/" element={<h1>Protected content</h1>} /></Route>
    <Route path="/auth" element={<p>Sign-in required</p>} />
  </Routes></AuthProvider></MemoryRouter></QueryClientProvider>);
  return cache;
}

describe('authoritative shared auth and route protection', () => {
  it('preserves the precise configuration error without attempting auth restoration', () => {
    config.available = false; config.error = 'Server-secret keys are forbidden in the browser.';
    setup();
    expect(screen.getByText(config.error)).toBeInTheDocument();
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(subscribe).not.toHaveBeenCalled();
    expect(roleRpc).not.toHaveBeenCalled();
  });
  it('redirects anonymous customers to sign in after a single restoration source', async () => {
    setup();
    act(() => emit('INITIAL_SESSION', null));
    expect(await screen.findByText('Sign-in required')).toBeInTheDocument();
    expect(roleRpc).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
  it('allows customers without a staff role and ignores editable metadata', async () => {
    setup();
    act(() => emit('INITIAL_SESSION', { user: customer }));
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    expect(screen.getByTestId('role')).toHaveTextContent('customer');
  });
  it('does not grant admin access from customer metadata', async () => {
    setup('/', true);
    act(() => emit('INITIAL_SESSION', { user: customer }));
    expect(await screen.findByText('Admin access unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });
  it('keeps a valid session when the role RPC fails and fails closed for staff', async () => {
    roleRpc.mockRejectedValue(new Error('bren_my_role not deployed'));
    setup('/', true);
    act(() => emit('INITIAL_SESSION', { user: customer }));
    expect(await screen.findByText('Admin access unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('identity')).toHaveTextContent(customer.id);
    expect(screen.getAllByText(/permissions could not be checked/).length).toBeGreaterThan(0);
  });
  it('clears private cached data and prevents a stale role response restoring signed-out access', async () => {
    let resolveRole: (value: 'owner') => void = () => {};
    roleRpc.mockReturnValue(new Promise((resolve) => { resolveRole = resolve; }));
    const cache = setup();
    act(() => emit('SIGNED_IN', { user: customer }));
    await waitFor(() => expect(roleRpc).toHaveBeenCalled());
    expect(cache.getQueryData(['private'])).toBeUndefined();
    act(() => emit('SIGNED_OUT', null));
    await act(async () => resolveRole('owner'));
    expect(screen.getByTestId('identity')).toHaveTextContent('anonymous');
    expect(screen.getByTestId('role')).toHaveTextContent('customer');
  });
  it('reports sign-out failures without faking a signed-out session', async () => {
    signOut.mockResolvedValue({ error: new Error('offline') });
    setup();
    act(() => emit('SIGNED_IN', { user: customer }));
    await screen.findByText('Protected content');
    fireEvent.click(screen.getByText('Sign out'));
    expect(await screen.findByText(/Could not sign out: offline/)).toBeInTheDocument();
    expect(screen.getByTestId('identity')).toHaveTextContent(customer.id);
  });
});
