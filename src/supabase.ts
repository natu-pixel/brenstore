import { createClient } from '@supabase/supabase-js';
import type { Database } from './types/database';
import { validatePublicConfig } from './lib/supabase-config';

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigurationError = validatePublicConfig(url, anonKey);

export const supabase = url && anonKey && !supabaseConfigurationError
  ? createClient<Database>(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export const supabaseConfigured = supabase !== null;
