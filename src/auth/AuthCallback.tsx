import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { authLink } from './redirects';
import { supabase } from '../supabase';

export default function AuthCallback() {
  const { user, loading, error } = useAuth();
  const navigate = useNavigate();
  const [initialized, setInitialized] = useState(!supabase);
  const [linkError, setLinkError] = useState<string | null>(authLink.error);
  useEffect(() => {
    let active = true;
    // Await the SDK's existing URL exchange, never exchange a PKCE code twice.
    void supabase?.auth.initialize().then((result) => {
      if (active) {
        if (result.error) setLinkError(result.error.message);
        setInitialized(true);
      }
    }).catch(() => {
      if (active) { setLinkError('The sign-in link could not be verified. Request a new link.'); setInitialized(true); }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if ((loading && !user) || !initialized) return;
    if (linkError || !authLink.hasCredentials || !user) {
      window.history.replaceState(null, '', '/auth/callback');
      return;
    }
    navigate(authLink.type === 'recovery' || authLink.type === 'invite' ? '/auth/update-password' : authLink.returnTo, { replace: true });
  }, [user, loading, navigate, initialized, linkError]);
  if ((loading && !user) || !initialized) return <p className="store-state" role="status">Verifying your sign-in link…</p>;
  if (linkError || !authLink.hasCredentials || !user) return (
    <section className="auth"><div className="auth-card">
      <h1 className="auth-title">Link unavailable</h1>
      <p className="auth-error" role="alert">{linkError ?? error ?? 'This link is invalid, expired, or has already been used.'}</p>
      <p>Open the newest email link. For a staff invitation, ask the owner to send a new invitation.</p>
      <Link className="btn" to="/auth/recovery">Request a new reset link</Link>
      <Link className="auth-guest" to="/auth">Back to sign in</Link>
    </div></section>
  );
  return <p className="store-state" role="status">Opening your account…</p>;
}
