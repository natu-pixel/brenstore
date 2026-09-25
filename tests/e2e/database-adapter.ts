import type { BrowserContext } from '@playwright/test';
import { z } from 'zod';
import type { Input } from '../../src/features/api';
import type { startTestDatabase } from '../postgres/database';

type TestDatabase = Pick<Awaited<ReturnType<typeof startTestDatabase>>, 'read' | 'mutate' | 'role'>;
export type BrowserAccount = { id: string; email: string; password: string; name: string };
const credentials = z.object({ email: z.string(), password: z.string() });
const rpcInput = z.object({
  resource: z.string().optional(), action: z.string().optional(),
  args: z.record(z.string(), z.json()).optional(), input: z.record(z.string(), z.json()).optional(),
});

// Commerce tests use real PostgreSQL RPCs; navigation tests provide read-only UI fixtures.
// They deliberately do not claim to verify hosted Auth, PostgREST, or email delivery.
export async function connectTestDatabase(
  context: BrowserContext, database: TestDatabase, accounts: BrowserAccount[],
  faults?: { dropNextCreateOrderResponse: boolean },
) {
  const tokens = new Map<string, BrowserAccount>();
  const refreshTokens = new Map<string, BrowserAccount>();
  const user = (account: BrowserAccount) => ({
    id: account.id, email: account.email, aud: 'authenticated', role: 'authenticated',
    email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: account.name }, identities: [],
  });
  function session(account: BrowserAccount) {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: account.id, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600,
    })}.fixture-signature`;
    const refreshToken = crypto.randomUUID();
    tokens.set(token, account);
    refreshTokens.set(refreshToken, account);
    return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refreshToken, user: user(account) };
  }

  await context.route('http://127.0.0.1:15499/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': 'http://127.0.0.1:5175',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const account = tokens.get(request.headers().authorization?.replace(/^Bearer /, '') ?? '');
    if (url.pathname === '/auth/v1/token') {
      let found: BrowserAccount | undefined;
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const payload = z.object({ refresh_token: z.string() }).parse(request.postDataJSON());
        found = refreshTokens.get(payload.refresh_token);
      } else {
        const payload = credentials.parse(request.postDataJSON());
        found = accounts.find((candidate) => candidate.email === payload.email && candidate.password === payload.password);
      }
      await route.fulfill({
        status: found ? 200 : 400, headers,
        json: found ? session(found) : { error: 'invalid_grant', error_description: 'Invalid login credentials' },
      });
      return;
    }
    if (url.pathname === '/auth/v1/user') {
      await route.fulfill({ status: account ? 200 : 401, headers, json: account ? user(account) : { message: 'Unauthorized' } });
      return;
    }
    if (url.pathname === '/auth/v1/logout') {
      await route.fulfill({ status: 200, headers, json: {} });
      return;
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      try {
        const payload = rpcInput.parse(request.postDataJSON() ?? {});
        const name = url.pathname.split('/').at(-1);
        let result: unknown;
        const role = account ? 'authenticated' : 'anon';
        if (name === 'bren_my_role') {
          result = account ? await database.role(account.id) : null;
        } else if (name === 'bren_read' && payload.resource) {
          result = await database.read(payload.resource, payload.args ?? {}, account?.id ?? null, role);
        } else if (name === 'bren_mutate' && payload.action) {
          const input: Input = payload.input ?? {};
          result = await database.mutate(payload.action, input, account?.id ?? null, role);
        } else {
          throw new Error('Unexpected database contract request.');
        }
        if (name === 'bren_mutate' && payload.action === 'create_order' && faults?.dropNextCreateOrderResponse) {
          faults.dropNextCreateOrderResponse = false;
          await route.abort('failed');
          return;
        }
        await route.fulfill({ status: 200, headers, json: result });
      } catch (error) {
        await route.fulfill({
          status: 400, headers,
          json: { code: 'P0001', message: error instanceof Error ? error.message : 'Database contract request failed.', details: null, hint: null },
        });
      }
      return;
    }
    await route.fulfill({ status: 503, headers, json: { message: 'This external service is not part of the browser contract fixture.' } });
  });
}
