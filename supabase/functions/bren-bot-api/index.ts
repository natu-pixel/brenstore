import { createClient } from 'npm:@supabase/supabase-js@2.117.0';
import { createBotHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const backend = url && serverKey
  ? createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

Deno.serve(createBotHandler({
  apiKey: Deno.env.get('BREN_BOT_API_KEY'),
  origin: Deno.env.get('APP_ORIGIN'),
  backend: backend ? {
    allow: async (userId, linkStart) => await backend.rpc('bren_bot_allow', { telegram_user_id: userId, link_start: linkStart }),
    run: async (op, userId, input) => await backend.rpc('bren_bot', { op, telegram_user_id: userId, input }),
  } : null,
}));
