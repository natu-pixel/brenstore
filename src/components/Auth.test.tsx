import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Auth from './Auth';

const { enabled, methods } = vi.hoisted(() => ({
  enabled: { value: true, reason: 'Supabase is not configured. Contact the store administrator.' },
  methods: { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn() },
}));
vi.mock('../supabase', () => ({
  get supabase() { return enabled.value ? { auth: methods } : null; },
  get supabaseConfigurationError() { return enabled.value ? null : enabled.reason; },
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: null, loading: false }) }));

beforeEach(() => {
  enabled.value = true;
  enabled.reason = 'Supabase is not configured. Contact the store administrator.';
  Object.values(methods).forEach((method) => method.mockReset());
});
function setup(path = '/auth?returnTo=%2Fcheckout') {
  render(<MemoryRouter initialEntries={[path]}><Auth /></MemoryRouter>);
}
const enter = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.submit(document.querySelector('form')!);

describe('real account flows without demo authentication', () => {
  it('calls password sign-in and surfaces real failures', async () => {
    methods.signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials'), data: { session: null } });
    setup();
    enter('Email', 'customer@example.test'); enter(/^Password/, 'wrong-password'); submit();
    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument();
    expect(methods.signInWithPassword).toHaveBeenCalledWith({ email: 'customer@example.test', password: 'wrong-password' });
  });
  it('never creates a demo session when Supabase is unavailable', async () => {
    enabled.value = false;
    setup();
    enter('Email', 'customer@example.test'); enter(/^Password/, 'password'); submit();
    expect(methods.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Supabase is not configured/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Sign In' })[1]).toBeDisabled();
  });
  it.each(['Supabase URL is invalid.', 'Server-secret keys are forbidden in the browser.', 'The configured JWT must have the anon role.'])('surfaces the exact configuration reason: %s', (reason) => {
    enabled.value = false; enabled.reason = reason;
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent(reason);
    expect(screen.getAllByRole('button', { name: 'Sign In' })[1]).toBeDisabled();
    expect(methods.signInWithPassword).not.toHaveBeenCalled();
  });
  it('lets Supabase authenticate existing accounts with a shorter legacy password', async () => {
    methods.signInWithPassword.mockResolvedValue({ error: new Error('Server authentication result'), data: { session: null } });
    setup();
    enter('Email', 'customer@example.test'); enter(/^Password/, 'legacy'); submit();
    expect(await screen.findByText('Server authentication result')).toBeInTheDocument();
    expect(methods.signInWithPassword).toHaveBeenCalledWith({ email: 'customer@example.test', password: 'legacy' });
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('minlength', '1');
  });
  it('requires eight or more characters when creating a new password', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
    enter('Full name', 'Test Customer');
    enter('Confirm password', 'short');
    enter('Email', 'customer@example.test'); enter(/^Password/, 'short'); submit();
    expect(await screen.findByText('Use at least 8 characters for your password.')).toBeInTheDocument();
    expect(methods.signInWithPassword).not.toHaveBeenCalled();
    expect(methods.signUp).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('minlength', '8');
  });
  it('signs up a customer with a local confirmation callback and no staff metadata', async () => {
    methods.signUp.mockResolvedValue({ data: { session: null }, error: null });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
    enter('Full name', 'Test Customer'); enter('Email', 'customer@example.test');
    enter(/^Password/, 'secure-test-password'); enter('Confirm password', 'secure-test-password'); submit();
    expect(await screen.findByText(/Check your email for the confirmation link/)).toBeInTheDocument();
    const request = methods.signUp.mock.calls[0][0];
    expect(request.options.data).toEqual({ full_name: 'Test Customer' });
    const callback = new URL(request.options.emailRedirectTo);
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('returnTo')).toBe('/checkout');
  });
  it('requests a real password-reset email and preserves checkout return', async () => {
    methods.resetPasswordForEmail.mockResolvedValue({ error: null });
    setup('/auth/recovery?returnTo=%2Fcheckout');
    enter('Email', 'customer@example.test'); submit();
    expect(await screen.findByText(/If this address has an account/)).toBeInTheDocument();
    const callback = new URL(methods.resetPasswordForEmail.mock.calls[0][1].redirectTo);
    expect(callback.searchParams.get('type')).toBe('recovery');
    expect(callback.searchParams.get('returnTo')).toBe('/checkout');
  });
  it('does not let an expired recovery link update a password without a session', () => {
    setup('/auth/update-password');
    expect(screen.getByText(/This link has expired or was already used/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save password/ })).toBeDisabled();
    expect(methods.updateUser).not.toHaveBeenCalled();
  });
});
