import { expect, test } from '@playwright/test';
import { startTestDatabase } from '../postgres/database';
import { connectTestDatabase } from './database-adapter';

const chatUrl = 'https://tawk.to/chat/6ab372e934848d34424e8448/1k36fholt';
let database: Awaited<ReturnType<typeof startTestDatabase>>;

test.beforeAll(async () => { database = await startTestDatabase(); });
test.afterAll(async () => { if (database) await database.stop(); });
test.beforeEach(async ({ context }) => {
  await connectTestDatabase(context, database, []);
  // Exercise real cross-origin isolation without sending conversations to Tawk.
  await context.route(chatUrl, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><p>Support provider test fixture</p><label>Message<textarea></textarea></label></body></html>',
  }));
});

test('chat is opt-in, isolated, responsive and keyboard accessible', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().startsWith('https://tawk.to/')) requests.push(request.url()); });
  await page.goto('/');
  const launcher = page.getByRole('button', { name: 'Open live support chat' });
  await expect(launcher).toBeVisible();
  expect(requests).toHaveLength(0);
  await expect(page.locator('iframe.support-chat-frame')).toHaveCount(0);

  for (const size of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const request = page.waitForRequest(chatUrl);
    await launcher.click();
    const providerRequest = await request;
    expect(providerRequest.headers().referer).toBeUndefined();
    expect(providerRequest.headers().authorization).toBeUndefined();
    const dialog = page.getByRole('dialog', { name: 'Brenstore support', exact: true });
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error('Support dialog has no visible bounds.');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
    await expect(page.locator('iframe.support-chat-frame')).toHaveCount(1);
    await expect(page.locator('script[src*="tawk.to"]')).toHaveCount(0);
    const message = page.frameLocator('iframe.support-chat-frame').getByRole('textbox', { name: 'Message' });
    await message.focus();
    const provider = page.frames().find((frame) => frame.url() === chatUrl);
    if (!provider) throw new Error('The support provider did not load.');
    const isolated = await provider.evaluate(() => {
      try {
        void window.parent.localStorage;
        return false;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'SecurityError') return true;
        throw error;
      }
    });
    expect(isolated).toBe(true);
    // Key events belong to the cross-origin frame until focus returns to the host.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Close support chat' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('iframe.support-chat-frame')).toHaveCount(0);
    await expect(launcher).toBeFocused();
  }
  expect(requests).toHaveLength(3);
});

test('SPA browser-back destroys an open chat before rendering sign-in', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByRole('button', { name: 'Open live support chat' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Open live support chat' }).click();
  await expect(page.frameLocator('iframe.support-chat-frame').getByText('Support provider test fixture')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.locator('iframe.support-chat-frame')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open live support chat' })).toHaveCount(0);
  await expect(page.locator('script[src*="tawk.to"]')).toHaveCount(0);
});
