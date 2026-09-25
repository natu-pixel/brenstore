import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseError, getMyRole, inviteStaff, readResource, runCommand } from './api';

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../supabase', () => ({
  supabase: { rpc, functions: { invoke } },
}));

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); });

describe('typed database boundary', () => {
  it('allows a truly empty catalog without inserting demo plans', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await readResource('catalog')).toEqual([]);
    expect(rpc).toHaveBeenCalledWith('bren_read', { resource: 'catalog', args: {} });
  });
  it('surfaces database errors rather than returning an empty success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Permission denied.' } });
    await expect(readResource('orders')).rejects.toThrow('Permission denied.');
  });
  it('rejects malformed aggregate responses', async () => {
    rpc.mockResolvedValue({ data: { pending_orders: 1 }, error: null });
    await expect(readResource('dashboard')).rejects.toThrow();
  });
  it('retains valid absent customer roles without granting access', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getMyRole()).toBeNull();
    rpc.mockResolvedValue({ data: 'admin', error: null });
    await expect(getMyRole()).rejects.toThrow();
  });
  it('reports failed writes', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Insufficient available seats.' } });
    await expect(runCommand('confirm_payment', { id: 'order' })).rejects.toThrow('Insufficient available seats.');
  });
  it('preserves the database code needed to distinguish rejected checkout from an ambiguous retry', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'The quote has changed.' } });
    await expect(runCommand('create_order', {})).rejects.toEqual(new DatabaseError('The quote has changed.', '23514'));
    await expect(runCommand('create_order', {})).rejects.toHaveProperty('code', '23514');
  });
  it('preserves actionable invitation failures', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify({ message: 'Only an active Owner can invite staff.' }), { status: 403 }),
      },
    });
    await expect(inviteStaff('staff@example.test', 'manager')).rejects.toThrow('Only an active Owner');
  });
});
