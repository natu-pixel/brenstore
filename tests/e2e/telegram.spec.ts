import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { startTestDatabase } from '../postgres/database';
import { connectTestDatabase } from './database-adapter';
import type { BrowserAccount } from './database-adapter';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
let customer: BrowserAccount;
let planId: string;
test.beforeAll(async () => {
  db = await startTestDatabase();
  const id = await db.createUser('Telegram browser customer');
  customer = { id, email: `${id}@example.test`, password: `${crypto.randomUUID()}Aa9!`, name: 'Telegram browser customer' };
  const owner = await db.createUser('Telegram fixture owner');
  await db.admin.query('select bren_private.bootstrap_owner($1)', [owner]);
  const category = z.object({ id: z.string() }).parse(await db.mutate('save_category', {
    name: 'Telegram test', slug: 'telegram-test', sort_order: 0, archived: false,
  }, owner)).id;
  planId = z.object({ id: z.string() }).parse(await db.mutate('save_plan', {
    name: 'Bot monthly plan', slug: 'bot-monthly', description: '', category_id: category,
    brand_key: '', initial: 'B', color_start: '#111111', color_end: '#222222', usd_minor: 499,
    etb_minor: 50000, usd_compare_minor: null, etb_compare_minor: null,
    billing_days: 30, status: 'active', featured: false, low_stock_threshold: 1,
  }, owner)).id;
  await db.mutate('adjust_capacity', { plan_id: planId, capacity: 10, reason: 'Browser fixture' }, owner);
});
test.afterAll(async () => { if (db) await db.stop(); });
test.beforeEach(async ({ context }) => connectTestDatabase(context, db, [customer]));

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`link, order, history and disconnect at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const tg = viewport.width.toString();
    const token = randomBytes(32).toString('base64url');
    const request = z.object({ request_id: z.string() }).parse(await db.rpc('bren_bot', [
      'link.start', tg, { token, name: 'Browser Telegram', username: 'browser_customer' },
    ]));
    const route = `/account/telegram/link/${token}`;
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp('/auth\\?returnTo='));
    await page.getByLabel('Email', { exact: true }).fill(customer.email);
    await page.locator('input[autocomplete="current-password"]').fill(customer.password);
    await page.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:5175${route}`);
    await page.getByRole('button', { name: 'Approve connection' }).click();
    await expect(page.getByText(/Website approval saved/)).toBeVisible();
    expect(await db.rpc('bren_bot', ['account.status', tg, {}])).toMatchObject({ linked: false });
    await db.rpc('bren_bot', ['link.confirm', tg, { request_id: request.request_id }]);
    await page.getByRole('button', { name: 'Check connection again' }).click();
    await expect(page.getByText(/^Telegram is connected/)).toBeVisible();
    const input = { idempotency_key: crypto.randomUUID(), currency: 'ETB', name: 'Bot customer',
      phone: '+251911234567', items: [{ plan_id: planId, qty: 1, unit_minor: 50000 }] };
    const saved = z.object({ order: z.object({ id: z.string(), reference: z.string() }) }).parse(
      await db.rpc('bren_bot', ['order.create', tg, input]));
    await page.getByRole('link', { name: 'My Orders', exact: true }).click();
    await page.getByRole('link').filter({ hasText: saved.order.reference }).click();
    await expect(page.getByText('Ordered via Telegram')).toBeVisible();
    await expect(page.getByText(saved.order.reference, { exact: true })).toBeVisible();
    await page.goto('/account/telegram');
    await page.getByRole('checkbox', { name: /Disconnect Telegram and stop/ }).check();
    await page.getByRole('button', { name: 'Disconnect Telegram' }).click();
    await expect(page.getByText(/No active Telegram connection/)).toBeVisible();
    await expect(db.rpc('bren_bot', ['order.get', tg, { id: saved.order.id }])).rejects.toThrow('Connect');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
