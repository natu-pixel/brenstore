export function safeReturnPath(value: string | null | undefined): string {
  if (!value || /[\\%]/.test(value) || [...value].some((character) => character.charCodeAt(0) <= 32)) return '/';
  if (value === '/' || value === '/#products' || value === '/#support' || value === '/checkout' || value === '/orders') return value;
  if (/^\/orders\/[0-9a-f-]{36}$/i.test(value)) return value;
  if (/^\/admin(?:\/[a-z0-9-]+)*\/?$/i.test(value)) return value;
  return '/';
}

export function authRedirect(path: string, returnTo: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('returnTo', safeReturnPath(returnTo));
  return url.href;
}

export function signInPath(returnTo: string): string {
  return `/auth?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

const initialUrl = new URL(window.location.href);
const initialHash = new URLSearchParams(initialUrl.hash.slice(1));
export const authLink = {
  type: initialUrl.searchParams.get('type') ?? initialHash.get('type'),
  error: initialUrl.searchParams.get('error_description') ?? initialHash.get('error_description'),
  hasCredentials: initialUrl.searchParams.has('code') || initialHash.has('access_token'),
  returnTo: safeReturnPath(initialUrl.searchParams.get('returnTo')),
};
