// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBotHandler } from '../supabase/functions/bren-bot-api/handler';
import type { BotBackend } from '../supabase/functions/bren-bot-api/handler';

const key = 'test-integration-key-not-a-real-secret-123456';
const allow = vi.fn<BotBackend['allow']>();
const run = vi.fn<BotBackend['run']>();
const handler = createBotHandler({ apiKey: key, origin: 'https://shop.example.test', backend: { allow, run } });
const valid = { version: 1, op: 'account.status', telegram_user_id: '123456789', input: {} };
function request(body: unknown = valid, headers: Record<string, string> = {}) {
  return new Request('https://project.example.test/functions/v1/bren-bot-api', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bren-Bot-Key': key, ...headers },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  allow.mockReset().mockResolvedValue({ data: 0, error: null });
  run.mockReset().mockResolvedValue({ data: { linked: false, customer_name: null }, error: null });
});

describe('bot API HTTP contract', () => {
  it('returns the versioned success envelope and safe headers', async () => {
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { linked: false, customer_name: null }, request_id: expect.any(String) });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(run).toHaveBeenCalledExactlyOnceWith('account.status', '123456789', {});
  });
  it.each(['', 'wrong-key', 'public-supabase-key'])('rejects invalid credentials before any lookup', async supplied => {
    const response = await handler(request(valid, { 'X-Bren-Bot-Key': supplied }));
    expect(response.status).toBe(401);
    expect(allow).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('rejects browser origins and non-POST methods', async () => {
    expect((await handler(request(valid, { Origin: 'https://shop.example.test' }))).status).toBe(403);
    expect((await handler(new Request('https://project.example.test'))).status).toBe(405);
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    { ...valid, version: 2 }, { ...valid, op: 'confirm_payment' }, { ...valid, telegram_user_id: 123 },
    { ...valid, telegram_user_id: '-123' }, { ...valid, telegram_user_id: '0123' },
    { ...valid, input: [] }, { ...valid, customer_id: 'spoofed' },
    { ...valid, op: 'link.start', input: { token: 'attacker-token' } },
  ])('rejects invalid envelopes without database mutations', async body => {
    expect((await handler(request(body))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it('bounds the streamed body and rejects malformed JSON', async () => {
    expect((await handler(request({ ...valid, input: { name: 'x'.repeat(33 * 1024) } }))).status).toBe(413);
    const broken = new Request('https://project.example.test', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Bren-Bot-Key': key,
    }, body: '{invalid' });
    expect((await handler(broken)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it('generates an opaque link token and only uses the configured origin', async () => {
    run.mockResolvedValue({ data: { request_id: '10000000-0000-4000-8000-000000000001', expires_at: '2026-10-02T15:00:00Z' }, error: null });
    const response = await handler(request({ ...valid, op: 'link.start', input: { name: 'Customer' } }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.url).toMatch(/^https:\/\/shop\.example\.test\/account\/telegram\/link\/[A-Za-z0-9_-]{43}$/);
    expect(run).toHaveBeenCalledWith('link.start', valid.telegram_user_id, { name: 'Customer', token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(json.data).not.toHaveProperty('token');
  });
  it('adds authenticated website order links to persisted results', async () => {
    const id = '20000000-0000-4000-8000-000000000001';
    run.mockResolvedValue({ data: { order: { id, status: 'pending' } }, error: null });
    const response = await handler(request({ ...valid, op: 'order.get', input: { id } }));
    expect((await response.json()).data.url).toBe(`https://shop.example.test/orders/${id}`);
  });
  it('returns persistent rate-limit advice without performing the operation', async () => {
    allow.mockResolvedValue({ data: 42, error: null });
    const response = await handler(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryable: true } });
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    ['PT403', 403, 'ACCOUNT_NOT_LINKED'], ['PT404', 404, 'NOT_FOUND'],
    ['PT409', 409, 'LINK_CONFLICT'], ['PT410', 410, 'LINK_UNAVAILABLE'],
    ['23505', 409, 'IDEMPOTENCY_CONFLICT'], ['23514', 409, 'ORDER_CHANGED'], ['22023', 400, 'INVALID_REQUEST'],
  ] as const)('maps %s without success-shaped fallbacks', async (code, status, expected) => {
    run.mockResolvedValue({ data: null, error: { code, message: 'Safe business error' } });
    const response = await handler(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: expected, retryable: false } });
  });
  it('logs only trace metadata and fails explicitly on unknown/backend errors', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    run.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'Sensitive database detail' } });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('Sensitive');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('Sensitive');
    expect(JSON.stringify(logged.mock.calls)).not.toContain(key);
    run.mockRejectedValue(new Error('Network down'));
    expect((await handler(request())).status).toBe(503);
    expect(logged).toHaveBeenCalled();
  });
  it('fails closed when configuration is absent or the origin is unsafe', async () => {
    for (const origin of [undefined, 'https://shop.example.test/path', 'http://external.example.test', 'invalid']) {
      expect((await createBotHandler({ apiKey: key, origin, backend: { allow, run } })(request())).status).toBe(503);
    }
    expect((await createBotHandler({ apiKey: undefined, origin: 'https://shop.example.test', backend: { allow, run } })(request())).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
});
