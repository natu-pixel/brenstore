import type { Currency, Plan, Service, ServiceBadge } from '../features/api';
import type { PlanGroup } from './plan-options';
import { planPrice } from './products';

export const badgeLabels: Record<ServiceBadge, string> = {
  recommended: 'Recommended', popular: 'Popular', premium: 'Premium',
};

export function groupKey(group: PlanGroup): string {
  return group.serviceId ?? `plan-${group.plans[0].id}`;
}

export function servicePath(group: PlanGroup): string {
  return `/services/${encodeURIComponent(groupKey(group))}`;
}

export function inStock(plan: Plan): boolean {
  return plan.kind === 'topup' || (plan.available ?? 0) > 0;
}

export function purchasable(plan: Plan, currency: Currency): boolean {
  return plan.status === 'active' && planPrice(plan, currency) !== null && inStock(plan);
}

/** Lowest price among purchasable plans, falling back to any priced plan so sold-out cards still show a price. */
export function fromPrice(plans: Plan[], currency: Currency): number | null {
  const priced = plans.filter(plan => plan.status === 'active' && planPrice(plan, currency) !== null);
  const pool = priced.some(plan => inStock(plan)) ? priced.filter(inStock) : priced;
  return pool.length ? Math.min(...pool.map(plan => planPrice(plan, currency)!)) : null;
}

/** The subscription with the lowest price per user per day, only when it beats the others. */
export function bestValueId(plans: Plan[], currency: Currency): string | null {
  const rates = plans.filter(plan => plan.kind !== 'topup' && plan.billing_days > 0 && purchasable(plan, currency))
    .map(plan => ({ id: plan.id, rate: planPrice(plan, currency)! / (plan.billing_days * (plan.users_included ?? 1)) }));
  if (rates.length < 2) return null;
  const best = rates.reduce((low, item) => item.rate < low.rate ? item : low);
  return rates.filter(item => item.rate === best.rate).length === 1 ? best.id : null;
}

const optionOrder = { single_user: 0, on_mail: 1 } as const;
export function sortPlans(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => a.billing_days - b.billing_days
    || (a.option_code ? optionOrder[a.option_code] : 2) - (b.option_code ? optionOrder[b.option_code] : 2)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function serviceSummary(group: PlanGroup, service?: Service): string {
  return service?.tagline || service?.description || group.plans.find(plan => plan.description)?.description || '';
}
