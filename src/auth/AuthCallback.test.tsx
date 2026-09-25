import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthCallback from './AuthCallback';

const { initialize, state, link } = vi.hoisted(() => ({
  initialize: vi.fn(),
  state: { user: { id: 'customer' } as { id: string } | null, loading: false, error: null },
  link: { type: null as string | null, error: null, hasCredentials: true, returnTo: '/checkout' },
}));
vi.mock('./AuthProvider', () => ({ useAuth: () => state }));
vi.mock('../supabase', () => ({ supabase: { auth: { initialize } } }));
vi.mock('./redirects', () => ({ authLink: link }));

beforeEach(() => {
  initialize.mockReset().mockResolvedValue({ error: null });
  state.user = { id: 'customer' }; state.loading = false;
  link.type = null; link.hasCredentials = true;
});
function setup() {
  render(<MemoryRouter initialEntries={['/auth/callback?code=test']}><Routes>
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/checkout" element={<p>Restored checkout</p>} />
    <Route path="/auth/update-password" element={<p>Choose password</p>} />
  </Routes></MemoryRouter>);
}
describe('auth callback validation', () => {
  it('awaits the existing SDK URL exchange before redirecting', async () => {
    setup();
    expect(await screen.findByText('Restored checkout')).toBeInTheDocument();
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it('reports an expired link even if an older user session is still present', async () => {
    initialize.mockResolvedValue({ error: new Error('Email link is invalid or has expired') });
    setup();
    expect(await screen.findByText('Email link is invalid or has expired')).toBeInTheDocument();
    expect(screen.queryByText('Restored checkout')).not.toBeInTheDocument();
  });
  it.each(['recovery', 'invite'])('lets a verified %s session set a password', async (type) => {
    link.type = type;
    setup();
    expect(await screen.findByText('Choose password')).toBeInTheDocument();
  });
  it('rejects a callback without link credentials', async () => {
    link.hasCredentials = false;
    setup();
    expect(await screen.findByText('Link unavailable')).toBeInTheDocument();
  });
});
