import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { localStatus } from './local-supabase.ts';

const config = localStatus();
const local = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false } });
const { error } = await local.rpc('bren_read', { resource: 'public_settings', args: {} });
if (error) throw new Error(`Local database is not ready: ${error.message}`);
console.log('Using isolated local Supabase. Hosted environment settings are unchanged.');
const child = spawn(process.execPath, [
  resolve('node_modules', 'vite', 'bin', 'vite.js'), ...process.argv.slice(2),
], {
  stdio: 'inherit',
  env: {
    ...process.env, VITE_SUPABASE_URL: config.API_URL, VITE_SUPABASE_ANON_KEY: config.ANON_KEY,
  },
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
