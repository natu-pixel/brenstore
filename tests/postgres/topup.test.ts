import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { orderDetailSchema, planSchema } from '../../src/features/contracts';
import type { Input } from '../../src/features/api';
import { startTestDatabase } from './database';

type TestDatabase = Awaited<ReturnType<typeof startTestDatabase>>;
let instance: TestDatabase | undefined;
let owner: string;
let customer: string;
let categoryId: string;
const idOf = (data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id;
const database = () => {
  if (!instance) throw new Error('The test database has not started.');
  return instance;
};

beforeAll(async () => {
  instance = await startTestDatabase();
  owner = await instance.createUser('Fixture Owner');
  customer = await instance.createUser('Top-up Customer');
  await instance.admin.query('select bren_private.bootstrap_owner($1)', [owner]);
  categoryId = idOf(await instance.mutate('save_category', {
    name: 'Gaming', slug: `gaming-${crypto.randomUUID()}`, sort_order: 0, archived: false,
  }, owner));
});

afterAll(async () => { if (instance) await instance.stop(); });

function topupPlan(overrides: Input = {}): Input {
  return {
    name: 'Free Fire 100 Diamonds', slug: `ff-${crypto.randomUUID()}`, description: 'Instant diamond top-up',
    category_id: categoryId, brand_key: 'free-fire-diamonds', initial: 'FF',
    color_start: '#b45309', color_end: '#78350f', usd_minor: 250, etb_minor: 30000,
    usd_compare_minor: null, etb_compare_minor: null, billing_days: 1,
    status: 'active', featured: false, low_stock_threshold: 0,
    kind: 'topup', provider_package_id: '6', ...overrides,
  };
}

async function createTopupPlan(overrides: Input = {}) {
  return idOf(await database().mutate('save_plan', topupPlan(overrides), owner));
}

function intent(items: Input[], overrides: Input = {}): Input {
  return {
    idempotency_key: crypto.randomUUID(), currency: 'USD',
    name: 'Top-up customer', phone: '+251911234567', telegram: '',
    items, ...overrides,
  };
}

async function detail(id: string, userId = owner) {
  return orderDetailSchema.parse(await database().read('order', { id }, userId));
}

async function confirm(id: string, amountMinor: number) {
  await database().mutate('confirm_payment', { id, reference: `manual-${id}`, amount_minor: amountMinor, currency: 'USD' }, owner);
}

async function paidTopupOrder(qty = 2, playerId = '123456789') {
  const planId = await createTopupPlan();
  const orderId = idOf(await database().mutate('create_order', intent(
    [{ plan_id: planId, qty, unit_minor: 250, player_id: playerId }]), customer));
  await confirm(orderId, 250 * qty);
  return { planId, orderId };
}

describe('top-up plans and provider delivery', () => {
  it('publishes a top-up plan as always available without exposing provider linkage publicly', async () => {
    const planId = await createTopupPlan();
    const catalog = z.array(planSchema).parse(await database().read('catalog', {}, null, 'anon'));
    const item = catalog.find((row) => row.id === planId);
    expect(item?.kind).toBe('topup');
    expect(item?.available).toBeNull();
    expect(item).not.toHaveProperty('provider_package_id');
    const staff = await database().read('plans', { plan_id: planId }, owner) as { rows: { provider_package_id?: string; kind: string }[] };
    expect(staff.rows[0]?.kind).toBe('topup');
    expect(staff.rows[0]?.provider_package_id).toBe('6');
  });

  it('requires a provider package for top-up plans and rejects one on seat plans', async () => {
    await expect(database().mutate('save_plan', topupPlan({ provider_package_id: null }), owner)).rejects.toThrow(/provider package/i);
    await expect(database().mutate('save_plan', topupPlan({ kind: 'seat' }), owner)).rejects.toThrow(/only valid for top-up/i);
    await expect(database().mutate('save_plan', topupPlan({ kind: 'invalid' }), owner)).rejects.toThrow(/kind/i);
  });

  it('blocks product-type changes once a plan has orders', async () => {
    const planId = await createTopupPlan();
    await database().mutate('create_order', intent([{ plan_id: planId, qty: 1, unit_minor: 250, player_id: '123456789' }]), customer);
    await expect(database().mutate('save_plan', topupPlan({ id: planId, kind: 'seat', provider_package_id: null }), owner))
      .rejects.toThrow(/product type/i);
  });

  it('requires a numeric player ID per top-up item and rejects mixed orders', async () => {
    const topupId = await createTopupPlan();
    const seatId = idOf(await database().mutate('save_plan', {
      ...topupPlan(), slug: `seat-${crypto.randomUUID()}`, kind: 'seat', provider_package_id: null,
    }, owner));
    await database().mutate('adjust_capacity', { plan_id: seatId, capacity: 5, reason: 'Test capacity' }, owner);
    await expect(database().mutate('create_order', intent([{ plan_id: topupId, qty: 1, unit_minor: 250 }]), customer)).rejects.toThrow(/player ID/i);
    await expect(database().mutate('create_order', intent([{ plan_id: topupId, qty: 1, unit_minor: 250, player_id: 'abc123' }]), customer)).rejects.toThrow(/player ID/i);
    await expect(database().mutate('create_order', intent([{ plan_id: topupId, qty: 1, unit_minor: 250, player_id: '12345' }]), customer)).rejects.toThrow(/player ID/i);
    await expect(database().mutate('create_order', intent([
      { plan_id: topupId, qty: 1, unit_minor: 250, player_id: '123456789' },
      { plan_id: seatId, qty: 1, unit_minor: 250 },
    ]), customer)).rejects.toThrow(/separately/i);
    await expect(database().mutate('create_order', intent([{ plan_id: seatId, qty: 1, unit_minor: 250, player_id: '123456789' }]), customer)).rejects.toThrow(/only valid for top-up/i);
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: topupId, qty: 2, unit_minor: 250, player_id: '123456789' }]), customer));
    const saved = await detail(orderId, customer);
    expect(saved.items[0]?.player_id).toBe('123456789');
    expect(saved.order.total_minor).toBe(500);
  });

  it('queues one delivery per unit on payment confirmation without consuming seats', async () => {
    const { planId, orderId } = await paidTopupOrder(2);
    const saved = await detail(orderId);
    expect(saved.order.status).toBe('paid');
    expect(saved.deliveries).toHaveLength(2);
    expect(saved.deliveries.map((delivery) => [delivery.unit_index, delivery.status, delivery.player_id, delivery.package_id])).toEqual([
      [1, 'queued', '123456789', '6'],
      [2, 'queued', '123456789', '6'],
    ]);
    const allocations = await database().read('allocations', { plan_id: planId }, owner) as { total: number };
    expect(allocations.total).toBe(0);
    expect(saved.events.map((event) => event.action)).toEqual(['created', 'payment_confirmed']);
  });

  it('transitions deliveries through the service workflow and auto-fulfills the order', async () => {
    const { orderId } = await paidTopupOrder(2);
    const pending = z.object({ order_status: z.string(), deliveries: z.array(z.object({ id: z.string(), status: z.string() })) })
      .parse(await database().rpc('bren_topup_pending', [orderId, false]));
    expect(pending.order_status).toBe('paid');
    expect(pending.deliveries.map((delivery) => delivery.status)).toEqual(['queued', 'queued']);
    const [first, second] = pending.deliveries;
    await database().rpc('bren_topup_started', [first.id, 'prov-order-1']);
    await database().rpc('bren_topup_finished', [first.id, true, '']);
    let saved = await detail(orderId);
    expect(saved.order.status).toBe('paid');
    expect(saved.deliveries.find((delivery) => delivery.id === first.id)).toMatchObject({ status: 'delivered', attempts: 1, provider_order_id: 'prov-order-1' });
    // Manual fulfillment is blocked while units remain open.
    await expect(database().mutate('fulfill_order', { id: orderId, note: '' }, owner)).rejects.toThrow(/in progress/i);
    await database().rpc('bren_topup_started', [second.id, 'prov-order-2']);
    const finished = z.object({ order_status: z.string() }).parse(await database().rpc('bren_topup_finished', [second.id, true, '']));
    expect(finished.order_status).toBe('fulfilled');
    saved = await detail(orderId);
    expect(saved.order.status).toBe('fulfilled');
    expect(saved.events.map((event) => event.action)).toEqual(['created', 'payment_confirmed', 'topup_delivered', 'topup_delivered', 'fulfilled']);
    // Re-finishing a delivered unit is an idempotent no-op.
    const again = z.object({ delivery_status: z.string(), order_status: z.string() })
      .parse(await database().rpc('bren_topup_finished', [first.id, true, '']));
    expect(again).toEqual({ delivery_status: 'delivered', order_status: 'fulfilled' });
    expect((await detail(orderId)).events).toHaveLength(5);
  });

  it('fails deliveries with staff-only detail and supports an explicit retry', async () => {
    const { orderId } = await paidTopupOrder(1);
    const pending = z.object({ deliveries: z.array(z.object({ id: z.string() })) })
      .parse(await database().rpc('bren_topup_pending', [orderId, false]));
    const deliveryId = pending.deliveries[0]!.id;
    await database().rpc('bren_topup_started', [deliveryId, 'prov-order-9']);
    await database().rpc('bren_topup_finished', [deliveryId, false, 'Provider rejected the player ID.']);
    let saved = await detail(orderId);
    expect(saved.order.status).toBe('paid');
    expect(saved.deliveries[0]).toMatchObject({ status: 'failed', attempts: 1, last_error: 'Provider rejected the player ID.' });
    // The customer sees the failure state but not internal notes or provider identifiers.
    const customerView = await detail(orderId, customer);
    expect(customerView.deliveries[0]).toMatchObject({ status: 'failed' });
    expect(customerView.deliveries[0]).not.toHaveProperty('provider_order_id');
    expect(customerView.deliveries[0]).not.toHaveProperty('last_error');
    expect(customerView.events.map((event) => event.action)).toEqual(['created', 'payment_confirmed']);
    // Failed units stay out of the default queue and re-enter only through retry.
    const stillPending = z.object({ deliveries: z.array(z.object({ id: z.string() })) })
      .parse(await database().rpc('bren_topup_pending', [orderId, false]));
    expect(stillPending.deliveries).toHaveLength(0);
    const retry = z.object({ deliveries: z.array(z.object({ id: z.string(), status: z.string(), provider_order_id: z.string().nullable() })) })
      .parse(await database().rpc('bren_topup_pending', [orderId, true]));
    expect(retry.deliveries).toEqual([{ id: deliveryId, status: 'queued', provider_order_id: null }]);
    await database().rpc('bren_topup_started', [deliveryId, 'prov-order-10']);
    await database().rpc('bren_topup_finished', [deliveryId, true, '']);
    saved = await detail(orderId);
    expect(saved.order.status).toBe('fulfilled');
    expect(saved.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  it('keeps the delivery workflow service-role only', async () => {
    const { orderId } = await paidTopupOrder(1);
    const pending = z.object({ deliveries: z.array(z.object({ id: z.string() })) })
      .parse(await database().rpc('bren_topup_pending', [orderId, false]));
    const deliveryId = pending.deliveries[0]!.id;
    await expect(database().rpc('bren_topup_pending', [orderId, false], 'authenticated', customer)).rejects.toThrow();
    await expect(database().rpc('bren_topup_pending', [orderId, false], 'anon', null)).rejects.toThrow();
    await expect(database().rpc('bren_topup_started', [deliveryId, 'x'], 'authenticated', owner)).rejects.toThrow();
    await expect(database().rpc('bren_topup_finished', [deliveryId, true, ''], 'authenticated', owner)).rejects.toThrow();
  });

  it('rejects queue processing for unpaid or seat-only orders', async () => {
    const planId = await createTopupPlan();
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: planId, qty: 1, unit_minor: 250, player_id: '123456789' }]), customer));
    await expect(database().rpc('bren_topup_pending', [orderId, false])).rejects.toThrow(/awaiting top-up delivery/i);
    await expect(database().rpc('bren_topup_pending', [crypto.randomUUID(), false])).rejects.toThrow(/not found/i);
  });
});
