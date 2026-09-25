import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { orderDetailSchema, planSchema, resourceSchemas } from '../../src/features/contracts';
import type { Input, Resource } from '../../src/features/api';
import { startTestDatabase } from './database';

type TestDatabase = Awaited<ReturnType<typeof startTestDatabase>>;
let instance: TestDatabase | undefined;
let owner: string;
let customerA: string;
let customerB: string;
let support: string;
let manager: string;
let categoryId: string;
const idOf = (data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id;
const database = () => {
  if (!instance) throw new Error('The test database has not started.');
  return instance;
};

beforeAll(async () => {
  instance = await startTestDatabase();
  owner = await instance.createUser('Fixture Owner');
  customerA = await instance.createUser('Customer A');
  customerB = await instance.createUser('Customer B');
  support = await instance.createUser('Fixture Support');
  manager = await instance.createUser('Fixture Manager');
  await instance.admin.query('select bren_private.bootstrap_owner($1)', [owner]);
  await instance.registerStaff(support, 'support', owner);
  await instance.registerStaff(manager, 'manager', owner);
  categoryId = idOf(await instance.mutate('save_category', {
    name: 'Test category', slug: `test-${crypto.randomUUID()}`, sort_order: 0, archived: false,
  }, owner));
});

afterAll(async () => { if (instance) await instance.stop(); });

async function createPlan(capacity = 1, overrides: Input = {}) {
  const input: Input = {
    name: 'Test subscription', slug: `test-${crypto.randomUUID()}`, description: 'Shared subscription',
    category_id: categoryId, brand_key: 'netflix', initial: 'N',
    color_start: '#222222', color_end: '#111111', usd_minor: 499, etb_minor: 85000,
    usd_compare_minor: null, etb_compare_minor: null, billing_days: 30,
    status: 'active', featured: false, low_stock_threshold: 1, ...overrides,
  };
  const id = idOf(await database().mutate('save_plan', input, owner));
  await database().mutate('adjust_capacity', { plan_id: id, capacity, reason: 'Verified test capacity' }, owner);
  return { id, input };
}

function intent(items: { plan_id: string; qty: number; unit_minor: number }[], overrides: Input = {}): Input {
  return {
    idempotency_key: crypto.randomUUID(), currency: 'USD',
    name: 'Test customer', phone: '+251911234567', telegram: '@test_customer',
    items, ...overrides,
  };
}

async function detail(id: string, userId = owner) {
  return orderDetailSchema.parse(await database().read('order', { id }, userId));
}

async function catalog() {
  return z.array(planSchema).parse(await database().read('catalog', {}, null, 'anon'));
}

describe('real PostgreSQL transactional commerce', () => {
  it('persists independent prices and rejects unauthenticated order creation', async () => {
    const plan = await createPlan();
    const item = (await catalog()).find((row) => row.id === plan.id);
    expect(item?.usd_minor).toBe(499);
    expect(item?.etb_minor).toBe(85000);
    await expect(database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), null, 'anon')).rejects.toThrow();
  });

  it('publishes a custom plan using its initial without requiring a known brand logo', async () => {
    const plan = await createPlan(1, { brand_key: '', initial: 'C' });
    const item = (await catalog()).find((row) => row.id === plan.id);
    expect(item?.brand_key).toBe('');
    expect(item?.initial).toBe('C');
  });

  it('creates exactly one order for simultaneous retries and rejects key reuse for another payload', async () => {
    const plan = await createPlan(3);
    const payload = intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]);
    const [first, second] = await Promise.all([
      database().mutate('create_order', payload, customerA),
      database().mutate('create_order', payload, customerA),
    ]);
    expect(idOf(first)).toBe(idOf(second));
    await expect(database().mutate('create_order', { ...payload, name: 'Different person' }, customerA)).rejects.toThrow();
    expect((await detail(idOf(first), customerA)).order.total_minor).toBe(499);
  });

  it('allocates the final seat to exactly one of two simultaneous confirmations', async () => {
    const plan = await createPlan();
    const firstId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    const secondId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerB));
    const payments = [firstId, secondId].map((id) => ({ id, reference: `manual-${id}`, amount_minor: 499, currency: 'USD' }));
    const results = await Promise.allSettled(payments.map((input) => database().mutate('confirm_payment', input, owner)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    await database().mutate('confirm_payment', payments[winner], owner);
    const stock = (await catalog()).find((row) => row.id === plan.id);
    expect(stock?.available).toBe(0);
    expect(stock?.allocated).toBe(1);
    expect((await detail(payments[winner].id)).order.payment_status).toBe('confirmed');
    await expect(database().mutate('confirm_payment', { ...payments[winner], reference: 'conflicting-reference' }, owner)).rejects.toThrow();
    await expect(database().mutate('adjust_capacity', { plan_id: plan.id, capacity: 0, reason: 'Invalid reduction' }, owner)).rejects.toThrow();
  });

  it('preserves a three-seat order and reduces availability by three exactly once on confirmation', async () => {
    const plan = await createPlan(5);
    const firstId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 3, unit_minor: 499 }]), customerA));
    expect(orderId).not.toBe(firstId);
    expect((await detail(firstId)).items[0].qty).toBe(1);
    expect((await detail(orderId)).items[0].qty).toBe(3);
    expect((await detail(orderId)).order.total_minor).toBe(1497);
    expect((await catalog()).find((row) => row.id === plan.id)).toMatchObject({ capacity: 5, allocated: 0, available: 5 });
    const payment = { id: orderId, reference: `manual-${orderId}`, amount_minor: 1497, currency: 'USD' };
    await database().mutate('confirm_payment', payment, owner);
    expect((await catalog()).find((row) => row.id === plan.id)).toMatchObject({ capacity: 5, allocated: 3, available: 2 });
    await database().mutate('confirm_payment', payment, owner);
    expect((await catalog()).find((row) => row.id === plan.id)).toMatchObject({ capacity: 5, allocated: 3, available: 2 });
    const allocations = await database().admin.query('select qty from bren_private.bren_allocations where order_id = $1', [orderId]);
    expect(allocations.rows).toEqual([{ qty: 3 }]);
    expect((await detail(firstId)).order.payment_status).toBe('pending');
  });

  it('rolls back every allocation and payment when one line is out of stock', async () => {
    const available = await createPlan();
    const contested = await createPlan();
    const multiId = idOf(await database().mutate('create_order', intent([
      { plan_id: available.id, qty: 1, unit_minor: 499 },
      { plan_id: contested.id, qty: 1, unit_minor: 499 },
    ]), customerA));
    const rivalId = idOf(await database().mutate('create_order', intent([{ plan_id: contested.id, qty: 1, unit_minor: 499 }]), customerB));
    await database().mutate('confirm_payment', { id: rivalId, reference: `manual-${rivalId}`, amount_minor: 499, currency: 'USD' }, owner);
    await expect(database().mutate('confirm_payment', { id: multiId, reference: `manual-${multiId}`, amount_minor: 998, currency: 'USD' }, owner)).rejects.toThrow();
    expect((await catalog()).find((row) => row.id === available.id)?.available).toBe(1);
    expect((await detail(multiId)).order.status).toBe('pending');
    expect((await detail(multiId)).payment).toBeNull();
  });

  it('retains accepted prices and rejects stale quotes for new orders', async () => {
    const plan = await createPlan(3);
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    await database().mutate('save_plan', { ...plan.input, id: plan.id, usd_minor: 599 }, owner);
    expect((await detail(orderId)).items[0].unit_minor).toBe(499);
    await expect(database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA)).rejects.toThrow();
    await database().mutate('confirm_payment', { id: orderId, reference: `manual-${orderId}`, amount_minor: 499, currency: 'USD' }, owner);
    expect((await detail(orderId)).payment?.amount_minor).toBe(499);
  });

  it('enforces customer isolation and keeps internal notes private', async () => {
    const plan = await createPlan();
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    await expect(database().read('order', { id: orderId }, customerB)).rejects.toThrow();
    await database().mutate('add_order_note', { id: orderId, note: 'Staff-only follow-up detail' }, support);
    expect((await detail(orderId, support)).events.some((event) => event.note.includes('Staff-only'))).toBe(true);
    expect((await detail(orderId, customerA)).events.some((event) => event.note.includes('Staff-only'))).toBe(false);
    await expect(database().mutate('confirm_payment', { id: orderId, reference: 'bad-support', amount_minor: 499, currency: 'USD' }, support)).rejects.toThrow();
    await expect(database().mutate('save_plan', plan.input, support)).rejects.toThrow();
    await expect(database().read('team', {}, manager)).rejects.toThrow();
    const dashboard = z.object({ confirmed_usd_minor: z.null(), confirmed_etb_minor: z.null() }).parse(
      await database().read('dashboard', {}, support),
    );
    expect(dashboard.confirmed_usd_minor).toBeNull();
  });

  it('releases a seat once without changing the recorded payment', async () => {
    const plan = await createPlan();
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    await database().mutate('confirm_payment', { id: orderId, reference: `manual-${orderId}`, amount_minor: 499, currency: 'USD' }, owner);
    const allocations = z.object({ rows: z.array(z.object({ id: z.string(), order_id: z.string() })) }).parse(
      await database().read('allocations', { plan_id: plan.id }, owner),
    );
    const allocation = allocations.rows.find((row) => row.order_id === orderId);
    expect(allocation).toBeDefined();
    if (!allocation) throw new Error('Confirmed order has no allocation.');
    await database().mutate('release_allocation', { id: allocation.id, reason: 'Access removed after the service term' }, owner);
    const repeat = database().mutate('release_allocation', { id: allocation.id, reason: 'Access removed after the service term' }, owner);
    await repeat.then(() => undefined, (error: unknown) => expect(error).toBeInstanceOf(Error));
    expect((await catalog()).find((row) => row.id === plan.id)?.available).toBe(1);
    expect((await detail(orderId)).order.payment_status).toBe('confirmed');
  });

  it('protects the final owner and immediately rejects suspended staff', async () => {
    await expect(database().mutate('update_staff', { id: owner, role: 'manager', active: true }, owner)).rejects.toThrow();
    await database().mutate('update_staff', { id: support, role: 'support', active: false }, owner);
    expect(await database().role(support)).toBeNull();
    await expect(database().read('orders', {}, support)).rejects.toThrow();
  });

  it('does not oversell when a capacity reduction races a confirmation', async () => {
    const plan = await createPlan();
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    const results = await Promise.allSettled([
      database().mutate('confirm_payment', { id: orderId, reference: `manual-${orderId}`, amount_minor: 499, currency: 'USD' }, owner),
      database().mutate('adjust_capacity', { plan_id: plan.id, capacity: 0, reason: 'Capacity no longer available' }, owner),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stock = (await catalog()).find((row) => row.id === plan.id);
    expect(stock?.available).toBe(0);
    expect(stock?.capacity).toBe(stock?.allocated);
  });

  it('rejects invalid quantities, prices, and unsupported currencies at the database boundary', async () => {
    const plan = await createPlan(20);
    for (const qty of [0, -1, 1.5, 10]) {
      await expect(database().mutate('create_order', intent([{ plan_id: plan.id, qty, unit_minor: 499 }]), customerA)).rejects.toThrow();
    }
    await expect(database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: -499 }]), customerA)).rejects.toThrow();
    await expect(database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }], { currency: 'EUR' }), customerA)).rejects.toThrow();
    await expect(database().mutate('save_plan', { ...plan.input, id: plan.id, usd_minor: 4.99 }, owner)).rejects.toThrow();
    await expect(database().mutate('save_plan', { ...plan.input, id: plan.id, etb_minor: 0 }, owner)).rejects.toThrow();
  });

  it('keeps every application table RLS-enabled and inaccessible to direct customer writes', async () => {
    const tables = await database().admin.query<{ name: string; protected: boolean }>(`
      select c.relname as name, c.relrowsecurity as protected
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bren_private' and c.relkind='r'
    `);
    expect(tables.rows.length).toBeGreaterThan(5);
    expect(tables.rows.every((row) => row.protected)).toBe(true);
    for (const table of tables.rows) {
      const privileges = await database().admin.query<{ can_insert: boolean; can_update: boolean; can_delete: boolean }>(
        `select has_table_privilege('authenticated', format('bren_private.%I', $1::text), 'INSERT') as can_insert,
          has_table_privilege('authenticated', format('bren_private.%I', $1::text), 'UPDATE') as can_update,
          has_table_privilege('authenticated', format('bren_private.%I', $1::text), 'DELETE') as can_delete`, [table.name],
      );
      expect(privileges.rows[0]).toEqual({ can_insert: false, can_update: false, can_delete: false });
    }
  });

  it('returns the exact runtime contracts required by every UI resource', async () => {
    const plan = await createPlan();
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    const publicResources: Resource[] = ['catalog', 'public_categories', 'public_settings'];
    for (const resource of publicResources) {
      resourceSchemas[resource].parse(await database().read(resource, {}, null, 'anon'));
    }
    for (const resource of ['profile', 'my_orders', 'payment_instructions'] as const) {
      resourceSchemas[resource].parse(await database().read(resource, {}, customerA));
    }
    for (const resource of ['plans', 'categories', 'inventory', 'orders', 'customers', 'allocations', 'movements', 'dashboard'] as const) {
      resourceSchemas[resource].parse(await database().read(resource, {}, manager));
    }
    for (const resource of ['team', 'settings', 'activity'] as const) {
      resourceSchemas[resource].parse(await database().read(resource, {}, owner));
    }
    resourceSchemas.order.parse(await database().read('order', { id: orderId }, customerA));
    resourceSchemas.customer.parse(await database().read('customer', { id: customerA }, owner));
  });

  it('keeps payment, fulfillment and unpaid cancellation separate', async () => {
    const plan = await createPlan();
    const orderId = idOf(await database().mutate('create_order', intent([{ plan_id: plan.id, qty: 1, unit_minor: 499 }]), customerA));
    expect((await catalog()).find((row) => row.id === plan.id)?.available).toBe(1);
    await expect(database().mutate('fulfill_order', { id: orderId, note: 'Too early' }, owner)).rejects.toThrow();
    await expect(database().mutate('confirm_payment', { id: orderId, reference: 'wrong-amount', amount_minor: 498, currency: 'USD' }, owner)).rejects.toThrow();
    await expect(database().mutate('confirm_payment', { id: orderId, reference: 'wrong-currency', amount_minor: 499, currency: 'ETB' }, owner)).rejects.toThrow();
    expect((await catalog()).find((row) => row.id === plan.id)?.allocated).toBe(0);
    await database().mutate('confirm_payment', { id: orderId, reference: `manual-${orderId}`, amount_minor: 499, currency: 'USD' }, owner);
    await expect(database().mutate('cancel_order', { id: orderId, note: 'Do not undo a paid order' }, owner)).rejects.toThrow();
    await database().mutate('fulfill_order', { id: orderId, note: 'Access delivered manually' }, owner);
    expect((await detail(orderId)).order.status).toBe('fulfilled');
    expect((await catalog()).find((row) => row.id === plan.id)?.allocated).toBe(1);
  });

  it('retains an active Owner when two Owners attempt concurrent self-demotion', async () => {
    const secondOwner = await database().createUser('Second owner');
    await database().registerStaff(secondOwner, 'owner', owner);
    const results = await Promise.allSettled([
      database().mutate('update_staff', { id: owner, role: 'manager', active: true }, owner),
      database().mutate('update_staff', { id: secondOwner, role: 'manager', active: true }, secondOwner),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const roles = await Promise.all([database().role(owner), database().role(secondOwner)]);
    expect(roles.filter((role) => role === 'owner')).toHaveLength(1);
  });

  it('keeps invitation helpers server-only and refuses grants by non-owners', async () => {
    const checks = await database().admin.query<{ exposed: boolean; bootstrap_exposed: boolean }>(`
      select
        has_function_privilege('anon', 'public.bren_register_staff(uuid,text,uuid)', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.bren_register_staff(uuid,text,uuid)', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.bren_staff_lookup_email(text)', 'EXECUTE') as exposed,
        has_function_privilege('service_role', 'bren_private.bootstrap_owner(uuid)', 'EXECUTE') as bootstrap_exposed
    `);
    expect(checks.rows[0]).toEqual({ exposed: false, bootstrap_exposed: false });
    await expect(database().registerStaff(customerB, 'owner', manager)).rejects.toThrow();
    expect(await database().role(customerB)).toBeNull();
  });
});
