import { mkdtemp, readFile, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import type { Input } from '../../src/features/api';

type DatabaseRole = 'anon' | 'authenticated' | 'service_role';

export async function startTestDatabase() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a database test port.');
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()));
  const directory = await mkdtemp(join(tmpdir(), 'brenstore-pg-test-'));
  const password = crypto.randomUUID();
  const server = new EmbeddedPostgres({
    databaseDir: join(directory, 'data'), user: 'postgres', password, port,
    persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => undefined,
    onError: (message) => console.error(message),
  });
  await server.initialise();
  await server.start();
  const connection = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', connectionTimeoutMillis: 5000 };
  const admin = new Client(connection);
  await admin.connect();
  try {
    // Database-contract fixtures only: this is not a substitute for Supabase Auth integration.
    await admin.query(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema extensions;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        email_confirmed_at timestamptz,
        invited_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
      $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
      $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
    `);
    const migrations = (await readdir(resolve('supabase', 'migrations'))).filter((name) => name.endsWith('.sql')).sort();
    if (!migrations.length) throw new Error('No database migration exists to validate.');
    for (const migration of migrations) {
      await admin.query(await readFile(resolve('supabase', 'migrations', migration), 'utf8'));
    }
  } catch (error) {
    await admin.end();
    await server.stop();
    await rmdir(directory);
    throw error;
  }

  type CallableFunction = 'bren_read' | 'bren_mutate' | 'bren_my_role' | 'bren_register_staff'
    | 'bren_topup_pending' | 'bren_topup_started' | 'bren_topup_finished';

  async function call(
    functionName: CallableFunction,
    parameters: unknown[], role: DatabaseRole, userId: string | null,
  ): Promise<unknown> {
    const client = new Client(connection);
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role, ...(userId ? { sub: userId } : {}) }),
      ]);
      const args = parameters.map((_, index) => `$${index + 1}`).join(', ');
      const result = await client.query<{ result: unknown }>(
        `select public.${functionName}(${args}) as result`, parameters,
      );
      await client.query('commit');
      return result.rows[0].result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      await client.end();
    }
  }

  return {
    admin,
    read: (resource: string, args: Input, userId: string | null, role: DatabaseRole = 'authenticated') =>
      call('bren_read', [resource, args], role, userId),
    mutate: (action: string, input: Input, userId: string | null, role: DatabaseRole = 'authenticated') =>
      call('bren_mutate', [action, input], role, userId),
    role: (userId: string) => call('bren_my_role', [], 'authenticated', userId),
    registerStaff: (userId: string, role: string, actorId: string) =>
      call('bren_register_staff', [userId, role, actorId], 'service_role', null),
    rpc: (functionName: CallableFunction, parameters: unknown[], role: DatabaseRole = 'service_role', userId: string | null = null) =>
      call(functionName, parameters, role, userId),
    async createUser(name: string) {
      const id = crypto.randomUUID();
      await admin.query(
        'insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values ($1,$2,$3,now())',
        [id, `${id}@example.test`, { full_name: name }],
      );
      return id;
    },
    async stop() {
      await admin.end();
      await server.stop();
      await rmdir(directory);
    },
  };
}
