import type { Currency } from '../features/api';

export const REGION_KEY = 'brenstore.region.v1';
export type Country = 'ET' | 'US';

export function currencyForCountry(country: Country): Currency {
  return country === 'ET' ? 'ETB' : 'USD';
}

/** Local guess from device settings only (no IP lookup): Ethiopia when the device looks Ethiopian, otherwise US. */
export function detectCountry(
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Country {
  if (timeZone === 'Africa/Addis_Ababa') return 'ET';
  for (const language of languages) {
    try {
      const locale = new Intl.Locale(language);
      if (locale.region === 'ET' || (!locale.region && ['am', 'om', 'ti'].includes(locale.language))) return 'ET';
    } catch { /* ignore malformed language tags */ }
  }
  return 'US';
}

export function readCountry(): Country | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REGION_KEY) ?? 'null');
    const country = value && typeof value === 'object' && 'country' in value ? value.country : null;
    return country === 'ET' || country === 'US' ? country : null;
  } catch { return null; }
}

export function saveCountry(country: Country) {
  try { localStorage.setItem(REGION_KEY, JSON.stringify({ country })); } catch { /* storage may be unavailable */ }
}
