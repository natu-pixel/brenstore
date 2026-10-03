import type { Input, OptionCode, Plan, PlanKind, Service, ServiceBadge } from '../features/api';
import { parseMoney, priceInput } from '../lib/money';

export type ServiceDetailsForm = {
  badge: ServiceBadge | ''; tagline: string; description: string;
  features: string; requirements: string; notes: string;
};

export function serviceDetailsForm(service?: Service): ServiceDetailsForm {
  return {
    badge: service?.badge ?? '', tagline: service?.tagline ?? '', description: service?.description ?? '',
    features: (service?.features ?? []).join('\n'), requirements: (service?.requirements ?? []).join('\n'),
    notes: service?.notes ?? '',
  };
}

function listInput(value: string, label: string): string[] {
  const items = value.split('\n').map(item => item.trim()).filter(Boolean);
  if (items.length > 30) throw new Error(`${label} can have at most 30 lines.`);
  if (items.some(item => item.length > 300)) throw new Error(`Each ${label.toLowerCase()} line must be at most 300 characters.`);
  return items;
}

export function serviceDetailsInput(form: ServiceDetailsForm, id: string): Input {
  const tagline = form.tagline.trim();
  const description = form.description.trim();
  const notes = form.notes.trim();
  if (tagline.length > 160) throw new Error('The tagline must be at most 160 characters.');
  if (description.length > 4000) throw new Error('The description must be at most 4,000 characters.');
  if (notes.length > 2000) throw new Error('Important notes must be at most 2,000 characters.');
  return {
    id, badge: form.badge || null, tagline, description, notes,
    features: listInput(form.features, 'Features'), requirements: listInput(form.requirements, 'Requirements'),
  };
}

export type PlanForm = {
  name: string; slug: string; description: string; category_id: string; brand_key: string;
  initial: string; color_start: string; color_end: string; usd: string; etb: string;
  usdCompare: string; etbCompare: string; billing_days: string; status: Plan['status'];
  featured: boolean; low_stock_threshold: string; kind: PlanKind; provider_package_id: string;
  service_id: string; option_code: OptionCode | ''; users_included: string;
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
    service_id: plan?.service_id ?? '', option_code: plan?.option_code ?? '',
    users_included: plan?.users_included == null ? '' : String(plan.users_included),
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
  if (form.service_id && kind !== 'seat') throw new Error('Unlink the subscription service before changing to a top-up.');
  if (form.option_code && !form.service_id) throw new Error('Choose a service for this option.');
  const included = form.users_included ? integerInput(form.users_included, 'Users included', 1, 1000) : null;
  if (form.option_code && included === null) throw new Error('Enter the number of users included per purchase.');
  if (!form.option_code && included !== null) throw new Error('Choose an option before setting users included.');
  if (form.option_code === 'single_user' && included !== 1) throw new Error('The 1 user option must include exactly one user.');
  return {
    ...(id ? { id } : {}), name: form.name.trim(), slug: form.slug.trim(), description: form.description.trim(),
    category_id: form.category_id || null, brand_key: form.brand_key.trim(), initial: form.initial.trim(),
    color_start: form.color_start, color_end: form.color_end, usd_minor: usd, etb_minor: etb,
    usd_compare_minor: usdCompare, etb_compare_minor: etbCompare,
    billing_days: integerInput(form.billing_days, 'Billing term', 1, 3650), status: form.status,
    featured: form.featured, low_stock_threshold: integerInput(form.low_stock_threshold, 'Low-stock threshold'),
    kind, provider_package_id: kind === 'topup' ? providerPackage : null,
    service_id: form.service_id || null, option_code: form.option_code || null, users_included: included,
  };
}
