import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Input } from '../src/features/api';
import { localStatus } from '../scripts/local-supabase.ts';
export { localStatus } from '../scripts/local-supabase.ts';

export function localAdmin() {
  const status = localStatus();
  return createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function createTestAccount(label: string) {
  const status = localStatus();
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `bren-test-${label}-${crypto.randomUUID()}@example.test`;
  const password = `${crypto.randomUUID()}Aa9!`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: `Test ${label}` },
  });
  if (error || !data.user) throw new Error(error?.message ?? 'Could not create the local test account.');
  const client = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, id: data.user.id, email, password };
}

export function localSql(sql: string) {
  localStatus();
  return execFileSync('docker', [
    'exec', '-i', 'supabase_db_brenstore', 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A',
  ], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export async function command(client: ReturnType<typeof createClient>, action: string, input: Input) {
  const result = await client.rpc('bren_mutate', { action, input });
  if (result.error) throw new Error(result.error.message);
  return z.object({ id: z.string().optional() }).parse(result.data);
}
