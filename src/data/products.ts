import type { Currency, Plan } from '../features/api';

export type Product = Plan;
export type { Category } from '../features/api';

export function planPrice(plan: Plan, currency: Currency): number | null {
  return currency === 'USD' ? plan.usd_minor : plan.etb_minor;
}

export function comparePrice(plan: Plan, currency: Currency): number | null {
  return currency === 'USD' ? plan.usd_compare_minor : plan.etb_compare_minor;
}

export function billingLabel(days: number): string {
  return `${days} days`;
}
