import type { Input, Plan, PlanKind } from '../features/api';
import { parseMoney, priceInput } from '../lib/money';

export type PlanForm = {
  name: string; slug: string; description: string; category_id: string; brand_key: string;
  initial: string; color_start: string; color_end: string; usd: string; etb: string;
  usdCompare: string; etbCompare: string; billing_days: string; status: Plan['status'];
  featured: boolean; low_stock_threshold: string; kind: PlanKind; provider_package_id: string;
};

export function planForm(plan?: Plan): PlanForm {
  return {
    name: plan?.name ?? '', slug: plan?.slug ?? '', description: plan?.description ?? '',
    category_id: plan?.category_id ?? '', brand_key: plan?.brand_key ?? '', initial: plan?.initial ?? '',
    color_start: plan?.color_start ?? '#2563eb', color_end: plan?.color_end ?? '#1e3a8a',
    usd: priceInput(plan?.usd_minor ?? null), etb: priceInput(plan?.etb_minor ?? null),
    usdCompare: priceInput(plan?.usd_compare_minor ?? null), etbCompare: priceInput(plan?.etb_compare_minor ?? null),
    billing_days: String(plan?.billing_days ?? 30), status: plan?.status ?? 'draft',
    featured: plan?.featured ?? false, low_stock_threshold: String(plan?.low_stock_threshold ?? 0),
    kind: plan?.kind ?? 'seat', provider_package_id: plan?.provider_package_id ?? '',
  };
}

export function integerInput(value: string, label: string, minimum = 0, maximum = 1_000_000): number {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be a whole number between ${minimum.toLocaleString('en-US')} and ${maximum.toLocaleString('en-US')}.`);
  }
  return Number(value);
}

export function validSlug(slug: string) {
  if (slug.length > 120) throw new Error('The slug must be at most 120 characters.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Use lowercase letters, numbers, and single hyphens for the slug.');
  return slug;
}

export function planInput(form: PlanForm, id?: string): Input {
  if (!form.name.trim()) throw new Error('Enter a plan name.');
  validSlug(form.slug.trim());
  const usd = form.usd.trim() ? parseMoney(form.usd) : null;
  const etb = form.etb.trim() ? parseMoney(form.etb) : null;
  if (form.status === 'active' && (usd === null || etb === null)) throw new Error('Publishing requires independent USD and ETB prices.');
  if (form.status === 'active' && !form.category_id) throw new Error('Choose an active category before publishing.');
  const usdCompare = form.usdCompare.trim() ? parseMoney(form.usdCompare) : null;
  const etbCompare = form.etbCompare.trim() ? parseMoney(form.etbCompare) : null;
  if (usdCompare !== null && (usd === null || usdCompare <= usd)) throw new Error('USD comparison price must be greater than the USD price.');
  if (etbCompare !== null && (etb === null || etbCompare <= etb)) throw new Error('ETB comparison price must be greater than the ETB price.');
  if (!/^[a-zA-Z0-9_-]{0,80}$/.test(form.brand_key.trim())) throw new Error('Brand key may contain up to 80 letters, numbers, hyphens, or underscores.');
  if (!/^#[a-fA-F0-9]{6}$/.test(form.color_start) || !/^#[a-fA-F0-9]{6}$/.test(form.color_end)) throw new Error('Brand colors must be six-digit hex colors.');
  if (!form.initial.trim() || form.initial.trim().length > 8) throw new Error('Enter a brand initial of up to 8 characters.');
  const kind: PlanKind = form.kind === 'topup' ? 'topup' : 'seat';
  const providerPackage = form.provider_package_id.trim();
  if (kind === 'topup' && !/^[0-9]{1,10}$/.test(providerPackage)) throw new Error('Choose the provider package this top-up delivers.');
  if (kind === 'seat' && providerPackage) throw new Error('Provider packages are only valid for game top-up plans.');
  return {
    ...(id ? { id } : {}), name: form.name.trim(), slug: form.slug.trim(), description: form.description.trim(),
    category_id: form.category_id || null, brand_key: form.brand_key.trim(), initial: form.initial.trim(),
    color_start: form.color_start, color_end: form.color_end, usd_minor: usd, etb_minor: etb,
    usd_compare_minor: usdCompare, etb_compare_minor: etbCompare,
    billing_days: integerInput(form.billing_days, 'Billing term', 1, 3650), status: form.status,
    featured: form.featured, low_stock_threshold: integerInput(form.low_stock_threshold, 'Low-stock threshold'),
    kind, provider_package_id: kind === 'topup' ? providerPackage : null,
  };
}
