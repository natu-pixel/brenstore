import type { Role } from '../features/api';

export const canManage = (role: Role | null) => role === 'owner' || role === 'manager';
export const isOwner = (role: Role | null) => role === 'owner';
export const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export const dateTime = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
export const shortId = (value: string) => value.slice(0, 8);
export const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase());
