// Local-only demo data for manually testing service cards/pages. Safe to delete.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { localStatus } from './local-supabase.ts';

const config = localStatus();
const email = 'owner@brenstore.local';
const password = 'LocalOwner#2026';
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const existing = (await admin.auth.admin.listUsers()).data.users.find(user => user.email === email);
const userId = existing?.id ?? (await admin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { full_name: 'Local Owner' },
})).data.user!.id;
execFileSync('docker', ['exec', 'supabase_db_brenstore', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
  `select bren_private.bootstrap_owner('${userId}') where not exists (select 1 from bren_private.bren_staff where id = '${userId}')`]);

const owner = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false } });
const signIn = await owner.auth.signInWithPassword({ email, password });
if (signIn.error) throw signIn.error;
async function run(action: string, input: Record<string, unknown>) {
  const { data, error } = await owner.rpc('bren_mutate', { action, input });
  if (error) throw new Error(`${action}: ${error.message}`);
  return (data as { id: string }).id;
}
async function category(name: string, slug: string, sort_order: number) {
  return run('save_category', { name, slug, sort_order, archived: false });
}
const plan = (base: Record<string, unknown>) => ({
  usd_compare_minor: null, etb_compare_minor: null, status: 'active', featured: false, low_stock_threshold: 2,
  kind: 'seat', provider_package_id: null, brand_key: 'custom', initial: 'X', color_start: '#111111', color_end: '#222222',
  description: '', ...base,
});
async function stock(id: string, capacity: number) {
  if (capacity > 0) await run('adjust_capacity', { plan_id: id, capacity, reason: 'Local demo stock' });
}

const { data: seeded } = await owner.rpc('bren_read', { resource: 'public_services', args: {} });
if ((seeded as unknown[]).length) { console.log('Demo data already present.'); }
else {
  const streaming = await category('Streaming', 'streaming', 1);
  const music = await category('Music', 'music', 2);
  const services = [
    { name: 'Netflix', slug: 'netflix', brand: 'netflix', initial: 'N', colors: ['#141414', '#e50914'], cat: streaming,
      details: { badge: 'recommended', tagline: 'NETFLIX PREMIUM',
        description: 'Your Entertainment. Your Time. Your Screen. Enjoy movies, series and more on supported devices.',
        features: ['Access to available movies and series', 'Streaming on supported devices', 'Plan-dependent video quality'],
        requirements: ['A supported device and stable internet', 'Compliance with Netflix usage policies'],
        notes: 'Please make sure you provide your exact email address.' },
      plans: [['single_user', 30, 499, 99900, 5], ['on_mail', 30, 1299, 299900, 3], ['single_user', 90, 1299, 249900, 4],
        ['on_mail', 90, 3499, 699900, 2], ['single_user', 365, 4499, 699900, 1], ['on_mail', 365, 9999, 1599900, 1]] },
    { name: 'Spotify', slug: 'spotify', brand: 'spotify', initial: 'S', colors: ['#191414', '#1db954'], cat: music,
      details: { badge: 'popular', tagline: 'Premium music, no ads',
        description: 'Enjoy your favourite music and podcasts with an eligible Spotify Premium subscription.',
        features: ['Ad-free listening', 'Offline downloads'], requirements: ['A Spotify account'], notes: '' },
      plans: [['single_user', 30, 399, 249900, 8], ['single_user', 365, 3999, 2499900, 2]] },
    { name: 'Apple TV+', slug: 'apple-tv', brand: 'apple-tv', initial: 'A', colors: ['#000000', '#555555'], cat: streaming,
      details: { badge: 'premium', tagline: 'Apple Originals in one place', description: 'Premium Apple Originals series and films.',
        features: [], requirements: [], notes: '' },
      plans: [['single_user', 30, 699, 199900, 0]] },
  ] as const;
  for (const s of services) {
    const id = await run('save_service', { name: s.name, slug: s.slug, category_id: s.cat, brand_key: s.brand,
      initial: s.initial, color_start: s.colors[0], color_end: s.colors[1] });
    await run('save_service_details', { id, ...s.details });
    for (const [code, days, usd, etb, capacity] of s.plans) {
      const label = code === 'single_user' ? '1 user' : 'On mail';
      const planId = await run('save_plan', plan({ name: `${s.name} - ${label}`, slug: `${s.slug}-${code.replace('_', '-')}-${days}`,
        category_id: s.cat, billing_days: days, usd_minor: usd, etb_minor: etb, service_id: id, option_code: code,
        users_included: code === 'single_user' ? 1 : 5, featured: s.name === 'Netflix' }));
      await stock(planId, capacity);
    }
  }
  const standalone = await run('save_plan', plan({ name: 'YouTube Premium', slug: 'youtube-premium', category_id: streaming,
    description: 'Ad-free YouTube and YouTube Music on one family slot.', brand_key: 'youtube', initial: 'Y',
    color_start: '#ff0000', color_end: '#7f0000', billing_days: 30, usd_minor: 299, etb_minor: 59900 }));
  await stock(standalone, 6);
  console.log('Seeded 3 services, 1 standalone plan.');
}
console.log(`Owner login: ${email} / ${password}`);
