import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resourceSchemas } from '../../src/features/contracts';
import { startTestDatabase } from './database';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let owner: string;
let manager: string;
let customer: string;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = await db.createUser('Owner');
  manager = await db.createUser('Manager');
  customer = await db.createUser('Customer');
  await db.admin.query('select bren_private.bootstrap_owner($1)', [owner]);
  await db.admin.query('update auth.users set last_sign_in_at = now() where id = any($1)', [[owner, manager]]);
  await db.registerStaff(manager, 'manager', owner);
});
afterAll(async () => { if (db) await db.stop(); });

const emailOf = async (id: string) => (await db.admin.query('select email from auth.users where id = $1', [id])).rows[0]?.email as string | undefined;
const exists = async (table: string, id: string) =>
  (await db.admin.query(`select 1 from ${table} where id = $1`, [id])).rowCount === 1;
async function invite(role = 'support') {
  const id = await db.createUser('Invitee');
  await db.registerStaff(id, role, owner);
  return id;
}

describe('removing team members', () => {
  it('lists unaccepted invitations as pending', async () => {
    const pending = await invite();
    const team = resourceSchemas.team.parse(await db.read('team', { page_size: 100 }, owner)).rows;
    expect(team.find(row => row.id === pending)?.pending).toBe(true);
    expect(team.find(row => row.id === manager)?.pending).toBe(false);
  });

  it('cancels a pending invitation by deleting the unused account, with an audit entry', async () => {
    const pending = await invite();
    const email = await emailOf(pending);
    expect(await db.mutate('remove_staff', { id: pending, email }, owner)).toEqual({ id: pending, account_deleted: true });
    for (const table of ['bren_private.bren_staff', 'bren_private.bren_profiles', 'auth.users']) expect(await exists(table, pending)).toBe(false);
    const audit = await db.admin.query("select summary from bren_private.bren_activity where action = 'remove_staff' and entity_id = $1", [pending]);
    expect(audit.rows).toEqual([{ summary: `Removed support ${email}; pending invitation cancelled` }]);
    await expect(db.mutate('remove_staff', { id: pending }, owner)).rejects.toThrow('Team member not found');
  });

  it('keeps an accepted member as a customer account and revokes administration immediately', async () => {
    const accepted = await invite('manager');
    await db.admin.query('update auth.users set last_sign_in_at = now() where id = $1', [accepted]);
    expect(await db.mutate('remove_staff', { id: accepted }, owner)).toEqual({ id: accepted, account_deleted: false });
    expect(await exists('bren_private.bren_staff', accepted)).toBe(false);
    expect(await exists('auth.users', accepted)).toBe(true);
    expect(await db.role(accepted)).toBeNull();
    await expect(db.read('orders', {}, accepted)).rejects.toThrow();
    expect(await db.read('profile', {}, accepted)).toMatchObject({ id: accepted });
  });

  it('keeps a pending account that already has store history', async () => {
    const pending = await invite();
    await db.admin.query("insert into bren_private.bren_activity (action, actor_id, summary) values ('fixture', $1, 'history')", [pending]);
    expect(await db.mutate('remove_staff', { id: pending }, owner)).toEqual({ id: pending, account_deleted: false });
    expect(await exists('bren_private.bren_staff', pending)).toBe(false);
    expect(await exists('auth.users', pending)).toBe(true);
  });

  it('allows the email to be invited again after cancelling', async () => {
    const pending = await invite();
    const email = await emailOf(pending);
    await db.mutate('remove_staff', { id: pending }, owner);
    const found = await db.admin.query('select id from auth.users where lower(email) = lower($1)', [email]);
    expect(found.rowCount).toBe(0);
  });

  it('restricts removal to owners and protects self-removal, stale rows and the last owner', async () => {
    const target = await invite();
    for (const actor of [manager, customer]) await expect(db.mutate('remove_staff', { id: target }, actor)).rejects.toThrow();
    await expect(db.mutate('remove_staff', { id: target }, null, 'anon')).rejects.toThrow();
    await expect(db.mutate('remove_staff', { id: owner }, owner)).rejects.toThrow('cannot remove yourself');
    await expect(db.mutate('remove_staff', { id: target, email: 'someone-else@example.test' }, owner)).rejects.toThrow('changed');
    await expect(db.mutate('remove_staff', { id: target, extra: true }, owner)).rejects.toThrow();
    await expect(db.mutate('remove_staff', { id: crypto.randomUUID() }, owner)).rejects.toThrow('not found');
    expect(await exists('bren_private.bren_staff', target)).toBe(true);

    // Only an active owner can remove, and never themselves, so at least one active owner always remains.
    const second = await invite('owner');
    await db.admin.query('update auth.users set last_sign_in_at = now() where id = $1', [second]);
    await db.mutate('update_staff', { id: owner, role: 'owner', active: false }, second);
    await expect(db.mutate('remove_staff', { id: second }, owner)).rejects.toThrow('Permission denied');
    await db.mutate('update_staff', { id: owner, role: 'owner', active: true }, second);
    expect(await db.mutate('remove_staff', { id: second }, owner)).toEqual({ id: second, account_deleted: false });
    expect(await db.role(owner)).toBe('owner');
  });

  it('leaves other commands and the private dispatchers unchanged', async () => {
    const privileges = await db.admin.query(`select
      has_function_privilege('authenticated', 'bren_private.bren_mutate_details(text,jsonb)', 'execute') as mutate,
      has_function_privilege('anon', 'bren_private.bren_read_details(text,jsonb)', 'execute') as read`);
    expect(privileges.rows).toEqual([{ mutate: false, read: false }]);
    expect(resourceSchemas.catalog.parse(await db.read('catalog', {}, null, 'anon'))).toEqual([]);
    await expect(db.read('team', {}, manager)).rejects.toThrow();
  });
});
