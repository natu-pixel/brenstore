import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { orderDetailSchema, planSchema } from '../../src/features/contracts';
import type { Input } from '../../src/features/contracts';
import { startTestDatabase } from './database';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let owner: string;
let customer: string;
let category: string;
const idOf = (value: unknown) => z.object({ id: z.string().uuid() }).parse(value).id;

beforeAll(async () => {
  database = await startTestDatabase();
  owner = await database.createUser('Stress fixture owner');
  customer = await database.createUser('Stress fixture customer');
  await database.admin.query('select bren_private.bootstrap_owner($1)', [owner]);
  category = idOf(await database.mutate('save_category', {
    name: 'Local stress fixture', slug: 'local-stress-fixture', sort_order: 0, archived: false,
  }, owner));
});

afterAll(async () => { if (database) await database.stop(); });

async function plan(capacity: number) {
  const input: Input = {
    name: 'Stress fixture plan', slug: `stress-${crypto.randomUUID()}`, description: 'Disposable local fixture.',
    category_id: category, brand_key: '', initial: 'T', color_start: '#112233', color_end: '#334455',
    usd_minor: 499, etb_minor: 85000, usd_compare_minor: null, etb_compare_minor: null,
    billing_days: 30, status: 'active', featured: false, low_stock_threshold: 1,
  };
  const id = idOf(await database.mutate('save_plan', input, owner));
  await database.mutate('adjust_capacity', { plan_id: id, capacity, reason: 'Local stress-test inventory' }, owner);
  return { id, input };
}

function quote(ids: string[], qty = 1, currency: 'USD' | 'ETB' = 'USD'): Input {
  return {
    idempotency_key: crypto.randomUUID(), name: 'Local fixture customer', phone: '+251900000000', telegram: '',
    currency, items: ids.map(plan_id => ({ plan_id, qty, unit_minor: currency === 'USD' ? 499 : 85000 })),
  };
}

async function stock(id: string) {
  const plans = z.array(planSchema).parse(await database.read('catalog', {}, null, 'anon'));
  const item = plans.find(candidate => candidate.id === id);
  if (!item) throw new Error('Expected fixture plan is missing.');
  return item;
}

async function wave(label: string, jobs: Array<() => Promise<unknown>>) {
  const elapsed: number[] = [];
  const started = performance.now();
  const results = await Promise.allSettled(jobs.map(async job => {
    const time = performance.now();
    try { return await job(); }
    finally { elapsed.push(performance.now() - time); }
  }));
  elapsed.sort((a, b) => a - b);
  const duration = performance.now() - started;
  console.info(JSON.stringify({
    scenario: label, clients: jobs.length, accepted: results.filter(result => result.status === 'fulfilled').length,
    rejected: results.filter(result => result.status === 'rejected').length,
    duration_ms: Math.round(duration), p95_ms: Math.round(elapsed[Math.ceil(elapsed.length * 0.95) - 1]),
    max_ms: Math.round(elapsed.at(-1) ?? 0),
  }));
  return results;
}

function rejectOnly(results: PromiseSettledResult<unknown>[], code: string) {
  for (const result of results) {
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ code });
  }
}

describe('bounded local transaction stress (maximum 32 simultaneous clients)', () => {
  it('deduplicates 32 concurrent checkout retries and 32 identical payment confirmations', async () => {
    const item = await plan(8);
    const input = quote([item.id], 3);
    const orders = await wave('same-checkout-key', Array.from({ length: 32 }, () => () => database.mutate('create_order', input, customer)));
    expect(orders.every(result => result.status === 'fulfilled')).toBe(true);
    const ids = orders.flatMap(result => result.status === 'fulfilled' ? [idOf(result.value)] : []);
    expect(new Set(ids).size).toBe(1);
    const order = ids[0];
    expect(await stock(item.id)).toMatchObject({ capacity: 8, allocated: 0, available: 8 });
    const payment = { id: order, reference: `stress-${order}`, amount_minor: 1497, currency: 'USD' };
    const confirmations = await wave('same-payment-retry', Array.from({ length: 32 }, () => () => database.mutate('confirm_payment', payment, owner)));
    expect(confirmations.every(result => result.status === 'fulfilled')).toBe(true);
    expect(await stock(item.id)).toMatchObject({ capacity: 8, allocated: 3, available: 5 });
    const counts = await database.admin.query(`
      select (select count(*)::int from bren_private.bren_orders where id = $1) as orders,
        (select count(*)::int from bren_private.bren_payments where order_id = $1) as payments,
        (select count(*)::int from bren_private.bren_allocations where order_id = $1) as allocations,
        (select count(*)::int from bren_private.bren_movements where plan_id = $2 and kind = 'allocation') as movements
    `, [order, item.id]);
    expect(counts.rows).toEqual([{ orders: 1, payments: 1, allocations: 1, movements: 1 }]);
  });

  it('sells only eight seats to 32 competing paid orders and leaves rejected payments unrecorded', async () => {
    const item = await plan(8);
    const orders = await Promise.all(Array.from({ length: 32 }, async () => idOf(
      await database.mutate('create_order', quote([item.id]), customer),
    )));
    expect(await stock(item.id)).toMatchObject({ allocated: 0, available: 8 });
    const results = await wave('32-buyers-eight-seats', orders.map(id => () => database.mutate('confirm_payment', {
      id, reference: `stress-${id}`, amount_minor: 499, currency: 'USD',
    }, owner)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(8);
    rejectOnly(results, '23514');
    expect(await stock(item.id)).toMatchObject({ capacity: 8, allocated: 8, available: 0 });
    const records = await database.admin.query(`
      select o.status, o.payment_status, p.amount_minor, a.qty
      from bren_private.bren_orders o
      left join bren_private.bren_payments p on p.order_id = o.id
      left join bren_private.bren_allocations a on a.order_id = o.id
      where o.id = any($1::uuid[])
    `, [orders]);
    expect(records.rows.filter(row => row.status === 'paid')).toHaveLength(8);
    for (const row of records.rows) {
      expect(row).toEqual(row.status === 'paid'
        ? { status: 'paid', payment_status: 'confirmed', amount_minor: '499', qty: 1 }
        : { status: 'pending', payment_status: 'pending', amount_minor: null, qty: null });
    }
  });

  it('keeps multi-plan allocations atomic with reverse item order under 24-way contention', async () => {
    const first = await plan(7);
    const second = await plan(7);
    const orders = await Promise.all(Array.from({ length: 24 }, async (_, index) => idOf(await database.mutate(
      'create_order', quote(index % 2 ? [first.id, second.id] : [second.id, first.id]), customer,
    ))));
    const results = await wave('reversed-multi-plan-orders', orders.map(id => () => database.mutate('confirm_payment', {
      id, reference: `stress-${id}`, amount_minor: 998, currency: 'USD',
    }, owner)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(7);
    rejectOnly(results, '23514');
    expect(await stock(first.id)).toMatchObject({ allocated: 7, available: 0 });
    expect(await stock(second.id)).toMatchObject({ allocated: 7, available: 0 });
    const allocations = await database.admin.query(`
      select order_id, count(*)::int as lines from bren_private.bren_allocations
      where order_id = any($1::uuid[]) group by order_id
    `, [orders]);
    expect(allocations.rows).toHaveLength(7);
    expect(allocations.rows.every(row => row.lines === 2)).toBe(true);
  });

  it('accepts one normalized external reference across 16 orders and rolls back every losing allocation', async () => {
    const item = await plan(20);
    const orders = await Promise.all(Array.from({ length: 16 }, async () => idOf(
      await database.mutate('create_order', quote([item.id]), customer),
    )));
    const reference = `shared-${crypto.randomUUID()}`;
    const results = await wave('duplicate-external-payment', orders.map((id, index) => () => database.mutate('confirm_payment', {
      id, reference: index % 2 ? ` ${reference.toUpperCase()} ` : reference, amount_minor: 499, currency: 'USD',
    }, owner)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    rejectOnly(results, '23505');
    expect(await stock(item.id)).toMatchObject({ capacity: 20, allocated: 1, available: 19 });
    const payments = await database.admin.query('select count(*)::int as total from bren_private.bren_payments where order_id = any($1::uuid[])', [orders]);
    expect(payments.rows).toEqual([{ total: 1 }]);
  });

  it('releases one allocation exactly once under 24 concurrent requests without refunding money', async () => {
    const item = await plan(5);
    const order = idOf(await database.mutate('create_order', quote([item.id], 3), customer));
    await database.mutate('confirm_payment', { id: order, reference: `stress-${order}`, amount_minor: 1497, currency: 'USD' }, owner);
    const allocation = await database.admin.query<{ id: string }>('select id from bren_private.bren_allocations where order_id = $1', [order]);
    const results = await wave('same-allocation-release', Array.from({ length: 24 }, () => () => database.mutate('release_allocation', {
      id: allocation.rows[0].id, reason: 'Fixture access removed',
    }, owner)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    rejectOnly(results, '23514');
    expect(await stock(item.id)).toMatchObject({ capacity: 5, allocated: 0, available: 5 });
    const detail = orderDetailSchema.parse(await database.read('order', { id: order }, customer));
    expect(detail.order).toMatchObject({ status: 'paid', payment_status: 'confirmed', total_minor: 1497 });
    const releases = await database.admin.query('select count(*)::int as total from bren_private.bren_movements where plan_id = $1 and kind = $2', [item.id, 'release']);
    expect(releases.rows).toEqual([{ total: 1 }]);
  });

  it('never records an unapproved price when 20 quotes race a catalog edit', async () => {
    const item = await plan(30);
    const inputs = Array.from({ length: 20 }, () => quote([item.id]));
    const jobs: Array<() => Promise<unknown>> = inputs.map(input => () => database.mutate('create_order', input, customer));
    jobs.splice(10, 0, () => database.mutate('save_plan', { ...item.input, id: item.id, usd_minor: 599 }, owner));
    const results = await wave('catalog-edit-versus-quotes', jobs);
    expect(results[10].status).toBe('fulfilled');
    rejectOnly(results, '23514');
    const records = await database.admin.query(`
      select i.qty, i.unit_minor, o.total_minor, o.currency from bren_private.bren_order_items i
      join bren_private.bren_orders o on o.id = i.order_id where i.plan_id = $1
    `, [item.id]);
    expect(records.rows.length).toBe(results.filter(result => result.status === 'fulfilled').length - 1);
    expect(records.rows.every(row => row.qty === 1 && row.unit_minor === '499' && row.total_minor === '499' && row.currency === 'USD')).toBe(true);
    const current = await stock(item.id);
    expect(current).toMatchObject({ usd_minor: 599, etb_minor: 85000, allocated: 0, available: 30 });
  });

  it('keeps exact USD and ETB totals separate under 24 concurrent confirmations', async () => {
    const item = await plan(48);
    const orders = await Promise.all(Array.from({ length: 24 }, async (_, index) => {
      const currency = index % 2 ? 'ETB' : 'USD';
      const id = idOf(await database.mutate('create_order', quote([item.id], 2, currency), customer));
      return { id, currency, amount_minor: currency === 'USD' ? 998 : 170000 };
    }));
    const results = await wave('mixed-currency-confirmation', orders.map(order => () => database.mutate('confirm_payment', {
      ...order, reference: `stress-${order.id}`,
    }, owner)));
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(await stock(item.id)).toMatchObject({ capacity: 48, allocated: 48, available: 0 });
    const totals = await database.admin.query(`
      select currency, sum(amount_minor)::text as total from bren_private.bren_payments
      where order_id = any($1::uuid[]) group by currency order by currency
    `, [orders.map(order => order.id)]);
    expect(totals.rows).toEqual([{ currency: 'ETB', total: '2040000' }, { currency: 'USD', total: '11976' }]);
  });
});
