import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { siNetflix } from 'simple-icons';
import { orderDetailSchema, planSchema } from '../../src/features/contracts';
import { startTestDatabase } from '../postgres/database';
import { connectTestDatabase } from './database-adapter';
import type { BrowserAccount } from './database-adapter';

let database: Awaited<ReturnType<typeof startTestDatabase>>;
let owner: BrowserAccount;
let customer: BrowserAccount;
let support: BrowserAccount;

test.beforeAll(async () => {
  database = await startTestDatabase();
  async function account(name: string): Promise<BrowserAccount> {
    const id = await database.createUser(name);
    return { id, email: `${id}@example.test`, password: `${crypto.randomUUID()}Aa9!`, name };
  }
  owner = await account('Browser owner');
  customer = await account('Browser customer');
  support = await account('Browser support');
  await database.admin.query('select bren_private.bootstrap_owner($1)', [owner.id]);
  await database.registerStaff(support.id, 'support', owner.id);
});
test.afterAll(async () => { if (database) await database.stop(); });
test.beforeEach(async ({ context }) => {
  await connectTestDatabase(context, database, [owner, customer, support]);
});

async function signIn(page: Page, account: BrowserAccount, target: string) {
  await page.goto(`/auth?returnTo=${encodeURIComponent(target)}`);
  await completeSignIn(page, account);
  await expect(page).toHaveURL(`http://127.0.0.1:5175${target}`);
}

async function completeSignIn(page: Page, account: BrowserAccount) {
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click();
}

test('admin catalog edits, checkout and manual fulfillment persist in PostgreSQL', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  await signIn(page, owner, '/admin/categories');
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create category', exact: true }).click();
  const categoryDialog = page.getByRole('dialog', { name: 'Create category' });
  await categoryDialog.getByLabel('Category name').fill('Streaming services');
  await categoryDialog.getByLabel('Slug', { exact: true }).fill('streaming-services');
  await categoryDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(categoryDialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Streaming services' })).toBeVisible();

  await page.getByRole('link', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  const planDialog = page.getByRole('dialog', { name: 'Create plan', exact: true });
  await planDialog.getByLabel('Plan name', { exact: true }).fill('Premium monthly');
  await planDialog.getByLabel(/^Slug/).fill('premium-monthly');
  await planDialog.getByLabel('Description', { exact: true }).fill('A manually fulfilled shared subscription seat.');
  await planDialog.getByLabel(/^Category/).selectOption({ label: 'Streaming services' });
  await planDialog.getByLabel(/^USD price/).fill('4.99');
  await planDialog.getByLabel(/^ETB price/).fill('850.00');
  await planDialog.getByLabel('Fallback initial', { exact: true }).fill('P');
  await planDialog.getByLabel(/^Status/).selectOption('active');
  await planDialog.getByRole('button', { name: 'Create plan', exact: true }).click();
  await expect(planDialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'Premium monthly' })).toBeVisible();

  await page.getByRole('link', { name: 'Seat inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust Premium monthly capacity' }).click();
  const capacityDialog = page.getByRole('dialog', { name: 'Adjust seat capacity' });
  await capacityDialog.getByLabel(/^New total capacity/).fill('2');
  await capacityDialog.getByLabel('Adjustment reason').fill('Verified two available seats.');
  page.once('dialog', (dialog) => dialog.accept());
  await capacityDialog.getByRole('button', { name: 'Record adjustment' }).click();
  await expect(capacityDialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Premium monthly' }).getByRole('cell').nth(3)).toHaveText('2');

  const customerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await connectTestDatabase(customerContext, database, [owner, customer, support], { dropNextCreateOrderResponse: true });
  const shop = await customerContext.newPage();
  try {
    await shop.goto('/#products');
    await shop.getByLabel('Display currency').selectOption('ETB');
    await expect(shop.getByRole('article').filter({ hasText: 'Premium monthly' })).toContainText(/ETB\s*850\.00/);
    await shop.getByRole('button', { name: 'Add Premium monthly to cart' }).click();
    await shop.goto('/checkout');
    await expect(shop).toHaveURL('http://127.0.0.1:5175/auth?returnTo=%2Fcheckout');
    await completeSignIn(shop, customer);
    await expect(shop).toHaveURL('http://127.0.0.1:5175/checkout');
    await expect(shop.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
    await expect(shop.getByLabel('Order currency')).toHaveValue('ETB');
    await shop.getByLabel('Full name', { exact: true }).fill('Browser customer');
    await shop.getByLabel('Phone', { exact: true }).fill('+251911234567');
    await shop.getByRole('button', { name: 'Place pending order' }).click();
    await expect(shop.getByRole('heading', { name: 'Resolve your previous attempt' })).toBeVisible();
    await expect(shop.getByRole('button', { name: 'Resolve saved order attempt', exact: true })).toBeEnabled();
    const interrupted = z.object({ total: z.number(), rows: z.array(z.object({ id: z.string() })) }).parse(
      await database.read('my_orders', {}, customer.id),
    );
    expect(interrupted.total).toBe(1);
    await shop.reload();
    await expect(shop.getByRole('heading', { name: 'Resolve your previous attempt' })).toBeVisible();
    await shop.getByRole('button', { name: 'Resolve saved order attempt' }).click();
    await expect(shop.getByRole('heading', { name: 'Saved Order' })).toBeVisible();
    const orderId = z.string().uuid().parse(new URL(shop.url()).pathname.split('/').at(-1));
    expect(orderId).toBe(interrupted.rows[0].id);
    expect(z.object({ total: z.number() }).parse(await database.read('my_orders', {}, customer.id)).total).toBe(1);
    await shop.reload();
    await expect(shop.getByRole('heading', { name: 'Saved Order' })).toBeVisible();
    const pending = orderDetailSchema.parse(await database.read('order', { id: orderId }, customer.id));
    expect(pending.order.currency).toBe('ETB');
    expect(pending.order.total_minor).toBe(85000);
    expect(pending.order.status).toBe('pending');
    const catalog = z.array(planSchema).parse(await database.read('catalog', {}, null, 'anon'));
    expect(catalog.find((plan) => plan.name === 'Premium monthly')?.available).toBe(2);

    await page.goto(`/admin/orders/${orderId}`);
    await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
    const paymentDialog = page.getByRole('dialog', { name: 'Confirm manual payment' });
    await paymentDialog.getByLabel('External payment reference').fill('MANUAL-BROWSER-001');
    await expect(paymentDialog.getByLabel('Verified amount')).toHaveValue('850.00');
    await paymentDialog.getByRole('checkbox', { name: /^I verified this payment/ }).check();
    await paymentDialog.getByRole('button', { name: 'Confirm verified payment' }).click();
    await expect(paymentDialog).not.toBeVisible();
    await expect(page.getByText('MANUAL-BROWSER-001', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Mark fulfilled', exact: true }).click();
    const fulfillment = page.getByRole('dialog', { name: 'Mark order fulfilled' });
    await fulfillment.getByRole('textbox').fill('Access delivered manually and checked with the customer.');
    await fulfillment.getByRole('checkbox').check();
    await fulfillment.getByRole('button', { name: 'Mark fulfilled' }).click();
    await expect(fulfillment).not.toBeVisible();
    expect(orderDetailSchema.parse(await database.read('order', { id: orderId }, customer.id)).order.status).toBe('fulfilled');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Confirmed payments' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('admin-overview-desktop.png'), fullPage: true });
  } finally {
    await customerContext.close();
  }
});

test('admin layout stays usable at desktop, tablet and phone widths', async ({ page }, info) => {
  test.setTimeout(120_000);
  await signIn(page, owner, '/admin');
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmed payments' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`admin-${width}.png`), fullPage: true });
    if (width === 390) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'Admin navigation' })).toBeVisible();
      await page.getByRole('link', { name: 'Plans', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  }
});

test('a new three-seat cart is separate from the previous order and payment consumes exactly three seats', async ({ page, context, browser }, info) => {
  test.setTimeout(120_000);
  const idOf = (data: unknown) => z.object({ id: z.string().uuid() }).parse(data).id;
  const id = await database.createUser('Repeat checkout customer');
  const buyer: BrowserAccount = { id, email: `${id}@example.test`, password: `${crypto.randomUUID()}Aa9!`, name: 'Repeat checkout customer' };
  const accounts = [owner, customer, support, buyer];
  await connectTestDatabase(context, database, accounts);
  const categoryId = idOf(await database.mutate('save_category', {
    name: 'Repeat checkout', slug: `repeat-${crypto.randomUUID()}`, sort_order: 10, archived: false,
  }, owner.id));
  const planId = idOf(await database.mutate('save_plan', {
    name: 'Repeat checkout plan', slug: `repeat-${crypto.randomUUID()}`, description: 'Local regression fixture only.',
    category_id: categoryId, brand_key: '', initial: 'R', color_start: '#2563eb', color_end: '#1e3a8a',
    usd_minor: 499, etb_minor: 85000, usd_compare_minor: null, etb_compare_minor: null,
    billing_days: 30, status: 'active', featured: false, low_stock_threshold: 1,
  }, owner.id));
  await database.mutate('adjust_capacity', { plan_id: planId, capacity: 5, reason: 'Five fixture seats' }, owner.id);
  const inventory = async () => z.array(planSchema).parse(await database.read('catalog', {}, null, 'anon')).find(plan => plan.id === planId);
  const orderCount = async () => z.object({ total: z.number() }).parse(await database.read('my_orders', {}, buyer.id)).total;

  await signIn(page, buyer, '/');
  await page.getByRole('button', { name: 'Add Repeat checkout plan to cart' }).click();
  await page.goto('/checkout');
  await page.getByLabel('Full name', { exact: true }).fill('Repeat checkout customer');
  await page.getByLabel('Phone', { exact: true }).fill('+251911234567');
  await page.getByRole('button', { name: 'Place pending order' }).click();
  await expect(page.getByRole('heading', { name: 'Saved Order', exact: true })).toBeVisible();
  const firstId = z.string().uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
  expect((await inventory())?.available).toBe(5);

  await page.goto('/#products');
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'Add Repeat checkout plan to cart' }).click();
  await expect(page.getByRole('button', { name: 'Open cart (3 items)' })).toBeVisible();
  await page.getByRole('button', { name: 'Open cart (3 items)' }).click();
  await expect(page.getByRole('dialog', { name: /Your Cart/ }).locator('.qty-stepper b')).toHaveText('3');
  await page.getByRole('button', { name: 'Checkout', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.reload();
    const current = page.getByRole('region', { name: 'Current cart (3 seats)' });
    await expect(current.getByText('3 × Repeat checkout plan', { exact: true })).toBeVisible();
    await expect(current.getByText(/USD\s*14\.97/)).toHaveCount(2);
    const previous = page.getByRole('region', { name: 'Previous order — already saved' });
    await expect(previous.getByText('1 × Repeat checkout plan', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`repeat-checkout-${width}.png`), fullPage: true });
  }
  expect(await orderCount()).toBe(1);
  await page.getByRole('button', { name: 'Review this cart', exact: true }).click();
  await expect(page.getByText(/3 × USD\s*4\.99 · 30 days/)).toBeVisible();
  await page.getByLabel('Full name', { exact: true }).fill('Repeat checkout customer');
  await page.getByLabel('Phone', { exact: true }).fill('+251911234567');
  expect(await orderCount()).toBe(1);
  await page.getByRole('button', { name: 'Place pending order' }).click();
  await expect(page.getByRole('heading', { name: 'Saved Order', exact: true })).toBeVisible();
  const secondId = z.string().uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
  expect(secondId).not.toBe(firstId);
  expect(await orderCount()).toBe(2);
  const saved = orderDetailSchema.parse(await database.read('order', { id: secondId }, buyer.id));
  expect(saved.items[0].qty).toBe(3);
  expect(saved.order.total_minor).toBe(1497);
  expect(await inventory()).toMatchObject({ capacity: 5, allocated: 0, available: 5 });
  expect(orderDetailSchema.parse(await database.read('order', { id: firstId }, buyer.id)).items[0].qty).toBe(1);

  const staffContext = await browser.newContext();
  try {
    await connectTestDatabase(staffContext, database, accounts);
    const staffPage = await staffContext.newPage();
    await signIn(staffPage, owner, `/admin/orders/${secondId}`);
    await staffPage.getByRole('button', { name: 'Confirm payment', exact: true }).click();
    const payment = staffPage.getByRole('dialog', { name: 'Confirm manual payment' });
    await expect(payment.getByLabel('Verified amount')).toHaveValue('14.97');
    await payment.getByLabel('External payment reference').fill(`REPEAT-${secondId}`);
    await payment.getByRole('checkbox', { name: /^I verified this payment/ }).check();
    await payment.getByRole('button', { name: 'Confirm verified payment' }).click();
    await expect(payment).not.toBeVisible();
    await staffPage.goto('/admin/inventory');
    const row = staffPage.getByRole('row').filter({ hasText: 'Repeat checkout plan' });
    await expect(row.getByRole('cell').nth(1)).toHaveText('5');
    await expect(row.getByRole('cell').nth(2)).toHaveText('3');
    await expect(row.getByRole('cell').nth(3)).toHaveText('2');
    await page.goto('/#products');
    await expect(page.getByRole('article').filter({ hasText: 'Repeat checkout plan' })).toContainText('2 seats available');
    expect(await inventory()).toMatchObject({ capacity: 5, allocated: 3, available: 2 });
  } finally {
    await staffContext.close();
  }
});

test('Support has useful operational views but no privileged controls', async ({ page }) => {
  await signIn(page, support, '/admin');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confirmed payments' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Plans', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  await page.goto('/admin/plans');
  await expect(page.getByRole('button', { name: 'Create plan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /access|permission/i })).toBeVisible();
});

test('unsaved forms block browser-back navigation until explicitly discarded', async ({ page }) => {
  await signIn(page, owner, '/admin');
  await page.getByRole('link', { name: 'Plans', exact: true }).click();
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create plan', exact: true });
  await editor.getByLabel('Plan name', { exact: true }).fill('An unsaved draft');
  await Promise.all([
    page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.message()).toMatch(/unsaved|discard/i);
      await dialog.dismiss();
    }),
    page.goBack(),
  ]);
  await expect(page).toHaveURL('http://127.0.0.1:5175/admin/plans');
  await expect(editor.getByLabel('Plan name', { exact: true })).toHaveValue('An unsaved draft');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    page.goBack(),
  ]);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});

test('query failures are explicit and recover to genuine empty search results', async ({ page, context }) => {
  let failPlans = true;
  await context.route('http://127.0.0.1:15499/rest/v1/rpc/bren_read', async (route) => {
    const input = z.object({ resource: z.string() }).parse(route.request().postDataJSON());
    if (input.resource === 'plans' && failPlans) {
      await route.fulfill({
        status: 503,
        headers: { 'access-control-allow-origin': 'http://127.0.0.1:5175' },
        json: { code: '503', message: 'The catalog service is temporarily unavailable.' },
      });
    } else await route.fallback();
  });
  await signIn(page, owner, '/admin/plans');
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  failPlans = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search plans' }).fill('no-plan-matches-this-query');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching plans' })).toBeVisible();
});

test('admin contact validation saves a canonical link that survives reload and appears in the shop', async ({ page }) => {
  await signIn(page, owner, '/admin/settings');
  const contact = page.getByLabel(/^Telegram contact URL/);
  await contact.fill('https://telegram.me/brenstore_fixture');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('alert')).toContainText('https://t.me/username');

  await contact.fill('https://t.me/brenstore_fixture?start=ignored#ignored');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Store settings saved.');
  expect(await database.read('settings', {}, owner.id)).toMatchObject({ telegram_url: 'https://t.me/brenstore_fixture' });
  await page.reload();
  await expect(contact).toHaveValue('https://t.me/brenstore_fixture');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Telegram', exact: true })).toHaveAttribute('href', 'https://t.me/brenstore_fixture');
});

test('store navigation omits admin links while direct staff access remains protected', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);

  await signIn(page, owner, '/');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByRole('link', { name: 'My orders', exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
  }
  for (const path of ['/orders', '/checkout']) {
    await page.goto(path);
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByRole('link', { name: 'My orders', exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  await expect(page.getByRole('navigation', { name: 'Administration', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Visit storefront' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();

  await page.goto('/admin');
  await expect(page).toHaveURL('http://127.0.0.1:5175/auth?returnTo=%2Fadmin');
  await completeSignIn(page, customer);
  await expect(page.getByRole('heading', { name: 'Admin access unavailable' })).toBeVisible();
});

test('category service choices fill branding only and save the chosen logo when staff creates a plan', async ({ page }, info) => {
  const category = z.object({ id: z.string() }).parse(await database.mutate('save_category', {
    name: 'Streaming', slug: 'streaming', sort_order: 10, archived: false,
  }, owner.id));
  const before = z.object({ total: z.number() }).parse(await database.read('plans', {}, owner.id)).total;
  await signIn(page, owner, '/admin/plans');
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create plan', exact: true });
  await editor.getByLabel(/^Category/).selectOption(category.id);
  const service = editor.getByLabel(/^Service \/ brand/);
  await expect(service.getByRole('option', { name: 'Netflix', exact: true })).toHaveCount(1);
  await expect(service.getByRole('option', { name: 'Spotify', exact: true })).toHaveCount(0);
  await service.selectOption('netflix');
  await expect(editor.getByLabel('Plan name', { exact: true })).toHaveValue('Netflix');
  await expect(editor.getByLabel(/^USD price/)).toHaveValue('');
  await expect(editor.getByLabel(/^ETB price/)).toHaveValue('');
  await expect(editor.getByLabel('Brand preview').locator('svg path')).toHaveAttribute('d', siNetflix.path);
  expect(z.object({ total: z.number() }).parse(await database.read('plans', {}, owner.id)).total).toBe(before);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await service.scrollIntoViewIfNeeded();
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`service-selector-${width}.png`) });
  }
  await editor.getByLabel(/^USD price/).fill('4.99');
  await editor.getByLabel(/^ETB price/).fill('850');
  await editor.getByLabel(/^Status/).selectOption('active');
  await editor.getByRole('button', { name: 'Create plan', exact: true }).click();
  await expect(editor).not.toBeVisible();

  const saved = z.array(planSchema).parse(await database.read('catalog', {}, null, 'anon')).find(plan => plan.slug === 'netflix');
  expect(saved).toMatchObject({ name: 'Netflix', category_id: category.id, brand_key: 'netflix', capacity: 0, allocated: 0, available: 0 });
  await page.reload();
  await page.getByRole('button', { name: 'Edit Netflix', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel(/^Service \/ brand/)).toHaveValue('netflix');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/#products');
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Netflix', exact: true }) });
  await expect(card.locator('.brand-tile svg path')).toHaveAttribute('d', siNetflix.path);
  await expect(card.getByRole('button', { name: 'Add Netflix to cart' })).toBeDisabled();
});
