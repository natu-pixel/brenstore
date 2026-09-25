import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase, supabaseConfigurationError } from '../supabase';
import { DatabaseError, resourceSchemas, roleSchema, topupPackageSchema, topupProcessSchema } from './contracts';
import type { Action, Input, Resource, ResourceData, Role, TopupPackage, TopupProcessResult } from './contracts';
export * from './contracts';

export function client() {
  if (!supabase) throw new Error(supabaseConfigurationError ?? 'Supabase is not configured. Contact the store administrator.');
  return supabase;
}

export async function readResource<R extends Resource>(resource: R, args: Input = {}): Promise<ResourceData[R]> {
  const { data, error } = await client().rpc('bren_read', { resource, args });
  if (error) throw new DatabaseError(error.message, error.code);
  return resourceSchemas[resource].parse(data) as ResourceData[R];
}

export async function runCommand(action: Action, input: Input = {}) {
  const { data, error } = await client().rpc('bren_mutate', { action, input });
  if (error) throw new DatabaseError(error.message, error.code);
  return z.object({ id: z.string().optional() }).parse(data);
}

export async function getMyRole(): Promise<Role | null> {
  const { data, error } = await client().rpc('bren_my_role');
  if (error) throw new DatabaseError(error.message, error.code);
  return roleSchema.nullable().parse(data);
}

export function useResource<R extends Resource>(resource: R, args: Input = {}, enabled = true) {
  return useQuery({
    queryKey: ['bren', resource, args],
    queryFn: () => readResource(resource, args),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
}

export function useCommand() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ action, input }: { action: Action; input: Input }) => runCommand(action, input),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['bren'] }),
  });
}

async function rethrowFunctionError(error: unknown): Promise<never> {
  if (error && typeof error === 'object' && 'context' in error && error.context instanceof Response) {
    const body: unknown = await error.context.json();
    const detail = z.object({ message: z.string() }).safeParse(body);
    if (detail.success) throw new Error(detail.data.message);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export async function inviteStaff(email: string, role: Role) {
  const { data, error } = await client().functions.invoke('bren-invite', { body: { email, role } });
  if (error) await rethrowFunctionError(error);
  return z.object({ id: z.string() }).parse(data);
}

export async function fetchTopupPackages(): Promise<TopupPackage[]> {
  const { data, error } = await client().functions.invoke('bren-topup', { body: { op: 'packages' } });
  if (error) await rethrowFunctionError(error);
  return z.object({ packages: z.array(topupPackageSchema) }).parse(data).packages;
}

export async function processTopupDeliveries(orderId: string, retryFailed = false): Promise<TopupProcessResult> {
  const { data, error } = await client().functions.invoke('bren-topup', {
    body: { op: 'process', order_id: orderId, retry_failed: retryFailed },
  });
  if (error) await rethrowFunctionError(error);
  return topupProcessSchema.parse(data);
}
