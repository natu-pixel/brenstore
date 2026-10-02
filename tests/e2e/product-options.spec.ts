import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { orderDetailSchema, planSchema, resourceSchemas } from '../../src/features/contracts';
import { planForm, planInput } from '../../src/admin/validation';
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
  const serviceUrl = page.url();
  for (const [index, name] of ['Unused service option', 'Unused standalone plan'].entries()) {
    const form = { ...planForm(single), name, slug: `unused-option-${index}`, billing_days: '90', status: 'draft' as const };
    const input = planInput(index === 0 ? form : { ...form, service_id: '', option_code: '', users_included: '' });
    const unused = z.object({ id: z.string() }).parse(await database.mutate('save_plan', input, owner.id));
    await page.goto(index === 0 ? serviceUrl : '/admin/plans');
    await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
    let deletion = page.getByRole('dialog', { name: `Delete ${name}` });
    await deletion.getByRole('button', { name: 'Close dialog' }).click();
    await expect(deletion).not.toBeVisible();
    await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
    deletion = page.getByRole('dialog', { name: `Delete ${name}` });
    await deletion.getByLabel('Reason / staff note').fill('Duplicate unused offer');
    await deletion.getByRole('button', { name: 'Delete plan', exact: true }).click();
    await expect(deletion).toBeVisible();
    await deletion.getByRole('checkbox').check();
    await deletion.getByRole('button', { name: 'Delete plan', exact: true }).click();
    await expect(deletion).not.toBeVisible();
    await expect(page.getByRole('button', { name: `Delete ${name}`, exact: true })).toHaveCount(0);
    const deleted = await database.admin.query('select id from bren_private.bren_plans where id = $1', [unused.id]);
    expect(deleted.rows).toHaveLength(0);
  }
  await page.goto(serviceUrl);
  await expect(page.getByRole('table', { name: 'Netflix options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Netflix - On mail', exact: true })).toBeVisible();
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
    await page.reload();
    await page.getByRole('button', { name: 'Delete Netflix - On mail', exact: true }).click();
    const protectedDeletion = page.getByRole('dialog', { name: 'Delete Netflix - On mail' });
    await protectedDeletion.getByLabel('Reason / staff note').fill('Attempt to remove a purchased plan');
    await protectedDeletion.getByRole('checkbox').check();
    await protectedDeletion.getByRole('button', { name: 'Delete plan', exact: true }).click();
    await expect(protectedDeletion.getByRole('alert')).toContainText('cannot be deleted');
    await expect(protectedDeletion.getByRole('alert')).toContainText('Archived');
    expect(orderDetailSchema.parse(await database.read('order', { id }, customer.id))).toEqual(saved);
  } finally { await shopContext.close(); }
});

test('monthly quarterly and yearly selections persist the chosen durations and independent prices', async ({ page }, info) => {
  test.setTimeout(120_000);
  const categories = resourceSchemas.public_categories.parse(await database.read('public_categories', {}, null, 'anon'));
  const service = z.object({ id: z.string() }).parse(await database.mutate('save_service', {
    name: 'Term service', slug: 'term-service', category_id: categories[0].id,
    brand_key: 'netflix', initial: 'N', color_start: '#111111', color_end: '#222222',
  }, owner.id));
  await signIn(page, owner, `/admin/services/${service.id}`);
  for (const option of ['1 user', 'On mail']) {
    for (const term of [
      { label: 'Monthly', days: 30, usd: '4.99' },
      { label: 'Quarterly', days: 90, usd: '12.99' },
      { label: 'Yearly', days: 365, usd: '49.99' },
    ]) {
      await page.getByRole('button', { name: `Add ${option} option`, exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Create plan', exact: true });
      await editor.getByRole('button', { name: `${term.label} (${term.days} days)`, exact: true }).click();
      await expect(editor.getByLabel('Billing term (days)', { exact: true })).toHaveValue(String(term.days));
      const baseSlug = `term-service-${option === '1 user' ? '1-user' : 'on-mail'}`;
      await expect(editor.getByLabel(/^Slug/)).toHaveValue(`${baseSlug}${term.days === 30 ? '' : `-${term.label.toLowerCase()}`}`);
      if (option === 'On mail') await editor.getByLabel(/^Users included/).fill('5');
      await editor.getByLabel(/^USD price/).fill(term.usd);
      await editor.getByLabel(/^ETB price/).fill(String(term.days * 10));
      await editor.getByLabel(/^Status/).selectOption('active');
      await editor.getByRole('button', { name: 'Create plan', exact: true }).click();
      await expect(editor).not.toBeVisible();
    }
  }
  const plans = resourceSchemas.plans.parse(await database.read('plans', { service_id: service.id }, owner.id)).rows;
  expect(plans).toHaveLength(6);
  for (const plan of plans) await database.mutate('adjust_capacity', { plan_id: plan.id, capacity: 5, reason: 'Term test stock' }, owner.id);
  const quarterly = plans.find(plan => plan.option_code === 'single_user' && plan.billing_days === 90)!;
  const yearly = plans.find(plan => plan.option_code === 'on_mail' && plan.billing_days === 365)!;
  await page.goto('/#products');
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Term service', exact: true }) });
  const controls = page.getByRole('group', { name: 'Catalog preferences' });
  const duration = controls.getByRole('combobox', { name: 'Subscription duration' });
  await expect(duration).toHaveValue('all');
  await expect(card.getByRole('combobox')).toHaveCount(0);
  await duration.selectOption({ label: 'Quarterly' });
  await expect(card.getByText('USD 12.99', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Add Term service - 1 user to cart' }).click();
  await duration.selectOption({ label: 'Yearly' });
  await card.getByRole('switch', { name: 'Term service: On mail' }).click();
  await expect(duration).toHaveValue('365');
  await expect(card.getByText('USD 49.99', { exact: true })).toBeVisible();
  for (const currency of ['USD', 'ETB']) {
    await page.getByLabel('Display currency').selectOption(currency);
    await page.setViewportSize({ width: 360, height: 1000 });
    await expect(duration).toHaveValue('365');
    await expect(card.getByRole('switch', { name: 'Term service: On mail' })).toBeChecked();
    expect(await card.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await card.screenshot({ path: info.outputPath(`duration-card-${currency}.png`) });
  }
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await controls.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(duration).toBeInViewport();
    expect(await duration.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    const controlsBox = await controls.boundingBox();
    const searchBox = await page.getByRole('searchbox', { name: 'Search plans and brands' }).boundingBox();
    if (!controlsBox || !searchBox) throw new Error('Catalog controls and search must be visible.');
    expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(searchBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`catalog-duration-${width}.png`) });
  }
  await page.getByLabel('Display currency').selectOption('USD');
  await card.getByRole('button', { name: 'Add Term service - On mail to cart' }).click();
  await page.getByRole('button', { name: 'Open cart (2 items)' }).click();
  const cart = page.getByRole('dialog', { name: /Your Cart/ });
  await expect(cart.getByText('Quarterly (90 days)', { exact: true })).toBeVisible();
  await expect(cart.getByText('Yearly (365 days)', { exact: true })).toBeVisible();
  await cart.getByRole('button', { name: 'Checkout', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Term buyer');
  await page.getByLabel('Phone', { exact: true }).fill('+251911234567');
  await page.getByRole('button', { name: 'Place pending order' }).click();
  await expect(page.getByRole('heading', { name: 'Saved Order' })).toBeVisible();
  const orderId = z.string().uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
  const order = orderDetailSchema.parse(await database.read('order', { id: orderId }, owner.id));
  expect(order.order.total_minor).toBe(6298);
  expect(order.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ plan_id: quarterly.id, billing_days: 90, unit_minor: 1299, qty: 1 }),
    expect.objectContaining({ plan_id: yearly.id, billing_days: 365, unit_minor: 4999, qty: 1 }),
  ]));
});
