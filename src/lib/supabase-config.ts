export function validatePublicConfig(url: string | undefined, key: string | undefined): string | null {
  if (!url?.trim() || !key?.trim()) return 'Supabase is not configured. Add the project URL and public key to the local environment.';
  if (!URL.canParse(url) || !['https:', 'http:'].includes(new URL(url).protocol)) {
    return 'The Supabase project URL must be a valid HTTP or HTTPS URL.';
  }
  if (key.startsWith('sb_secret_')) return 'A server secret was supplied as a public key. Remove it and use the project publishable key.';
  if (key.startsWith('eyJ')) {
    const parts = key.split('.');
    if (parts.length !== 3) return 'The Supabase public JWT key is malformed.';
    try {
      const claims: unknown = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (typeof claims !== 'object' || claims === null || !('role' in claims) || claims.role !== 'anon') {
        return 'Only a public anon or publishable key is allowed in the browser.';
      }
    } catch {
      return 'The Supabase public JWT key cannot be decoded. Copy the matching public key from your project.';
    }
  }
  return null;
}
