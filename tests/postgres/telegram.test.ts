import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { orderDetailSchema, resourceSchemas } from '../../src/features/contracts';
import type { Input } from '../../src/features/api';
import { startTestDatabase } from './database';
import { createBotHandler } from '../../supabase/functions/bren-bot-api/handler';
import type { RpcResult } from '../../supabase/functions/bren-bot-api/handler';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let owner: string;
let planId: string;
let topupId: string;
let sequence = 700000;
const nextId = () => String(++sequence);
const idOf = (data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id;
const bot = (op: string, tg: string, input: Input = {}) => db.rpc('bren_bot', [op, tg, input]);
const web = (op: string, customer: string, input: Input = {}) => db.rpc('bren_telegram', [op, input], 'authenticated', customer);
async function start(tg = nextId()) {
  const token = randomBytes(32).toString('base64url');
  const result = await bot('link.start', tg, { token, name: 'Telegram customer', username: 'customer' });
  const requestId = z.object({ request_id: z.string().uuid() }).parse(result).request_id;
  return { token, requestId, tg };
}
async function link(customer?: string) {
  const actor = customer ?? await db.createUser('Linked customer');
  const request = await start();
  await web('approve', actor, { token: request.token });
  await bot('link.confirm', request.tg, { request_id: request.requestId });
  return { ...request, actor };
}
function order(input: Input = {}): Input {
  return { idempotency_key: crypto.randomUUID(), name: 'Customer', phone: '+251911234567',
    currency: 'ETB', items: [{ plan_id: planId, qty: 1, unit_minor: 50000 }], ...input };
}
const botOrder = z.object({ order: z.object({ id: z.string().uuid(), source: z.string(), status: z.string(), payment_status: z.string() }) });

beforeAll(async () => {
  db = await startTestDatabase();
  owner = await db.createUser('Owner');
  await db.admin.query('select bren_private.bootstrap_owner($1)', [owner]);
  const category = idOf(await db.mutate('save_category', { name: 'Subscriptions', slug: 'telegram-tests', sort_order: 1, archived: false }, owner));
  const plan = {
    name: 'Monthly', slug: 'telegram-monthly', description: 'Test', category_id: category,
    brand_key: '', initial: 'M', color_start: '#111111', color_end: '#222222', usd_minor: 499, etb_minor: 50000,
    usd_compare_minor: null, etb_compare_minor: null, billing_days: 30, status: 'active',
    featured: false, low_stock_threshold: 1,
  };
  planId = idOf(await db.mutate('save_plan', plan, owner));
  await db.mutate('adjust_capacity', { plan_id: planId, capacity: 20, reason: 'Test stock' }, owner);
  topupId = idOf(await db.mutate('save_plan', { ...plan, name: 'Top-up', slug: 'telegram-topup', kind: 'topup', provider_package_id: '12345' }, owner));
});
afterAll(async () => { if (db) await db.stop(); });

describe('Telegram link and customer-only database contract', () => {
  it('requires both approvals, hides account data until approved, and never stores the raw token', async () => {
    const request = await start();
    const customer = await db.createUser('Website customer');
    expect(await bot('link.status', request.tg, { request_id: request.requestId })).toMatchObject({ state: 'pending', customer_name: null });
    await expect(bot('link.confirm', request.tg, { request_id: request.requestId })).rejects.toThrow('Approve');
    await expect(bot('order.create', request.tg, order())).rejects.toThrow('Connect');
    expect(await web('approve', customer, { token: request.token })).toMatchObject({ state: 'approved' });
    expect(await bot('account.status', request.tg)).toMatchObject({ linked: false });
    expect(await bot('link.confirm', request.tg, { request_id: request.requestId })).toMatchObject({ state: 'connected' });
    expect(await bot('link.confirm', request.tg, { request_id: request.requestId })).toMatchObject({ state: 'connected' });
    const stored = await db.admin.query('select to_jsonb(r) as row from bren_private.bren_telegram_requests r where id=$1', [request.requestId]);
    expect(JSON.stringify(stored.rows)).not.toContain(request.token);
  });

  it('denies anonymous/browser access to bot RPCs and blocks spoofing and another Telegram user', async () => {
    const customer = await db.createUser('Customer');
    const request = await start();
    await expect(db.rpc('bren_telegram', ['approve', { token: request.token }], 'anon')).rejects.toThrow();
    await expect(db.rpc('bren_bot', ['catalog.list', request.tg, {}], 'authenticated', customer)).rejects.toThrow();
    await expect(db.rpc('bren_bot_allow', [request.tg, false], 'authenticated', customer)).rejects.toThrow();
    await expect(web('approve', customer, { token: request.token, customer_id: owner })).rejects.toThrow();
    await expect(bot('link.status', nextId(), { request_id: request.requestId })).rejects.toThrow('unavailable');
    await web('approve', customer, { token: request.token });
    await expect(web('approve', owner, { token: request.token })).rejects.toThrow('unavailable');
    await expect(bot('confirm_payment', request.tg)).rejects.toThrow('Unknown');
  });

  it('handles superseded, rejected, expired, and conflicting links without replacing accounts', async () => {
    const customer = await db.createUser('Customer');
    const first = await start();
    const second = await start(first.tg);
    expect(await bot('link.status', first.tg, { request_id: first.requestId })).toMatchObject({ state: 'superseded' });
    await web('reject', customer, { token: second.token });
    await expect(bot('link.confirm', second.tg, { request_id: second.requestId })).rejects.toThrow('no longer active');
    const expired = await start();
    await db.admin.query("update bren_private.bren_telegram_requests set expires_at=now()-interval '1 second' where id=$1", [expired.requestId]);
    expect(await web('preview', customer, { token: expired.token })).toMatchObject({ state: 'expired' });
    await expect(web('approve', customer, { token: expired.token })).rejects.toThrow('no longer active');
    const active = await link(customer);
    await expect(start(active.tg)).rejects.toThrow('Disconnect');
    const another = await start();
    await expect(web('approve', customer, { token: another.token })).rejects.toThrow('already connected');
  });

  it('activates at most one of two concurrently approved Telegram identities', async () => {
    const customer = await db.createUser('Race customer');
    const requests = await Promise.all([start(), start()]);
    for (const request of requests) await web('approve', customer, { token: request.token });
    const results = await Promise.allSettled(requests.map(r => bot('link.confirm', r.tg, { request_id: r.requestId })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('persists one pending order across retries, exposes its channel on web, and preserves snapshots', async () => {
    const customer = await link();
    const payload = order();
    const replies = await Promise.all([bot('order.create', customer.tg, payload), bot('order.create', customer.tg, payload)]);
    const saved = botOrder.parse(replies[0]);
    expect(botOrder.parse(replies[1]).order.id).toBe(saved.order.id);
    expect(saved.order).toMatchObject({ source: 'telegram', status: 'pending', payment_status: 'pending' });
    const detail = orderDetailSchema.parse(await db.read('order', { id: saved.order.id }, customer.actor));
    expect(detail.order.source).toBe('telegram');
    expect(detail.items[0].unit_minor).toBe(50000);
    expect(resourceSchemas.my_orders.parse(await db.read('my_orders', {}, customer.actor)).rows.some(row => row.id === saved.order.id)).toBe(true);
    await expect(bot('order.create', customer.tg, { ...payload, phone: 'different' })).rejects.toThrow('Idempotency');
    await expect(db.mutate('create_order', payload, customer.actor)).rejects.toThrow('channel');
    await db.admin.query('update bren_private.bren_plans set etb_minor=60000 where id=$1', [planId]);
    try {
      expect(botOrder.parse(await bot('order.create', customer.tg, payload)).order.id).toBe(saved.order.id);
      await expect(bot('order.create', customer.tg, order())).rejects.toThrow('price changed');
    } finally { await db.admin.query('update bren_private.bren_plans set etb_minor=50000 where id=$1', [planId]); }
    const siteId = idOf(await db.mutate('create_order', order(), customer.actor));
    expect((await bot('order.get', customer.tg, { id: siteId }))).toMatchObject({ order: { source: 'website' } });
    await expect(bot('order.create', customer.tg, order({ customer_id: owner }))).rejects.toThrow();
    await expect(db.admin.query("update bren_private.bren_orders set source='website' where id=$1", [saved.order.id])).rejects.toThrow('cannot change');
  });

  it('uses customer-only reads even for linked staff and omits private metadata', async () => {
    const staff = await link(owner);
    const customer = await link();
    const saved = botOrder.parse(await bot('order.create', customer.tg, order()));
    await expect(bot('order.get', staff.tg, { id: saved.order.id })).rejects.toThrow('Order not found');
    await expect(bot('order.get', staff.tg, { id: crypto.randomUUID() })).rejects.toThrow('Order not found');
    const own = botOrder.parse(await bot('order.create', staff.tg, order()));
    await db.mutate('add_order_note', { id: own.order.id, note: 'private-staff-note' }, owner);
    const result = await bot('order.get', staff.tg, { id: own.order.id });
    const text = JSON.stringify(result);
    for (const forbidden of ['private-staff-note', 'customer_id', 'customer_name', 'phone', 'email', 'confirmed_by', 'provider_package_id', 'player_id']) expect(text).not.toContain(forbidden);
    const catalog = JSON.stringify(await bot('catalog.list', staff.tg));
    expect(catalog).not.toContain('provider_package_id');
    expect(catalog).not.toContain('"provider_package_id":"12345"');
  });

  it('validates subscription and top-up inputs with the shared commerce rules', async () => {
    const customer = await link();
    await expect(bot('order.create', customer.tg, order({ items: [{ plan_id: planId, qty: 10, unit_minor: 50000 }] }))).rejects.toThrow();
    await expect(bot('order.create', customer.tg, order({ items: [{ plan_id: topupId, qty: 1, unit_minor: 50000 }] }))).rejects.toThrow('player ID');
    await expect(bot('order.create', customer.tg, order({ items: [
      { plan_id: planId, qty: 1, unit_minor: 50000 }, { plan_id: topupId, qty: 1, unit_minor: 50000, player_id: '12345678' },
    ] }))).rejects.toThrow('separately');
    const result = await bot('order.create', customer.tg, order({ items: [{ plan_id: topupId, qty: 1, unit_minor: 50000, player_id: '12345678' }] }));
    expect(result).toMatchObject({ order: { status: 'pending' }, deliveries: { total: 0 } });
  });

  it('revokes access and old confirmations while preserving customer order history', async () => {
    const customer = await link();
    const saved = botOrder.parse(await bot('order.create', customer.tg, order()));
    expect(await web('unlink', customer.actor)).toMatchObject({ linked: false });
    await expect(bot('order.get', customer.tg, { id: saved.order.id })).rejects.toThrow('Connect');
    await expect(bot('order.create', customer.tg, order())).rejects.toThrow('Connect');
    await expect(bot('link.confirm', customer.tg, { request_id: customer.requestId })).rejects.toThrow('no longer active');
    expect(orderDetailSchema.parse(await db.read('order', { id: saved.order.id }, customer.actor)).order.id).toBe(saved.order.id);
    expect(await link(customer.actor)).toHaveProperty('actor', customer.actor);
  });

  it('serializes unlink versus order creation and blocks every subsequent request', async () => {
    const customer = await link();
    const results = await Promise.allSettled([bot('order.create', customer.tg, order()), web('unlink', customer.actor)]);
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') expect(String(results[0].reason)).toContain('Connect');
    await expect(bot('order.list', customer.tg)).rejects.toThrow('Connect');
    await expect(bot('order.create', customer.tg, order())).rejects.toThrow('Connect');
  });

  it('persists per-user quotas with exact thresholds', async () => {
    const tg = nextId();
    for (let index = 0; index < 60; index++) expect(await db.rpc('bren_bot_allow', [tg, false])).toBe(0);
    expect(await db.rpc('bren_bot_allow', [tg, false])).toBeGreaterThan(0);
    const starter = nextId();
    for (let index = 0; index < 5; index++) expect(await db.rpc('bren_bot_allow', [starter, true])).toBe(0);
    expect(await db.rpc('bren_bot_allow', [starter, true])).toBeGreaterThan(0);
  });

  it('runs the real HTTP handler through PostgreSQL for the complete colleague API contract', async () => {
    async function result(call: Promise<unknown>): Promise<RpcResult> {
      try { return { data: await call, error: null }; }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') throw error;
        return { data: null, error: { code: error.code, message: error.message,
          details: 'detail' in error && typeof error.detail === 'string' ? error.detail : null } };
      }
    }
    const key = randomBytes(32).toString('base64url');
    const tg = nextId();
    const customer = await db.createUser('HTTP contract customer');
    const handler = createBotHandler({
      apiKey: key, origin: 'https://shop.example.test', backend: {
        allow: (id, linkStart) => result(db.rpc('bren_bot_allow', [id, linkStart])),
        run: (op, id, input) => result(bot(op, id, input)),
      },
    });
    const success = z.object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()), request_id: z.string().uuid() });
    const failure = z.object({ ok: z.literal(false), error: z.object({
      code: z.string(), message: z.string(), retryable: z.boolean(),
    }), request_id: z.string().uuid() });
    async function send(op: string, input: Input = {}) {
      return handler(new Request('https://api.example.test/functions/v1/bren-bot-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bren-Bot-Key': key },
        body: JSON.stringify({ version: 1, op, telegram_user_id: tg, input }),
      }));
    }
    const started = success.parse(await (await send('link.start', { name: 'Telegram HTTP', username: 'http_customer' })).json());
    const linkData = z.object({ request_id: z.string().uuid(), expires_at: z.string().datetime({ offset: true }), url: z.string().url() }).parse(started.data);
    const token = new URL(linkData.url).pathname.split('/').at(-1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.request_id).not.toBe(linkData.request_id);
    const unapproved = await send('link.confirm', { request_id: linkData.request_id });
    expect(unapproved.status).toBe(409);
    expect(failure.parse(await unapproved.json()).error.code).toBe('LINK_NOT_APPROVED');
    await web('approve', customer, { token });
    expect(success.parse(await (await send('link.status', { request_id: linkData.request_id })).json()).data)
      .toMatchObject({ state: 'approved', customer_name: 'HTTP contract customer' });
    expect(success.parse(await (await send('link.confirm', { request_id: linkData.request_id })).json()).data)
      .toMatchObject({ state: 'connected' });
    const catalog = success.parse(await (await send('catalog.list')).json());
    expect(z.array(resourceSchemas.catalog.element).parse(catalog.data.plans).some(p => p.id === planId)).toBe(true);
    expect(resourceSchemas.public_categories.parse(catalog.data.categories).length).toBeGreaterThan(0);
    const payload = order();
    const firstResponse = await send('order.create', payload);
    expect(firstResponse.status).toBe(200);
    const first = success.parse(await firstResponse.json());
    const saved = botOrder.parse(first.data).order;
    expect(Object.keys(first.data).sort()).toEqual(['deliveries', 'items', 'order', 'payment_instructions', 'url']);
    expect(first.data.url).toBe(`https://shop.example.test/orders/${saved.id}`);
    expect(Object.keys(z.record(z.string(), z.unknown()).parse(first.data.order)).sort()).toEqual([
      'created_at', 'currency', 'id', 'payment_status', 'reference', 'source', 'status', 'total_minor', 'updated_at',
    ]);
    expect(botOrder.parse(success.parse(await (await send('order.create', payload)).json()).data).order.id).toBe(saved.id);
    const list = success.parse(await (await send('order.list', { page: 1, page_size: 1 })).json()).data;
    expect(list).toMatchObject({ total: 1, page: 1, page_size: 1 });
    expect(z.array(z.object({ id: z.string() })).parse(list.rows)[0].id).toBe(saved.id);
    const conflict = await send('order.create', { ...payload, name: 'Changed customer' });
    expect(conflict.status).toBe(409);
    expect(failure.parse(await conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
    const otherId = idOf(await db.mutate('create_order', order(), owner));
    const forbidden = await send('order.get', { id: otherId });
    expect(forbidden.status).toBe(404);
    expect(failure.parse(await forbidden.json()).error.code).toBe('NOT_FOUND');
    await web('unlink', customer);
    const revoked = await send('order.get', { id: saved.id });
    expect(revoked.status).toBe(403);
    expect(failure.parse(await revoked.json()).error.code).toBe('ACCOUNT_NOT_LINKED');
  });
});
