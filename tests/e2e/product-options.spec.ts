import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { orderDetailSchema, planSchema } from '../../src/features/contracts';
import { startTestDatabase } from '../postgres/database';
import { connectTestDatabase } from './database-adapter';
import type { BrowserAccount } from './database-adapter';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let owner: BrowserAccount;
let customer: BrowserAccount;

test.beforeAll(async () => {
  database = await startTestDatabase();
  async function account(name: string) {
    const id = await database.createUser(name);
    return { id, name, email: `${id}@example.test`, password: `${crypto.randomUUID()}Aa9!` };
  }
  owner = await account('Option owner');
  customer = await account('Option customer');
  await database.admin.query('select bren_private.bootstrap_owner($1)', [owner.id]);
  await database.mutate('save_category', { name: 'Streaming', slug: 'streaming', sort_order: 1, archived: false }, owner.id);
});
test.afterAll(async () => { if (database) await database.stop(); });
test.beforeEach(async ({ context }) => { await connectTestDatabase(context, database, [owner, customer]); });

async function signIn(page: Page, account: BrowserAccount, target: string) {
  await page.goto(`/auth?returnTo=${encodeURIComponent(target)}`);
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:5175${target}`);
}

test('admin service relationships create one compact card and preserve exact purchase snapshots', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  await signIn(page, owner, '/admin/services');
  await page.getByRole('button', { name: 'Create service', exact: true }).click();
  const serviceEditor = page.getByRole('dialog', { name: 'Create service' });
  await serviceEditor.getByLabel(/^Category/).selectOption({ label: 'Streaming' });
  await serviceEditor.getByLabel('Brand preset').selectOption('netflix');
  await serviceEditor.getByRole('button', { name: 'Create service', exact: true }).click();
  await expect(serviceEditor).not.toBeVisible();
  await page.getByRole('link', { name: 'Manage Netflix' }).click();
  for (const option of [
    { name: '1 user', slug: 'netflix-1-user', usd: '4.99', etb: '850.00', users: '1' },
    { name: 'On mail', slug: 'netflix-on-mail', usd: '12.99', etb: '1950.00', users: '5' },
  ]) {
    await page.getByRole('button', { name: `Add ${option.name} option`, exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create plan', exact: true });
    if (option.name === 'On mail') await editor.getByLabel(/^Users included/).fill(option.users);
    await expect(editor.getByLabel('Plan name', { exact: true })).toHaveValue(`Netflix - ${option.name}`);
    await expect(editor.getByLabel(/^Slug/)).toHaveValue(option.slug);
    await editor.getByLabel(/^USD price/).fill(option.usd);
    await editor.getByLabel(/^ETB price/).fill(option.etb);
    await editor.getByLabel(/^Status/).selectOption('active');
    await editor.getByRole('button', { name: 'Create plan', exact: true }).click();
    await expect(editor).not.toBeVisible();
  }
  const plans = z.array(planSchema).parse(await database.read('catalog', {}, null, 'anon'));
  const single = plans.find(plan => plan.name === 'Netflix - 1 user');
  const mail = plans.find(plan => plan.name === 'Netflix - On mail');
  if (!single || !mail) throw new Error('Both option plans must persist before browsing.');
  expect(single.service_id).toBe(mail.service_id);
  expect(single.option_code).toBe('single_user');
  expect(mail).toMatchObject({ option_code: 'on_mail', users_included: 5 });
  await expect(page.getByRole('table', { name: 'Netflix options' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('admin-service-options.png'), fullPage: true });
  for (const plan of [single, mail]) {
    await database.mutate('adjust_capacity', { plan_id: plan.id, capacity: 5, reason: 'Option test capacity' }, owner.id);
  }
  const shopContext = await browser.newContext();
  await connectTestDatabase(shopContext, database, [owner, customer]);
  const shop = await shopContext.newPage();
  try {
    await signIn(shop, customer, '/');
    await shop.goto('/#products');
    const card = shop.getByRole('article').filter({ has: shop.getByRole('heading', { name: 'Netflix', exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(shop.getByRole('article')).toHaveCount(1);
    await expect(card.getByText('USD 4.99', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Add Netflix - 1 user to cart' }).click();
    const toggle = card.getByRole('switch', { name: 'Netflix: On mail' });
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await toggle.press('Space');
    await expect(toggle).toBeChecked();
    await expect.poll(() => card.locator('.plan-toggle-thumb').evaluate(element =>
      new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBe(24);
    await expect(card.getByText('USD 12.99', { exact: true })).toBeVisible();
    await shop.getByLabel('Display currency').selectOption('ETB');
    await expect(card.getByText('ETB 1,950.00', { exact: true })).toBeVisible();
    await shop.getByLabel('Display currency').selectOption('USD');
    await toggle.press('Enter');
    await expect(toggle).not.toBeChecked();
    await toggle.press('Enter');
    await expect(toggle).toBeChecked();
    await expect(card.getByText('Netflix - On mail', { exact: true })).not.toBeVisible();
    await expect(card.locator('.plan-toggle-help')).toBeHidden();
    await card.locator('summary').click();
    await expect(card.getByText('Netflix - On mail', { exact: true })).toBeVisible();
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Add Netflix - On mail to cart' }).click();
    for (const width of [1440, 360]) {
      await shop.setViewportSize({ width, height: 1000 });
      await card.scrollIntoViewIfNeeded();
      expect(await card.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(400);
      expect(await shop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await card.screenshot({ path: info.outputPath(`netflix-options-${width}.png`) });
    }
    await shop.getByRole('button', { name: 'Open cart (2 items)' }).click();
    const cart = shop.getByRole('dialog', { name: /Your Cart/ });
    await expect(cart.getByText('Netflix - 1 user', { exact: true })).toBeVisible();
    await expect(cart.getByText('Netflix - On mail', { exact: true })).toBeVisible();
    await cart.getByRole('button', { name: 'Checkout', exact: true }).click();
    await shop.getByLabel('Full name', { exact: true }).fill('Option customer');
    await shop.getByLabel('Phone', { exact: true }).fill('+251911234567');
    await shop.getByRole('button', { name: 'Place pending order' }).click();
    await expect(shop.getByRole('heading', { name: 'Saved Order' })).toBeVisible();
    const id = z.string().uuid().parse(new URL(shop.url()).pathname.split('/').at(-1));
    const saved = orderDetailSchema.parse(await database.read('order', { id }, customer.id));
    expect(saved.order.total_minor).toBe(1798);
    expect(saved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ plan_id: single.id, name: 'Netflix - 1 user', unit_minor: 499, qty: 1, option_code: 'single_user', users_included: 1 }),
      expect.objectContaining({ plan_id: mail.id, name: 'Netflix - On mail', unit_minor: 1299, qty: 1, option_code: 'on_mail', users_included: 5 }),
    ]));
    expect(saved.items).toHaveLength(2);
  } finally { await shopContext.close(); }
});
