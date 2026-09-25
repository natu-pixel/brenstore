import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { connectTestDatabase } from './database-adapter';

const owner = { id: '20000000-0000-4000-8000-000000000001', name: 'Navigation fixture', email: 'navigation@example.test', password: 'Navigation-fixture-123!' };

test.beforeEach(async ({ context }) => {
  await connectTestDatabase(context, {
    role: async () => 'owner',
    mutate: async () => { throw new Error('Navigation tests must not mutate the database.'); },
    read: async resource => {
      switch (resource) {
        case 'public_settings': return { store_name: 'Brenstore', telegram_url: '' };
        case 'catalog':
        case 'public_categories': return [];
        case 'my_orders': return { rows: [], total: 0, page: 1, page_size: 20 };
        case 'payment_instructions': return { telegram_url: '', manual_payment_instructions: '' };
        case 'profile': return { ...owner, phone: '', telegram: '', created_at: '2026-01-01T00:00:00Z' };
        default: throw new Error(`Unexpected navigation fixture resource: ${resource}`);
      }
    },
  }, [owner]);
});

async function signIn(page: Page) {
  await page.goto('/auth');
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.locator('input[autocomplete="current-password"]').fill(owner.password);
  await page.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5175/');
}

test('storefront navigation stays on one row on phones and exposes all account actions in its menu', async ({ page }, info) => {
  test.setTimeout(120_000);
  await signIn(page);
  const header = page.locator('header.nav');
  const navigation = page.getByRole('navigation', { name: 'Store navigation' });
  const openMenu = page.getByRole('button', { name: 'Open navigation menu' });
  const cart = page.getByRole('button', { name: /^Open cart/ });
  for (const width of [390, 320, 360, 414, 768, 1020, 1021, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(width <= 1020 ? 80 : 90);
    expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const cartBounds = await cart.boundingBox();
    if (!cartBounds) throw new Error('The cart button is not visible.');
    expect(cartBounds.x + cartBounds.width).toBeLessThanOrEqual(width);
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    if (width <= 1020) {
      await expect(navigation).toBeHidden();
      await expect(page.getByRole('link', { name: 'My orders', exact: true })).toBeHidden();
      await expect(openMenu).toHaveAttribute('aria-expanded', 'false');
      const toggleBounds = await openMenu.boundingBox();
      if (!toggleBounds) throw new Error('The mobile menu button is not visible.');
      expect(Math.round(toggleBounds.width)).toBeGreaterThanOrEqual(44);
      expect(Math.round(toggleBounds.height)).toBeGreaterThanOrEqual(44);
      expect(Math.abs(toggleBounds.y - cartBounds.y)).toBeLessThanOrEqual(2);
      if (width === 390) await page.screenshot({ path: info.outputPath('store-header-mobile.png') });
      await openMenu.click();
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeFocused();
      await expect(navigation.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
      await expect(navigation.getByRole('link', { name: 'Support', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'My orders', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(80);
      expect(await page.locator('#store-navigation').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (width === 390) await page.screenshot({ path: info.outputPath('store-menu-mobile.png') });
      await page.keyboard.press('Escape');
      await expect(navigation).toBeHidden();
      await expect(openMenu).toBeFocused();
    } else {
      await expect(openMenu).toBeHidden();
      await expect(navigation).toBeVisible();
      await expect(page.getByRole('link', { name: 'My orders', exact: true })).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await openMenu.click();
  await navigation.getByRole('link', { name: 'Support', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5175/#support');
  await expect(navigation).toBeHidden();
  await openMenu.click();
  await cart.click();
  await expect(page.getByRole('dialog', { name: /Your Cart/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close cart' }).click();
  await expect(cart).toBeFocused();
  await expect(navigation).toBeHidden();
  await openMenu.click();
  const menuBounds = await page.locator('#store-navigation').boundingBox();
  if (!menuBounds) throw new Error('Open menu has no visible bounds.');
  await page.mouse.click(8, menuBounds.y + menuBounds.height + 10);
  await expect(navigation).toBeHidden();
  await openMenu.click();
  await page.getByRole('button', { name: 'Open live support chat' }).focus();
  await expect(navigation).toBeHidden();

  await openMenu.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(navigation).toBeVisible();
  await page.setViewportSize({ width: 390, height: 240 });
  await expect(navigation).toBeHidden();
  await openMenu.click();
  const shortMenu = page.locator('#store-navigation');
  expect(await shortMenu.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(240);
  await page.getByRole('button', { name: 'Sign out', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('link', { name: 'My orders', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5175/orders');
  await expect(navigation).toBeHidden();
  await openMenu.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.nav-account .user-chip')).toHaveCount(0);
  await openMenu.click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My orders', exact: true })).toHaveCount(0);
});

test('guest phone navigation provides sign-in and hash links without a wrapping header', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  const navigation = page.getByRole('navigation', { name: 'Store navigation' });
  await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeFocused();
  await navigation.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5175/#products');
  await expect(navigation).toBeHidden();
  expect(await page.locator('#products').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(69);
  await toggle.click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\?returnTo=/);
  await expect(navigation).toBeHidden();
  expect(await page.locator('header.nav').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(80);
  await toggle.click();
  await page.goBack();
  await expect(page).toHaveURL('http://127.0.0.1:5175/#products');
  await expect(navigation).toBeHidden();
  await page.goForward();
  await expect(navigation).toBeHidden();
});
