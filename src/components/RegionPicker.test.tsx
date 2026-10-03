import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegionPicker from './RegionPicker';
import { REGION_KEY, currencyForCountry, detectCountry, readCountry } from '../lib/region';

const mocks = vi.hoisted(() => ({ cart: vi.fn(), setCurrency: vi.fn() }));
vi.mock('../cart', () => ({ useCart: mocks.cart }));
let currency: 'USD' | 'ETB';

beforeEach(() => {
  localStorage.clear();
  currency = 'USD';
  vi.clearAllMocks();
  mocks.setCurrency.mockImplementation((next: 'USD' | 'ETB') => { currency = next; });
  mocks.cart.mockImplementation(() => ({ currency, setCurrency: mocks.setCurrency }));
});

describe('country detection', () => {
  it('detects Ethiopia from the time zone or an Ethiopian language/region', () => {
    expect(detectCountry('Africa/Addis_Ababa', ['en-US'])).toBe('ET');
    expect(detectCountry('UTC', ['am'])).toBe('ET');
    expect(detectCountry('UTC', ['en-ET'])).toBe('ET');
  });
  it('falls back to the United States', () => {
    expect(detectCountry('Europe/Berlin', ['de-DE'])).toBe('US');
    expect(detectCountry('UTC', [])).toBe('US');
    expect(detectCountry('UTC', ['not a tag!'])).toBe('US');
  });
  it('maps Ethiopia to ETB and the United States to USD, ignoring corrupt storage', () => {
    expect(currencyForCountry('ET')).toBe('ETB');
    expect(currencyForCountry('US')).toBe('USD');
    localStorage.setItem(REGION_KEY, '{bad');
    expect(readCountry()).toBeNull();
    localStorage.setItem(REGION_KEY, JSON.stringify({ country: 'KE' }));
    expect(readCountry()).toBeNull();
  });
});

describe('flag currency toggle', () => {
  it('shows only two flag buttons, with the current currency pressed', () => {
    localStorage.setItem(REGION_KEY, JSON.stringify({ country: 'US' }));
    render(<RegionPicker />);
    const group = screen.getByRole('group', { name: 'Price currency' });
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /US Dollar/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Ethiopian Birr/ })).toHaveAttribute('aria-pressed', 'false');
    expect(group.querySelector('img[data-country="ET"]')).not.toBeNull();
    expect(group.querySelector('img[data-country="US"]')).not.toBeNull();
  });

  it('switches currency with one tap and remembers the choice', () => {
    localStorage.setItem(REGION_KEY, JSON.stringify({ country: 'US' }));
    render(<RegionPicker />);
    fireEvent.click(screen.getByRole('button', { name: /Ethiopian Birr/ }));
    expect(mocks.setCurrency).toHaveBeenLastCalledWith('ETB');
    expect(readCountry()).toBe('ET');
    fireEvent.click(screen.getByRole('button', { name: /US Dollar/ }));
    expect(mocks.setCurrency).toHaveBeenLastCalledWith('USD');
    expect(readCountry()).toBe('US');
  });

  it('applies the detected default only on the first visit', () => {
    render(<RegionPicker />);
    expect(readCountry()).not.toBeNull();
    expect(mocks.setCurrency).toHaveBeenCalledWith(currencyForCountry(readCountry()!));
    vi.clearAllMocks();
    render(<RegionPicker />);
    expect(mocks.setCurrency).not.toHaveBeenCalled();
  });
});
