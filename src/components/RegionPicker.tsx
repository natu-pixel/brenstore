import { useEffect, useState } from 'react';
import etFlag from 'flag-icons/flags/4x3/et.svg';
import usFlag from 'flag-icons/flags/4x3/us.svg';
import { useCart } from '../cart';
import { currencyForCountry, detectCountry, readCountry, saveCountry } from '../lib/region';
import type { Country } from '../lib/region';

const OPTIONS: { country: Country; flag: string; label: string }[] = [
  { country: 'ET', flag: etFlag, label: 'Ethiopian Birr (ETB)' },
  { country: 'US', flag: usFlag, label: 'US Dollar (USD)' },
];

// Two flags, one tap: Ethiopia shows ETB prices, United States shows USD prices. Windows does not render flag emoji.
export default function RegionPicker() {
  const { currency, setCurrency } = useCart();
  const [detected] = useState(() => readCountry() ?? detectCountry());

  // First visit only: remember the detected country and apply its currency.
  useEffect(() => {
    if (readCountry()) return;
    saveCountry(detected);
    setCurrency(currencyForCountry(detected));
  }, [detected, setCurrency]);

  return <div className="region-picker" role="group" aria-label="Price currency">
    {OPTIONS.map(option => {
      const active = currencyForCountry(option.country) === currency;
      return <button key={option.country} type="button" className={`region-flag-button${active ? ' is-active' : ''}`}
        aria-pressed={active} aria-label={`Show prices in ${option.label}`} title={option.label}
        onClick={() => { saveCountry(option.country); setCurrency(currencyForCountry(option.country)); }}>
        <img className="region-flag" src={option.flag} alt="" width={24} height={18} data-country={option.country} />
      </button>;
    })}
  </div>;
}
