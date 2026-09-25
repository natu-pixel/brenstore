import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createTestAccount, localAdmin, localStatus } from '../local-supabase';
import { customerSchema, planSchema } from '../../src/features/contracts';

let customer: Awaited<ReturnType<typeof createTestAccount>> | undefined;

beforeAll(async () => { customer = await createTestAccount('auth-contract'); });
afterAll(async () => {
  if (customer) {
    const { error } = await localAdmin().auth.admin.deleteUser(customer.id);
    if (error) throw new Error(`Could not clean up the exact integration fixture account: ${error.message}`);
  }
});

it('connects Auth identity to a persisted profile and never grants staff on signup', async () => {
  if (!customer) throw new Error('The local Auth fixture was not created.');
  const profile = await customer.client.rpc('bren_read', { resource: 'profile', args: {} });
  expect(profile.error).toBeNull();
  expect(customerSchema.parse(profile.data).id).toBe(customer.id);
  const role = await customer.client.rpc('bren_my_role');
  expect(role.error).toBeNull();
  expect(role.data).toBeNull();
  const denied = await customer.client.rpc('bren_read', { resource: 'team', args: {} });
  expect(denied.error).not.toBeNull();
});

it('exposes only the public catalog to an anonymous REST client', async () => {
  const status = localStatus();
  const anonymous = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const catalog = await anonymous.rpc('bren_read', { resource: 'catalog', args: {} });
  expect(catalog.error).toBeNull();
  expect(z.array(planSchema).parse(catalog.data).every((plan) => plan.status === 'active')).toBe(true);
  const denied = await anonymous.rpc('bren_read', { resource: 'customers', args: {} });
  expect(denied.error).not.toBeNull();
});
