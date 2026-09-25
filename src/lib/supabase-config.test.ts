import { describe, expect, it } from 'vitest';
import { validatePublicConfig } from './supabase-config';

describe('public Supabase configuration', () => {
  it('rejects incomplete or invalid endpoints before client initialization', () => {
    expect(validatePublicConfig(undefined, undefined)).toContain('not configured');
    expect(validatePublicConfig('not-a-url', 'public')).toContain('valid HTTP');
    expect(validatePublicConfig('file:///tmp/project', 'public')).toContain('valid HTTP');
  });
  it('never initializes the browser client with server secrets', () => {
    expect(validatePublicConfig('https://example.supabase.co', 'sb_secret_example')).toContain('server secret');
    const payload = btoa(JSON.stringify({ role: 'service_role' }));
    expect(validatePublicConfig('https://example.supabase.co', `eyJheader.${payload}.signature`)).toContain('Only a public');
  });
  it('accepts a publishable or anon key without claiming the server accepts it', () => {
    expect(validatePublicConfig('https://example.supabase.co', 'sb_publishable_example')).toBeNull();
    const payload = btoa(JSON.stringify({ role: 'anon' }));
    expect(validatePublicConfig('https://example.supabase.co', `eyJheader.${payload}.signature`)).toBeNull();
  });
});
