import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';

export function localStatus() {
  const output = execFileSync(process.execPath, [
    resolve('node_modules', 'supabase', 'dist', 'supabase.js'), 'status', '-o', 'json',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const status = z.object({
    API_URL: z.string().url(), ANON_KEY: z.string().min(1), SERVICE_ROLE_KEY: z.string().min(1),
  }).parse(JSON.parse(output));
  const host = new URL(status.API_URL).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Local development and test fixtures require loopback Supabase. Refusing a remote project.');
  }
  return status;
}
