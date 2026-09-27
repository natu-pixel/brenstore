import type { Role } from '../features/api';

export const canManage = (role: Role | null) => role === 'owner' || role === 'manager';
export const isOwner = (role: Role | null) => role === 'owner';
export function message(error: unknown): string {
  if (error instanceof Error) {
    // Translate raw database constraint violations into actionable guidance.
    if (/bren_plans_slug_key/.test(error.message)) return 'Another plan already uses this slug. Change the slug — it must be unique across all plans, including drafts and archived ones.';
    if (/bren_categories_slug_key/.test(error.message)) return 'Another category already uses this slug. Change the slug — it must be unique across all categories.';
    if (/bren_payments_reference_unique/.test(error.message)) return 'This payment reference is already recorded on another order. Check the reference before confirming.';
    if (/duplicate key value/.test(error.message)) return 'This entry already exists. Change the identifying value and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
export const dateTime = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
export const shortId = (value: string) => value.slice(0, 8);
export const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase());
