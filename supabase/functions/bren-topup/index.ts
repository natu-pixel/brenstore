import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.0';

// gtopup.co provider integration. The API key never leaves this function:
// staff call the `packages` and `process` operations with their own session.
const PROVIDER_BASE = 'https://api.gtopup.co/api/v1/external';
// Bounded run: deliveries still open when the budget ends stay queued/processing
// and are picked up by the next staff-triggered run.
const PROCESS_BUDGET_MS = 40_000;
const POLL_INTERVAL_MS = 2_000;

type Delivery = {
  id: string;
  unit_index: number;
  player_id: string;
  package_id: string;
  package_name: string;
  status: 'queued' | 'processing' | 'delivered' | 'failed';
  provider_order_id: string | null;
  attempts: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function providerOrderId(data: unknown): string | null {
  const root = asRecord(data);
  const order = asRecord(root?.order);
  const id = order?.id ?? order?.order_id ?? root?.orderId ?? root?.order_id ?? root?.id;
  if (typeof id === 'string' && id.trim()) return id.trim().slice(0, 120);
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

function providerStatus(data: unknown): 'delivered' | 'failed' | 'pending' {
  const root = asRecord(data);
  const order = asRecord(root?.order);
  const raw = String(order?.status ?? root?.status ?? '').trim().toLowerCase();
  if (['completed', 'complete', 'success', 'delivered'].includes(raw)) return 'delivered';
  if (['failed', 'cancelled', 'canceled', 'rejected', 'refunded'].includes(raw)) return 'failed';
  return 'pending';
}

function providerMessage(data: unknown, fallback: string): string {
  const root = asRecord(data);
  const text = root?.message ?? root?.error ?? root?.detail;
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 300);
  return fallback;
}

async function providerFetch(path: string, apiKey: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${PROVIDER_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (response.status === 401) throw new ProviderAuthError();
  if (!response.ok) {
    throw new ProviderCallError(`Provider responded HTTP ${response.status}: ${providerMessage(data, text.slice(0, 200))}`);
  }
  if (asRecord(data)?.success === false) {
    throw new ProviderCallError(providerMessage(data, 'Provider rejected the request.'));
  }
  return data;
}

class ProviderAuthError extends Error {
  constructor() {
    super('The top-up provider rejected the configured API key. Check the GTOPUP_API_KEY secret.');
  }
}
class ProviderCallError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify({ message: 'Top-up request failed.', ...body }), { status, headers });
  if (!origin) return reply(503, { message: 'Top-ups are not configured. Set the server APP_ORIGIN secret.' });
  if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) {
    return reply(403, { message: 'This origin is not allowed.' });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { message: 'Use POST.' });
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, { message: 'Sign in before managing top-ups.' });
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('GTOPUP_API_KEY');
  if (!url || !publicKey || !serverKey) return reply(503, { message: 'The top-up service is not configured.' });
  if (!apiKey) return reply(503, { message: 'The top-up provider key is not configured. Set the GTOPUP_API_KEY secret.' });
  const caller = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return reply(401, { message: 'Your session expired. Sign in again.' });
  const { data: role, error: roleError } = await caller.rpc('bren_my_role');
  if (roleError) {
    console.error('Top-up role lookup failed', { code: roleError.code });
    return reply(503, { message: 'Unable to verify staff permissions. Try again.' });
  }
  if (role !== 'owner' && role !== 'manager') {
    return reply(403, { message: 'Only an active Owner or Manager can manage top-ups.' });
  }
  const raw = await request.text();
  if (raw.length > 2048) return reply(413, { message: 'The top-up request is too large.' });
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return reply(400, { message: 'Provide a valid JSON request.' });
  }
  const body = asRecord(input);
  const op = typeof body?.op === 'string' ? body.op : '';
  const admin = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (op === 'packages') return await listPackages(headers, apiKey);
    if (op === 'process') return await processOrder(headers, admin, apiKey, body ?? {});
    return reply(400, { message: 'Unsupported top-up operation.' });
  } catch (error) {
    if (error instanceof ProviderAuthError) return reply(502, { message: error.message });
    console.error('Top-up operation failed', { op, error: String(error) });
    return reply(502, { message: 'The top-up provider could not be reached. Deliveries were not changed unexpectedly; check the order and retry.' });
  }
});

async function listPackages(headers: Headers, apiKey: string): Promise<Response> {
  const data = await providerFetch('/packages', apiKey);
  const rows = Array.isArray(asRecord(data)?.packages) ? asRecord(data)?.packages as unknown[] : [];
  const packages = rows.map((row) => {
    const record = asRecord(row) ?? {};
    return {
      id: String(record.id ?? ''),
      name: String(record.name ?? ''),
      cost_points: typeof record.price === 'number' ? record.price : Number(record.price) || 0,
    };
  }).filter((row) => /^[0-9]{1,10}$/.test(row.id) && row.name)
    .sort((a, b) => Number(a.id) - Number(b.id));
  return new Response(JSON.stringify({ packages }), { status: 200, headers });
}

async function processOrder(
  headers: Headers,
  admin: SupabaseClient,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const orderId = typeof body.order_id === 'string' ? body.order_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return new Response(JSON.stringify({ message: 'A valid order id is required.' }), { status: 400, headers });
  }
  const retryFailed = body.retry_failed === true;
  const { data: work, error: workError } = await admin.rpc('bren_topup_pending', {
    p_order_id: orderId, p_retry_failed: retryFailed,
  });
  if (workError) {
    console.error('Top-up pending lookup failed', { code: workError.code });
    return new Response(
      JSON.stringify({ message: providerRpcMessage(workError.message) }),
      { status: 409, headers },
    );
  }
  const root = asRecord(work) ?? {};
  const deliveries = (Array.isArray(root.deliveries) ? root.deliveries : []) as Delivery[];
  const deadline = Date.now() + PROCESS_BUDGET_MS;
  let delivered = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    if (Date.now() >= deadline) break;
    try {
      if (delivery.status === 'queued' || !delivery.provider_order_id) {
        const created = await providerFetch('/topup', apiKey, {
          method: 'POST',
          body: JSON.stringify({ playerId: delivery.player_id, packageName: Number(delivery.package_id) }),
        });
        const providerId = providerOrderId(created);
        if (!providerId) {
          await finish(admin, delivery.id, false, 'Provider response did not include an order id.');
          failed += 1;
          continue;
        }
        const { error: startError } = await admin.rpc('bren_topup_started', {
          p_delivery_id: delivery.id, p_provider_order_id: providerId,
        });
        if (startError) {
          console.error('Top-up start persist failed', { code: startError.code });
          break;
        }
        delivery.provider_order_id = providerId;
      }
      // Poll until the provider finalizes or the run budget ends.
      let outcome: 'delivered' | 'failed' | 'pending' = 'pending';
      let lastData: unknown = null;
      while (Date.now() < deadline) {
        lastData = await providerFetch(`/check-order/${encodeURIComponent(delivery.provider_order_id)}`, apiKey);
        outcome = providerStatus(lastData);
        if (outcome !== 'pending') break;
        await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
      }
      if (outcome === 'pending') break; // Still pending at the provider; stays processing for the next run.
      await finish(admin, delivery.id, outcome === 'delivered',
        outcome === 'failed' ? providerMessage(lastData, 'Provider marked the order failed.') : '');
      if (outcome === 'delivered') delivered += 1;
      else failed += 1;
    } catch (error) {
      if (error instanceof ProviderAuthError) throw error;
      if (error instanceof ProviderCallError) {
        await finish(admin, delivery.id, false, error.message);
        failed += 1;
        continue;
      }
      // Network-level failure after a create call may have created a provider order.
      await finish(admin, delivery.id, false,
        'Uncertain provider outcome (network error). Check the provider panel before retrying this unit.');
      failed += 1;
    }
  }
  const { data: after } = await admin.rpc('bren_topup_pending', { p_order_id: orderId, p_retry_failed: false });
  const afterRoot = asRecord(after) ?? {};
  const open = Array.isArray(afterRoot.deliveries) ? afterRoot.deliveries.length : 0;
  const orderStatus = typeof afterRoot.order_status === 'string' ? afterRoot.order_status : 'unknown';
  const message = open === 0 && failed === 0
    ? 'All top-up deliveries are complete.'
    : open > 0
    ? 'Some deliveries are still being processed by the provider. Check again shortly.'
    : 'Some deliveries failed. Review them and retry.';
  return new Response(JSON.stringify({
    message, order_status: orderStatus, delivered, failed, open,
  }), { status: 200, headers });
}

async function finish(admin: SupabaseClient, deliveryId: string, ok: boolean, error: string): Promise<void> {
  const { error: rpcError } = await admin.rpc('bren_topup_finished', {
    p_delivery_id: deliveryId, p_ok: ok, p_error: error,
  });
  if (rpcError) {
    console.error('Top-up finish persist failed', { code: rpcError.code, deliveryId });
    throw new Error('Could not record the delivery outcome.');
  }
}

function providerRpcMessage(message: string | undefined): string {
  const known = ['Order not found.', 'Order is not awaiting top-up delivery.', 'Order has no top-up deliveries.'];
  return known.find((candidate) => message?.includes(candidate)) ?? 'Unable to load the delivery queue. Try again.';
}
