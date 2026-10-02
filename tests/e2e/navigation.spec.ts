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

test('supplied avatar and all floating brands remain visible with an empty catalog at every screen size', async ({ page }, info) => {
  const modelRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/models/')) modelRequests.push(request.url());
  });
  await page.goto('/');
  const visual = page.locator('.hero-visual');
  const avatar = page.getByRole('img', { name: 'Brenstore character wearing round black glasses' });
  await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 543)).toBe(true);
  await expect(visual.locator('.float-tile')).toHaveCount(8);
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await visual.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    for (const time of [0, 3000, 6000]) {
      await visual.evaluate((element, currentTime) => {
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = currentTime;
        }
      }, time);
      const bounds = await visual.boundingBox();
      if (!bounds) throw new Error('Hero visual has no bounds.');
      for (const name of ['Netflix', 'Spotify', 'YouTube Premium', 'HBO Max', 'Apple Music', 'PlayStation Plus', 'Duolingo', 'Crunchyroll']) {
        const tile = visual.locator(`[title="${name}"]`);
        await expect(tile).toBeVisible();
        const box = await tile.boundingBox();
        if (!box) throw new Error(`${name} is not visible.`);
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.y).toBeGreaterThanOrEqual(bounds.y);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
        expect(await tile.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      }
    }
    await visual.screenshot({ path: info.outputPath(`hero-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const element of await visual.locator('.hero-avatar-art, .brand-tile').all()) {
    expect(await element.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  }
  expect(modelRequests).toEqual([]);
  await expect(visual.locator('canvas, iframe')).toHaveCount(0);
});

test('avatar eyes follow the mouse independently of the face and reset safely', async ({ page }, info) => {
  await page.goto('/');
  const portrait = page.locator('.hero-avatar-portrait');
  const tracking = page.locator('.hero-avatar-tracking');
  const eyes = page.locator('.hero-avatar-eyes');
  await expect(tracking).toHaveClass(/is-ready/);
  await portrait.evaluate(element => {
    element.scrollIntoView({ block: 'center' });
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
  const bounds = await portrait.boundingBox();
  const faceBefore = await page.locator('.hero-avatar-image').boundingBox();
  const glassesBefore = await page.locator('.hero-avatar-glasses').boundingBox();
  if (!bounds || !faceBefore) throw new Error('Avatar bounds unavailable.');
  const eyeX = bounds.x + bounds.width * 288 / 543;
  const eyeY = bounds.y + bounds.height * 159 / 636;
  async function offset() {
    return eyes.evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: matrix.m41, y: matrix.m42 };
    });
  }
  await page.mouse.move(eyeX + 320, eyeY);
  await expect.poll(async () => (await offset()).x).toBeGreaterThan(5);
  await page.locator('.hero-visual').screenshot({ path: info.outputPath('eyes-looking-right.png') });
  await page.mouse.move(eyeX - 320, eyeY);
  await expect.poll(async () => (await offset()).x).toBeLessThan(-5);
  await page.locator('.hero-visual').screenshot({ path: info.outputPath('eyes-looking-left.png') });
  await page.mouse.move(eyeX, eyeY - 160);
  await expect.poll(async () => (await offset()).y).toBeLessThan(-1);
  await page.mouse.move(eyeX, eyeY + 320);
  await expect.poll(async () => (await offset()).y).toBeGreaterThan(3);
  expect(Math.abs((await offset()).y)).toBeLessThanOrEqual(bounds.height * 12 / 636);
  expect(await page.locator('.hero-avatar-image').boundingBox()).toEqual(faceBefore);
  expect(await page.locator('.hero-avatar-glasses').boundingBox()).toEqual(glassesBefore);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null })));
  await expect.poll(offset).toEqual({ x: 0, y: 0 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(eyeX + 320, eyeY);
  await expect.poll(offset).toEqual({ x: 0, y: 0 });
});

test.describe('high-density avatar artwork', () => {
  test.use({ deviceScaleFactor: 2 });
  test('vector glasses stay aligned with the polished face at mobile and desktop sizes', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.locator('.hero-avatar-tracking')).toHaveClass(/is-ready/);
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const visual = page.locator('.hero-visual');
      await visual.evaluate(element => {
        element.scrollIntoView({ block: 'center' });
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 0;
        }
      });
      const glasses = page.locator('.hero-avatar-glasses');
      await expect(glasses).toBeVisible();
      expect(await glasses.boundingBox()).toEqual(await page.locator('.hero-avatar-image').boundingBox());
      await expect(glasses.locator('path')).toHaveCount(5);
      await expect(glasses.locator('image')).toHaveCount(0);
      expect(await glasses.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
      await visual.screenshot({ path: info.outputPath(`polished-avatar-${width}-2x.png`) });
    }
  });
});

test('failed eye texture leaves the original avatar visible instead of blank eyes', async ({ context, page }) => {
  await context.route('**/images/shop-avatar-eyes.png', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Eye animation unavailable.' })).toBeVisible();
  const avatar = page.getByRole('img', { name: 'Brenstore character wearing round black glasses' });
  await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 543)).toBe(true);
  await expect(page.locator('.hero-avatar-tracking')).toHaveCount(0);
  await expect(page.locator('.float-tile')).toHaveCount(8);
});

test('hero logos survive catalog errors and the avatar provides a working image retry', async ({ context, page }) => {
  await context.route('**/rest/v1/rpc/bren_read', async route => {
    if (route.request().postDataJSON()?.resource === 'catalog') {
      await route.fulfill({ status: 503, json: { message: 'Catalog fixture unavailable' } });
    } else await route.fallback();
  });
  const avatarUrl = '**/images/shop-avatar.png';
  await context.route(avatarUrl, route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'The shop avatar could not be loaded.' })).toBeVisible();
  await expect(page.locator('.float-tile')).toHaveCount(8);
  await expect(page.locator('.float-layer [title="Netflix"]')).toBeVisible();
  await expect(page.locator('.float-layer [title="Spotify"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start', exact: true })).toBeVisible();
  await context.unroute(avatarUrl);
  await page.getByRole('button', { name: 'Retry avatar' }).click();
  const avatar = page.getByRole('img', { name: 'Brenstore character wearing round black glasses' });
  await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 543)).toBe(true);
  await expect(page.getByRole('button', { name: 'Retry avatar' })).toHaveCount(0);
});

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
