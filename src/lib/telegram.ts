export function safeTelegramUrl(value: string | undefined, reference?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.port || url.username || url.password || !/^\/[a-zA-Z0-9_]+$/.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    if (reference) url.searchParams.set('text', `Please help with my Brenstore order ${reference}.`);
    return url.href;
  } catch { return null; }
}
