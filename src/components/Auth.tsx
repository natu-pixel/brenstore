import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { IconArrowLeft, IconChevronRight, IconEye, IconEyeOff } from '@tabler/icons-react';
import { supabase, supabaseConfigurationError } from '../supabase';
import { useAuth } from '../auth/AuthProvider';
import { authLink, authRedirect, safeReturnPath } from '../auth/redirects';

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading } = useAuth();
  const returnTo = safeReturnPath(params.get('returnTo'));
  const passwordUpdate = location.pathname === '/auth/update-password';
  const recovery = location.pathname === '/auth/recovery';
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const signin = mode === 'signin';

  useEffect(() => {
    if (user && !passwordUpdate && !recovery) navigate(returnTo, { replace: true });
  }, [user, passwordUpdate, recovery, navigate, returnTo]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!supabase) { setError(supabaseConfigurationError ?? 'Authentication is unavailable. Contact the store administrator.'); return; }
    if (!recovery && (!signin || passwordUpdate) && password.length < 8) {
      setError('Use at least 8 characters for your password.'); return;
    }
    if (!recovery && (!signin || passwordUpdate) && password !== confirm) {
      setError('Passwords must match.'); return;
    }
    setBusy(true);
    try {
      if (passwordUpdate) {
        if (!user) throw new Error('This link has expired or was already used. Request a new password reset or staff invitation.');
        const result = await supabase.auth.updateUser({ password });
        if (result.error) throw result.error;
        navigate(authLink.returnTo, { replace: true });
      } else if (recovery) {
        const result = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authRedirect('/auth/callback?type=recovery', returnTo),
        });
        if (result.error) throw result.error;
        setSent('If this address has an account, a password reset link has been sent. Open the newest email on this browser.');
      } else if (signin) {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
        if (!result.data.session) throw new Error('No authenticated session was returned. Please retry signing in.');
      } else {
        const result = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: authRedirect('/auth/callback', returnTo) },
        });
        if (result.error) throw result.error;
        if (!result.data.session) setSent('Check your email for the confirmation link. If you already have an account, sign in or request a password reset.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed. Please retry.');
    } finally { setBusy(false); }
  }

  const invalidLink = passwordUpdate && !loading && !user;
  return (
    <section className="auth">
      <Link className="auth-back" to="/"><IconArrowLeft size={18} /> Back to store</Link>
      <div className="auth-card">
        <h1 className="auth-title">{passwordUpdate ? 'Set your password' : recovery ? 'Reset password' : signin ? 'Welcome Back' : 'Join Brenstore'}</h1>
        <p className="auth-sub">{passwordUpdate ? 'Choose a password for your recovered or invited account.' : recovery ? 'We will email a secure reset link.' : 'Sign in to place orders and view your saved order history.'}</p>
        {supabaseConfigurationError && <p className="auth-error" role="alert">{supabaseConfigurationError}</p>}
        {invalidLink && <p className="auth-error" role="alert">This link has expired or was already used. <Link to="/auth/recovery">Request a new reset link</Link>, or ask the owner for a fresh invitation.</p>}
        {!passwordUpdate && !recovery && (
          <div className="auth-tabs">
            <button className={'auth-tab' + (signin ? ' is-active' : '')} disabled={busy} onClick={() => { setMode('signin'); setSent(''); setError(''); }}>Sign In</button>
            <button className={'auth-tab' + (!signin ? ' is-active' : '')} disabled={busy} onClick={() => { setMode('signup'); setSent(''); setError(''); }}>Sign Up</button>
          </div>
        )}
        {sent ? <p className="store-notice" role="status">{sent}</p> : (
          <form className="auth-form" onSubmit={submit}>
            {!signin && !passwordUpdate && !recovery && (
              <label className="auth-field"><span>Full name</span><input autoComplete="name" value={name} minLength={2} maxLength={120} required onChange={(e) => setName(e.target.value)} /></label>
            )}
            {!passwordUpdate && (
              <label className="auth-field"><span>Email</span><input type="email" autoComplete="email" required value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></label>
            )}
            {!recovery && <>
              <label className="auth-field">
                <span>{passwordUpdate ? 'New password' : 'Password'}</span>
                <div className="pw-wrap">
                  <input type={showPw ? 'text' : 'password'} autoComplete={signin && !passwordUpdate ? 'current-password' : 'new-password'} required minLength={signin && !passwordUpdate ? 1 : 8} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <IconEyeOff size={19} /> : <IconEye size={19} />}</button>
                </div>
              </label>
              {(!signin || passwordUpdate) && <label className="auth-field"><span>Confirm password</span><input type={showPw ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>}
            </>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="btn auth-submit" disabled={busy || !supabase || invalidLink || (passwordUpdate && loading)}>
              {busy ? 'Please wait…' : passwordUpdate ? 'Save password' : recovery ? 'Send reset link' : signin ? 'Sign In' : 'Create Account'}
              <IconChevronRight size={20} className="chev" />
            </button>
          </form>
        )}
        {!passwordUpdate && <Link className="auth-guest" to={recovery ? `/auth?returnTo=${encodeURIComponent(returnTo)}` : `/auth/recovery?returnTo=${encodeURIComponent(returnTo)}`}>{recovery ? 'Back to sign in' : 'Forgot password?'}</Link>}
        <Link className="auth-guest" to="/#products">Browse plans without signing in</Link>
      </div>
    </section>
  );
}
