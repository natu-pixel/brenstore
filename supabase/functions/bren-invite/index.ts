import { createClient } from 'npm:@supabase/supabase-js@2.117.0';

const roles = new Set(['owner', 'manager', 'support']);

Deno.serve(async (request: Request) => {
  const origin = Deno.env.get('APP_ORIGIN');
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  });
  if (origin && request.headers.get('Origin') === origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  const reply = (status: number, message: string, id?: string) =>
    new Response(JSON.stringify({ message, ...(id ? { id } : {}) }), { status, headers });
  if (!origin) return reply(503, 'Staff invitations are not configured. Set the server APP_ORIGIN secret.');
  if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) {
    return reply(403, 'This origin is not allowed.');
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, 'Use POST.');
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, 'Sign in before inviting staff.');
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serverKey) return reply(503, 'The invitation service is not configured.');
  const caller = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return reply(401, 'Your session expired. Sign in again.');
  const { data: role, error: roleError } = await caller.rpc('bren_my_role');
  if (roleError) {
    console.error('Staff invitation role lookup failed', { code: roleError.code });
    return reply(503, 'Unable to verify staff permissions. Try again.');
  }
  if (role !== 'owner') return reply(403, 'Only an active Owner can invite staff.');
  const raw = await request.text();
  if (raw.length > 2048) return reply(413, 'The invitation is too large.');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return reply(400, 'Provide a valid JSON invitation.');
  }
  if (typeof input !== 'object' || input === null || !('email' in input) || !('role' in input)) {
    return reply(400, 'Email and role are required.');
  }
  if (typeof input.email !== 'string' || typeof input.role !== 'string') {
    return reply(400, 'Email and role must be text.');
  }
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roles.has(input.role)) {
    return reply(400, 'Provide a valid email and staff role.');
  }
  const admin = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existingId, error: lookupError } = await admin.rpc('bren_staff_lookup_email', { email });
  if (lookupError) {
    console.error('Staff invitation account lookup failed', { code: lookupError.code });
    return reply(503, 'Unable to check the account. No invitation was sent.');
  }
  let userId: string;
  let invited = false;
  if (typeof existingId === 'string') {
    userId = existingId;
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?type=invite&returnTo=%2Fadmin`,
    });
    if (error || !data.user) {
      console.error('Staff invitation delivery failed', { code: error?.code, status: error?.status });
      return reply(502, 'Supabase could not send the invitation. Check email delivery configuration and try again.');
    }
    userId = data.user.id;
    invited = true;
  }
  const { error: registrationError } = await admin.rpc('bren_register_staff', {
    user_id: userId, staff_role: input.role, actor_id: auth.user.id,
  });
  if (registrationError) {
    console.error('Staff role registration failed', { code: registrationError.code, invited });
    return reply(409, invited
      ? 'The invitation email was sent, but staff access was not granted. Check Owner permissions and retry for this email.'
      : 'Staff access was not changed. Check Owner permissions and retry.');
  }
  return reply(200, invited ? 'Invitation sent.' : 'Access granted to the existing account.', userId);
});
