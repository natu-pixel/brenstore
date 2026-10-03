import type { Currency } from '../features/api';

export const REGION_KEY = 'brenstore.region.v1';

// ISO 3166-1 alpha-2 codes; names come from the browser's Intl data.
const CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CY CZ '
  + 'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GI GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP '
  + 'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ '
  + 'OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ '
  + 'UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW').split(' ');

const names = new Intl.DisplayNames(['en'], { type: 'region' });
export function countryName(code: string): string {
  try { return names.of(code) ?? code; } catch { return code; }
}

/** Ethiopia first, then alphabetical by English name. */
export const COUNTRIES = [
  { code: 'ET', name: countryName('ET') },
  ...CODES.filter(code => code !== 'ET').map(code => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];

export function currencyForCountry(country: string): Currency {
  return country === 'ET' ? 'ETB' : 'USD';
}

/** Best local guess from device settings; never calls an IP lookup service. */
export function detectCountry(
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): string {
  if (timeZone === 'Africa/Addis_Ababa') return 'ET';
  const regions = languages.map(language => {
    try { return new Intl.Locale(language).region; } catch { return undefined; }
  });
  const explicit = regions.find(region => region && CODES.includes(region));
  if (explicit) return explicit;
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).maximize().region;
      if (region && CODES.includes(region)) return region;
    } catch { /* ignore malformed language tags */ }
  }
  return 'US';
}

export function readCountry(): string | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REGION_KEY) ?? 'null');
    const country = value && typeof value === 'object' && 'country' in value ? value.country : null;
    return typeof country === 'string' && CODES.includes(country) ? country : null;
  } catch { return null; }
}

export function saveCountry(country: string) {
  try { localStorage.setItem(REGION_KEY, JSON.stringify({ country })); } catch { /* storage may be unavailable */ }
}
