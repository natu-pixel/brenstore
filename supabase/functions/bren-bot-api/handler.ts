export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
export type RpcResult = { data: unknown; error: { code: string; message: string; details?: string | null } | null };
export interface BotBackend {
  allow: (userId: string, linkStart: boolean) => Promise<RpcResult>;
  run: (op: string, userId: string, input: ObjectValue) => Promise<RpcResult>;
}
type Config = { apiKey: string | undefined; origin: string | undefined; backend: BotBackend | null };
const operations = new Set(['link.start', 'link.status', 'link.confirm', 'account.status', 'catalog.list', 'order.create', 'order.list', 'order.get']);
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function equalKey(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([provided, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(a); const right = new Uint8Array(b);
  let different = 0;
  for (let index = 0; index < left.length; index++) different |= left[index] ^ right[index];
  return different === 0;
}

function linkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createBotHandler(config: Config) {
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const reply = (status: number, body: ObjectValue, retryAfter?: number) => new Response(
      JSON.stringify({ ...body, request_id: requestId }), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) },
      });
    const fail = (status: number, code: string, message: string, retryAfter?: number) =>
      reply(status, { ok: false, error: { code, message, retryable: status === 429 || status === 503 } }, retryAfter);
    const unavailable = () => fail(503, 'UNAVAILABLE', 'The bot service is unavailable. Retry later with the same checkout key.');
    if (request.method !== 'POST') return fail(405, 'INVALID_REQUEST', 'Use POST.');
    if (!config.apiKey || config.apiKey.length < 32 || !config.origin || !config.backend) return unavailable();
    let origin: URL;
    try { origin = new URL(config.origin); }
    catch { return unavailable(); }
    if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
      || origin.origin !== config.origin || origin.username || origin.password) return unavailable();
    const supplied = request.headers.get('X-Bren-Bot-Key');
    if (!supplied || supplied.length > 512 || !await equalKey(supplied, config.apiKey)) {
      return fail(401, 'UNAUTHORIZED', 'A valid bot integration key is required.');
    }
    if (request.headers.has('Origin')) return fail(403, 'FORBIDDEN', 'This endpoint is for the bot server, not browsers.');
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
      return fail(400, 'INVALID_REQUEST', 'Use application/json.');
    }
    const limit = 32 * 1024;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body?.getReader();
    if (!reader) return fail(400, 'INVALID_REQUEST', 'A JSON body is required.');
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return fail(413, 'REQUEST_TOO_LARGE', 'Request exceeds 32 KiB.');
        }
        chunks.push(chunk.value);
      }
    } catch {
      console.error('Bot request body read failed', { requestId });
      return fail(400, 'INVALID_REQUEST', 'Unable to read the request body.');
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return fail(400, 'INVALID_REQUEST', 'Provide valid UTF-8 JSON.'); }
    if (!object(body) || Object.keys(body).some(key => !['version', 'op', 'telegram_user_id', 'input'].includes(key))
      || body.version !== 1 || typeof body.op !== 'string' || !operations.has(body.op)
      || typeof body.telegram_user_id !== 'string' || !/^[1-9][0-9]{0,15}$/.test(body.telegram_user_id) || !object(body.input)) {
      return fail(400, 'INVALID_REQUEST', 'Provide version 1, a supported operation, a decimal-string Telegram user ID, and an input object.');
    }
    const op = body.op; const userId = body.telegram_user_id; let input = body.input;
    const token = op === 'link.start' ? linkToken() : null;
    if (token) {
      if (Object.keys(input).some(key => !['name', 'username'].includes(key))) return fail(400, 'INVALID_REQUEST', 'Only name and username are accepted when starting a link.');
      input = { ...input, token };
    }
    try {
      const quota = await config.backend.allow(userId, op === 'link.start');
      if (quota.error || typeof quota.data !== 'number' || !Number.isInteger(quota.data) || quota.data < 0) {
        console.error('Bot quota check failed', { requestId, code: quota.error?.code });
        return unavailable();
      }
      if (quota.data > 0) return fail(429, 'RATE_LIMITED', 'Too many requests. Wait before retrying.', quota.data);
      const result = await config.backend.run(op, userId, input);
      if (result.error) {
        const { code, message, details } = result.error;
        const codes: Record<string, [number, string]> = {
          '22023': [400, 'INVALID_REQUEST'], '22P02': [400, 'INVALID_REQUEST'],
          '23505': [409, 'IDEMPOTENCY_CONFLICT'], '23514': [409, 'ORDER_CHANGED'],
          'PT403': [403, 'ACCOUNT_NOT_LINKED'], 'PT404': [404, 'NOT_FOUND'],
          'PT409': [409, 'LINK_CONFLICT'], 'PT410': [410, 'LINK_UNAVAILABLE'],
          '42501': [403, 'FORBIDDEN'],
        };
        const mapped = codes[code];
        if (mapped) return fail(mapped[0], details === 'LINK_NOT_APPROVED' ? details : mapped[1], message);
        console.error('Bot database operation failed', { requestId, op, code });
        return unavailable();
      }
      if (!object(result.data)) {
        console.error('Bot database returned invalid data', { requestId, op });
        return unavailable();
      }
      const data = result.data;
      if (token) {
        if (typeof data.request_id !== 'string' || !uuid.test(data.request_id) || typeof data.expires_at !== 'string') {
          console.error('Bot link response invalid', { requestId });
          return unavailable();
        }
        data.url = new URL(`/account/telegram/link/${token}`, origin).href;
      }
      if (op === 'order.create' || op === 'order.get') {
        if (!object(data.order) || typeof data.order.id !== 'string' || !uuid.test(data.order.id)) {
          console.error('Bot order response invalid', { requestId });
          return unavailable();
        }
        data.url = new URL(`/orders/${data.order.id}`, origin).href;
      }
      return reply(200, { ok: true, data });
    } catch {
      console.error('Bot backend request failed', { requestId, op });
      return unavailable();
    }
  };
}
