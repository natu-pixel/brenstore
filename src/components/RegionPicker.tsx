import { useEffect, useId, useRef, useState } from 'react';
import { IconChevronDown, IconX } from '@tabler/icons-react';
import { useCart } from '../cart';
import { CURRENCIES } from '../data/currency';
import type { Currency } from '../features/api';
import { COUNTRIES, countryName, currencyForCountry, detectCountry, readCountry, saveCountry } from '../lib/region';

const currencyNames: Record<Currency, string> = { USD: 'US Dollar', ETB: 'Ethiopian Birr' };

// Each flag is emitted as its own file and fetched only when shown; Windows does not render flag emoji.
const flagUrls = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true, query: '?url&no-inline', import: 'default',
});
function flagUrl(country: string) {
  return flagUrls[`/node_modules/flag-icons/flags/4x3/${country.toLowerCase()}.svg`];
}

function Flag({ country }: { country: string }) {
  const src = flagUrl(country);
  return src ? <img className="region-flag" src={src} alt="" width={24} height={18} data-country={country} /> : null;
}

export default function RegionPicker({ onOpen }: { onOpen?: () => void }) {
  const { currency, setCurrency } = useCart();
  const [country, setCountry] = useState(() => readCountry() ?? detectCountry());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ country, currency });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // First visit: remember the detected country and apply its default currency once.
  useEffect(() => {
    if (readCountry()) return;
    saveCountry(country);
    setCurrency(currencyForCountry(country));
  }, [country, setCurrency]);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLSelectElement>('select')?.focus();
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function toggle() {
    if (!open) { setDraft({ country, currency }); onOpen?.(); }
    setOpen(!open);
  }
  function save() {
    setCountry(draft.country);
    saveCountry(draft.country);
    setCurrency(draft.currency);
    setOpen(false);
    button.current?.focus();
  }

  return <div className="region-picker" ref={root}>
    <button ref={button} type="button" className="region-trigger" aria-expanded={open} aria-controls={panelId}
      aria-label={`Ship to ${countryName(country)}, currency ${currency}. Change region and currency`} onClick={toggle}>
      <Flag country={country} />
      <span className="region-currency">{currency}</span>
      <IconChevronDown size={14} aria-hidden="true" className="region-chevron" />
    </button>
    {open && <div className="region-panel" id={panelId} role="dialog" aria-label="Region and currency">
      <div className="region-panel-head">
        <strong>Region &amp; currency</strong>
        <button type="button" className="region-close" aria-label="Close region settings" onClick={() => setOpen(false)}><IconX size={18} /></button>
      </div>
      <label>Ship to
        <span className="region-select-flag">
          <Flag country={draft.country} />
          <select value={draft.country} onChange={event => {
            const next = event.target.value;
            setDraft({ country: next, currency: currencyForCountry(next) });
          }}>
            {COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </span>
      </label>
      <label>Currency
        <select value={draft.currency} onChange={event => setDraft(previous => ({ ...previous, currency: event.target.value as Currency }))}>
          {CURRENCIES.map(code => <option key={code} value={code}>{code} — {currencyNames[code]}</option>)}
        </select>
      </label>
      <p className="region-note">USD and ETB prices are set separately; no exchange-rate conversion is applied.</p>
      <button type="button" className="btn region-save" onClick={save}>Save</button>
    </div>}
  </div>;
}
