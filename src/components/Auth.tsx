import { useState } from 'react';
import {
  IconArrowLeft,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconMailCheck,
} from '@tabler/icons-react';
import { supabase } from '../supabase';

export interface User {
  name: string;
  email: string;
}

export default function Auth({
  onBack,
  onAuthed,
}: {
  onBack: () => void;
  onAuthed: (user: User) => void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  const signin = mode === 'signin';

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const pwOk = password.length >= 6;
  const confirmOk = signin || confirm === password;
  const nameOk = signin || name.trim().length >= 2;
  const canSubmit = emailOk && pwOk && confirmOk && nameOk && !busy;

  const fallbackName = () =>
    email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');

    // demo mode when Supabase isn't configured
    if (!supabase) {
      onAuthed({ name: signin ? fallbackName() : name.trim(), email });
      return;
    }

    setBusy(true);
    try {
      if (signin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        const metaName =
          (data.user?.user_metadata?.full_name as string | undefined) ??
          fallbackName();
        onAuthed({ name: metaName, email: data.user?.email ?? email });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          // email confirmation is enabled on the project
          setConfirmSent(true);
        } else {
          onAuthed({ name: name.trim(), email: data.user?.email ?? email });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (confirmSent) {
    return (
      <section className="auth">
        <div className="auth-card checkout-success">
          <IconMailCheck size={64} className="success-icon" />
          <h1 className="auth-title">Check Your Email</h1>
          <p className="auth-sub">
            We sent a confirmation link to <b>{email}</b>. Click it, then come
            back and sign in.
          </p>
          <button
            className="btn auth-submit"
            onClick={() => {
              setConfirmSent(false);
              setMode('signin');
            }}
          >
            Go to Sign In
            <IconChevronRight size={20} stroke={2.8} className="chev" />
          </button>
          <button className="auth-switch success-back" onClick={onBack}>
            Back to store
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="auth">
      <button className="auth-back" onClick={onBack}>
        <IconArrowLeft size={18} stroke={2.4} /> Back to store
      </button>

      <div className="auth-card">
        <h1 className="auth-title">{signin ? 'Welcome Back' : 'Join Brenstore'}</h1>
        <p className="auth-sub">
          {signin
            ? 'Sign in to manage your plans and orders.'
            : 'It takes less than a minute.'}
        </p>

        {!supabase && (
          <p className="auth-demo-note">
            Demo mode — add your Supabase keys to <code>.env.local</code> for
            real accounts.
          </p>
        )}

        <div className="auth-tabs">
          <button
            className={'auth-tab' + (signin ? ' is-active' : '')}
            onClick={() => setMode('signin')}
          >
            Sign In
          </button>
          <button
            className={'auth-tab' + (!signin ? ' is-active' : '')}
            onClick={() => setMode('signup')}
          >
            Sign Up
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {!signin && (
            <label className="auth-field">
              <span>Full name</span>
              <input
                type="text"
                placeholder="Abebe Bikila"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <div className="pw-wrap">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="At least 6 characters"
                autoComplete={signin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? (
                  <IconEyeOff size={19} stroke={2} />
                ) : (
                  <IconEye size={19} stroke={2} />
                )}
              </button>
            </div>
          </label>
          {!signin && (
            <label className="auth-field">
              <span>Confirm password</span>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Repeat your password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {confirm.length > 0 && !confirmOk && (
                <em className="field-error">Passwords don't match yet</em>
              )}
            </label>
          )}

          {error && <p className="auth-error">{error}</p>}

          {signin && (
            <button type="button" className="auth-forgot">
              Forgot password?
            </button>
          )}

          <button type="submit" className="btn auth-submit" disabled={!canSubmit}>
            {busy ? (
              <>
                <IconLoader2 size={20} stroke={2.4} className="spin" /> Please
                wait…
              </>
            ) : (
              <>
                {signin ? 'Sign In' : 'Create Account'}
                <IconChevronRight size={20} stroke={2.8} className="chev" />
              </>
            )}
          </button>
        </form>

        <button className="auth-guest" onClick={onBack}>
          Continue as guest <IconChevronRight size={16} stroke={2.4} />
        </button>

        <p className="auth-note">
          {signin ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="auth-switch"
            onClick={() => setMode(signin ? 'signup' : 'signin')}
          >
            {signin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </section>
  );
}
