import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { orderDetailSchema, resourceSchemas } from '../../src/features/contracts';
import type { Input } from '../../src/features/contracts';
import { startTestDatabase } from './database';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let owner: string;
let customer: string;
let support: string;
let category: string;
const legacyIds = Array.from({ length: 6 }, () => crypto.randomUUID());
const idOf = (data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id;
beforeAll(async () => {
  db = await startTestDatabase({ beforeMigration: async (name, client) => {
    if (name !== '20261002000100_bren_services.sql') return;
    const categoryId = crypto.randomUUID();
    await client.query("insert into bren_private.bren_categories(id,name,slug) values ($1,'Legacy','legacy')", [categoryId]);
    for (const [index, row] of [
      ['Netflix - 1 user', 'netflix'], ['Netflix - On mail', 'netflix'], ['Netflix', 'netflix'],
      ['HBO Max - 1 user', 'hbo'], ['HBO Max - 1 user', 'hbo'], ['Custom option', 'custom'],
    ].entries()) {
      await client.query(`insert into bren_private.bren_plans
        (id,name,slug,description,category_id,brand_key,initial,color_start,color_end,usd_minor,etb_minor,billing_days,status,capacity)
        values ($1,$2,$3,'on mail 5 users',$4,$5,'X','#111111','#222222',499,85000,30,'active',7)`,
      [legacyIds[index], row[0], `legacy-${index}`, categoryId, row[1]]);
    }
  } });
  owner = await db.createUser('Owner');
  customer = await db.createUser('Customer');
  support = await db.createUser('Support');
  await db.admin.query('select bren_private.bootstrap_owner($1)', [owner]);
  await db.registerStaff(support, 'support', owner);
  category = idOf(await db.mutate('save_category', { name: 'Streaming', slug: 'streaming', sort_order: 0, archived: false }, owner));
});
afterAll(async () => { if (db) await db.stop(); });

async function service() {
  const input = { category_id: category, name: 'Netflix', slug: `netflix-${crypto.randomUUID()}`,
    brand_key: 'netflix', initial: 'N', color_start: '#111111', color_end: '#222222' };
  return { input, id: idOf(await db.mutate('save_service', input, owner)) };
}
function planInput(serviceId?: string): Input {
  return {
    name: 'Any display name', slug: `option-${crypto.randomUUID()}`, description: 'Not a relationship',
    category_id: category, brand_key: 'custom', initial: 'X', color_start: '#111111', color_end: '#222222',
    usd_minor: 499, etb_minor: 85000, usd_compare_minor: null, etb_compare_minor: null,
    billing_days: 30, status: 'active', featured: false, low_stock_threshold: 1,
    kind: 'seat', provider_package_id: null,
    ...(serviceId ? { service_id: serviceId, option_code: 'single_user', users_included: 1 } : {}),
  };
}
describe('service relationships', () => {
  it('deletes unused options with an audit entry while retaining the service and siblings', async () => {
    const s = await service();
    const input = planInput(s.id);
    const id = idOf(await db.mutate('save_plan', input, owner));
    const sibling = idOf(await db.mutate('save_plan', { ...input, slug: `sibling-${crypto.randomUUID()}`, option_code: 'on_mail', users_included: 5 }, owner));
    expect(idOf(await db.mutate('delete_plan', { id, name: input.name, note: 'Unused offer' }, owner))).toBe(id);
    const remaining = resourceSchemas.plans.parse(await db.read('plans', { service_id: s.id }, owner));
    expect(remaining.rows.map(row => row.id)).toEqual([sibling]);
    expect(resourceSchemas.services.parse(await db.read('services', { id: s.id }, owner)).total).toBe(1);
    expect(resourceSchemas.catalog.parse(await db.read('catalog', {}, null, 'anon')).some(row => row.id === id)).toBe(false);
    const audit = await db.admin.query('select action, summary from bren_private.bren_activity where entity_id = $1 and action = $2', [id, 'delete_plan']);
    expect(audit.rows).toEqual([{ action: 'delete_plan', summary: 'Deleted plan Any display name: Unused offer' }]);
    await expect(db.mutate('delete_plan', { id, name: input.name, note: 'Retry' }, owner)).rejects.toThrow('Plan not found');
    await db.mutate('save_plan', input, owner);
  });

  it('validates deletion permissions, confirmation identity and staff reason', async () => {
    const input = planInput();
    const id = idOf(await db.mutate('save_plan', input, owner));
    const deletion = { id, name: input.name, note: 'Unused draft' };
    for (const actor of [customer, support]) await expect(db.mutate('delete_plan', deletion, actor)).rejects.toThrow();
    await expect(db.mutate('delete_plan', deletion, null, 'anon')).rejects.toThrow();
    await expect(db.mutate('delete_plan', { ...deletion, name: 'Wrong plan name' }, owner)).rejects.toThrow('renamed');
    await expect(db.mutate('delete_plan', { ...deletion, note: ' ' }, owner)).rejects.toThrow();
    await expect(db.mutate('delete_plan', { ...deletion, unexpected: true }, owner)).rejects.toThrow();
    expect(resourceSchemas.plans.parse(await db.read('plans', { plan_id: id }, owner)).total).toBe(1);
    const manager = await db.createUser('Deleting manager');
    await db.registerStaff(manager, 'manager', owner);
    await db.mutate('delete_plan', deletion, manager);
    expect(resourceSchemas.plans.parse(await db.read('plans', { plan_id: id }, owner)).total).toBe(0);
  });

  it('protects stock and inventory history even after capacity returns to zero', async () => {
    const input = planInput();
    const id = idOf(await db.mutate('save_plan', input, owner));
    const deletion = { id, name: input.name, note: 'Remove offer' };
    await db.mutate('adjust_capacity', { plan_id: id, capacity: 2, reason: 'Stock received' }, owner);
    await expect(db.mutate('delete_plan', deletion, owner)).rejects.toThrow('cannot be deleted');
    await db.mutate('adjust_capacity', { plan_id: id, capacity: 0, reason: 'Stock withdrawn' }, owner);
    await expect(db.mutate('delete_plan', deletion, owner)).rejects.toThrow('Archived');
    const history = await db.admin.query('select count(*)::int as count from bren_private.bren_movements where plan_id = $1', [id]);
    expect(history.rows[0].count).toBe(2);
    await db.mutate('save_plan', { ...input, id, status: 'archived' }, owner);
    expect(resourceSchemas.plans.parse(await db.read('plans', { plan_id: id }, owner)).rows[0].status).toBe('archived');
  });

  it('preserves pending top-up order snapshots when deletion is rejected', async () => {
    const input = { ...planInput(), kind: 'topup', provider_package_id: '6' };
    const id = idOf(await db.mutate('save_plan', input, owner));
    const order = idOf(await db.mutate('create_order', {
      idempotency_key: crypto.randomUUID(), currency: 'USD', name: 'Customer', phone: '12345', telegram: '',
      items: [{ plan_id: id, qty: 1, unit_minor: 499, player_id: '123456789' }],
    }, customer));
    const before = orderDetailSchema.parse(await db.read('order', { id: order }, customer));
    await expect(db.mutate('delete_plan', { id, name: input.name, note: 'Remove offer' }, owner)).rejects.toThrow('cannot be deleted');
    expect(orderDetailSchema.parse(await db.read('order', { id: order }, customer))).toEqual(before);
  });

  it('audits exactly one deletion for concurrent requests', async () => {
    const input = planInput();
    const id = idOf(await db.mutate('save_plan', input, owner));
    const deletion = { id, name: input.name, note: 'Unused offer' };
    const results = await Promise.allSettled([db.mutate('delete_plan', deletion, owner), db.mutate('delete_plan', deletion, owner)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const audit = await db.admin.query("select count(*)::int as count from bren_private.bren_activity where entity_id = $1 and action = 'delete_plan'", [id]);
    expect(audit.rows[0].count).toBe(1);
  });

  it('upgrades existing named options without guessing descriptions, duplicates or package counts', async () => {
    const rows = resourceSchemas.catalog.parse(await db.read('catalog', {}, null, 'anon'));
    const legacy = legacyIds.map(id => rows.find(row => row.id === id));
    expect(legacy[0]).toMatchObject({ id: legacyIds[0], option_code: 'single_user', users_included: 1, capacity: 7, usd_minor: 499 });
    expect(legacy[1]).toMatchObject({ option_code: 'on_mail', users_included: null });
    expect(legacy[0]?.service_id).toBe(legacy[1]?.service_id);
    expect(legacy[2]).toMatchObject({ option_code: null, users_included: null });
    expect(legacy[3]).toMatchObject({ option_code: null });
    expect(legacy[4]).toMatchObject({ option_code: null });
    expect(legacy[5]).toMatchObject({ service_id: null, option_code: null });
  });
  it('uses explicit IDs/options, enforces category and term uniqueness, and permits separate terms', async () => {
    const s = await service();
    const input = planInput(s.id);
    const id = idOf(await db.mutate('save_plan', input, owner));
    const plans = resourceSchemas.plans.parse(await db.read('plans', { service_id: s.id }, owner));
    expect(plans.rows).toEqual([expect.objectContaining({ id, service_id: s.id, option_code: 'single_user', brand_key: 'netflix' })]);
    await expect(db.mutate('save_plan', { ...input, slug: `duplicate-${crypto.randomUUID()}` }, owner)).rejects.toThrow('already has that option');
    await db.mutate('save_plan', { ...input, slug: `year-${crypto.randomUUID()}`, billing_days: 365 }, owner);
    await expect(db.mutate('save_plan', { ...input, id, category_id: null }, owner)).rejects.toThrow('selected category');
    await expect(db.mutate('save_plan', { ...input, id, users_included: 5 }, owner)).rejects.toThrow('users included');
    await expect(db.mutate('save_plan', { ...input, id, kind: 'topup', provider_package_id: '6' }, owner)).rejects.toThrow('top-ups');
    await expect(db.mutate('save_plan', { ...input, id, service_id: null }, owner)).rejects.toThrow('Choose a service');
    const after = resourceSchemas.plans.parse(await db.read('plans', { plan_id: id }, owner)).rows[0];
    expect(after).toMatchObject({ id, service_id: s.id, users_included: 1 });
  });

  it('keeps legacy IDs and older-client relationships and snapshots package size without multiplying quantity', async () => {
    const legacy = planInput();
    const id = idOf(await db.mutate('save_plan', { ...legacy, name: 'Netflix', description: 'on mail 5 users' }, owner));
    await db.mutate('adjust_capacity', { plan_id: id, capacity: 3, reason: 'Three packages' }, owner);
    const intent = () => ({ idempotency_key: crypto.randomUUID(), currency: 'USD', name: 'Customer', phone: '12345',
      telegram: '', items: [{ plan_id: id, qty: 1, unit_minor: 499 }] });
    const oldOrder = idOf(await db.mutate('create_order', intent(), customer));
    const before = orderDetailSchema.parse(await db.read('order', { id: oldOrder }, customer));
    const s = await service();
    await db.mutate('save_plan', { ...legacy, id, service_id: s.id, option_code: 'on_mail', users_included: 5 }, owner);
    await db.mutate('save_plan', { ...legacy, id, name: 'Renamed freely' }, owner);
    const linked = resourceSchemas.plans.parse(await db.read('plans', { plan_id: id }, owner)).rows[0];
    expect(linked).toMatchObject({ id, service_id: s.id, option_code: 'on_mail', users_included: 5, capacity: 3 });
    expect(orderDetailSchema.parse(await db.read('order', { id: oldOrder }, customer))).toEqual(before);
    const order = idOf(await db.mutate('create_order', intent(), customer));
    const snapshot = orderDetailSchema.parse(await db.read('order', { id: order }, customer));
    expect(snapshot.items[0]).toMatchObject({ plan_id: id, qty: 1, option_code: 'on_mail', users_included: 5, service_name: 'Netflix' });
    await db.mutate('confirm_payment', { id: order, reference: `pay-${order}`, amount_minor: 499, currency: 'USD' }, owner);
    expect(resourceSchemas.plans.parse(await db.read('plans', { plan_id: id }, owner)).rows[0]).toMatchObject({ allocated: 1, available: 2 });
    await db.mutate('save_service', { ...s.input, id: s.id, name: 'Renamed service' }, owner);
    await db.mutate('save_plan', { ...legacy, id, service_id: s.id, option_code: 'on_mail', users_included: 4 }, owner);
    expect(orderDetailSchema.parse(await db.read('order', { id: order }, customer)).items).toEqual(snapshot.items);
    await expect(db.read('order', { id: order }, null, 'anon')).rejects.toThrow();
    const outsider = await db.createUser('Other customer');
    await expect(db.read('order', { id: order }, outsider)).rejects.toThrow();
  });

  it('keeps new management and private dispatchers inaccessible to customers and support', async () => {
    const s = await service();
    for (const actor of [customer, support]) {
      await expect(db.read('services', {}, actor)).rejects.toThrow();
      await expect(db.read('plans', { service_id: s.id }, actor)).rejects.toThrow();
      await expect(db.mutate('save_service', s.input, actor)).rejects.toThrow();
      await expect(db.mutate('save_plan', planInput(s.id), actor)).rejects.toThrow();
    }
    await expect(db.read('services', {}, null, 'anon')).rejects.toThrow();
    const privileges = await db.admin.query(`select
      has_function_privilege('authenticated', 'bren_private.bren_mutate_core(text,jsonb)', 'execute') as mutate,
      has_function_privilege('anon', 'bren_private.bren_read_core(text,jsonb)', 'execute') as read,
      has_table_privilege('authenticated', 'bren_private.bren_services', 'insert') as write`);
    expect(privileges.rows).toEqual([{ mutate: false, read: false, write: false }]);
  });

  it('serializes concurrent duplicate options without leaving partial plans', async () => {
    const s = await service();
    const inputs = [planInput(s.id), planInput(s.id)];
    const results = await Promise.allSettled(inputs.map(input => db.mutate('save_plan', input, owner)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(resourceSchemas.plans.parse(await db.read('plans', { service_id: s.id }, owner)).total).toBe(1);
  });
});
