import { describe, expect, it } from 'vitest';
import { authRedirect, safeReturnPath, signInPath } from './redirects';

describe('local auth redirect allowlist', () => {
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/%2fevil.test', '/auth/callback', '/checkout?next=https://evil.test', '/admin/../auth', ' /checkout'])('rejects %s', (path) => {
    expect(safeReturnPath(path)).toBe('/');
  });
  it.each(['/checkout', '/#products', '/orders', '/orders/10000000-0000-4000-8000-000000000001', '/admin/orders'])('preserves %s', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });
  it('uses local callback origin and preserves a checkout return path', () => {
    const url = new URL(authRedirect('/auth/callback?type=recovery', '/checkout'));
    expect(url.origin).toBe(window.location.origin);
    expect(url.searchParams.get('type')).toBe('recovery');
    expect(url.searchParams.get('returnTo')).toBe('/checkout');
    expect(signInPath('/checkout')).toBe('/auth?returnTo=%2Fcheckout');
  });
});
