import type { Currency } from '../features/api';

export function formatMoney(minor: number, currency: Currency): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Invalid monetary amount.');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(minor / 100);
}

export function parseMoney(value: string): number {
  const trimmed = value.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) throw new Error('Enter a positive amount with no more than two decimal places.');
  const [whole, fraction = ''] = trimmed.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('The amount must be greater than zero.');
  return minor;
}

export function priceInput(minor: number | null): string {
  return minor === null ? '' : (minor / 100).toFixed(2);
}
