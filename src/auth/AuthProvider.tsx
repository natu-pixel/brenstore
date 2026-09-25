import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getMyRole } from '../features/api';
import type { Role } from '../features/api';
import { supabase, supabaseConfigurationError } from '../supabase';
import { authLink } from './redirects';

export interface AuthContextValue {
  user: User | null;
  role: Role | null;
  loading: boolean;
  error: string | null;
  refreshRole: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const message = (error: unknown) => error instanceof Error ? error.message : 'Authentication is unavailable. Please try again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(supabaseConfigurationError);
  const identity = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  const refreshRole = useCallback(async () => {
    const id = identity.current;
    const version = ++generation.current;
    setRole(null);
    if (!id) { setLoading(false); return; }
    setLoading(true);
    try {
      const next = await getMyRole();
      if (mounted.current && generation.current === version && identity.current === id) {
        setRole(next);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current && generation.current === version && identity.current === id) {
        setError(`Account permissions could not be checked: ${message(cause)}. Ask the store administrator to verify the Supabase deployment, then retry.`);
      }
    } finally {
      if (mounted.current && generation.current === version) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!supabase) return () => { mounted.current = false; };
    // INITIAL_SESSION is the single restoration source; a second getSession can
    // race a newer sign-in/sign-out event and restore the wrong identity.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;
      const next = session?.user ?? null;
      ++generation.current;
      if (identity.current !== (next?.id ?? null)) {
        void cache.cancelQueries();
        cache.clear();
      }
      identity.current = next?.id ?? null;
      setUser(next);
      setRole(null);
      setError(null);
      setLoading(Boolean(next));
      if (event === 'PASSWORD_RECOVERY') navigateRef.current('/auth/update-password', { replace: true });
      if (event === 'SIGNED_IN' && authLink.type === 'invite' && window.location.pathname === '/auth/callback') {
        navigateRef.current('/auth/update-password', { replace: true });
      }
      if (next) {
        const version = generation.current;
        // Do not call another Supabase auth/RPC method inside its auth lock.
        queueMicrotask(() => {
          if (mounted.current && generation.current === version) void refreshRole();
        });
      }
    });
    const onFocus = () => { if (identity.current) void refreshRole(); };
    const invalidatePendingRole = () => { generation.current += 1; };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      invalidatePendingRole();
      data.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [cache, refreshRole]);

  const signOut = useCallback(async () => {
    if (!supabase) throw new Error(supabaseConfigurationError ?? 'Authentication is not configured.');
    try {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
    } catch (cause) {
      const detail = `Could not sign out: ${message(cause)} Your session has not been discarded. Retry signing out.`;
      setError(detail);
      throw new Error(detail);
    }
  }, []);

  return <AuthContext.Provider value={{ user, role, loading, error, refreshRole, signOut }}><Fragment key={user?.id ?? 'anonymous'}>{children}</Fragment></AuthContext.Provider>;
}

// eslint-disable-next-line react/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
