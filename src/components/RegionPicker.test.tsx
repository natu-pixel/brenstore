import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RegionPicker from './RegionPicker';
import { COUNTRIES, REGION_KEY, currencyForCountry, detectCountry, readCountry } from '../lib/region';

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

describe('region detection', () => {
  it('detects Ethiopia from the time zone even with an English locale', () => {
    expect(detectCountry('Africa/Addis_Ababa', ['en-US'])).toBe('ET');
  });
  it('uses an explicit language region, then a likely region, then the US', () => {
    expect(detectCountry('Europe/Berlin', ['en', 'de-DE'])).toBe('DE');
    expect(detectCountry('UTC', ['am'])).toBe('ET');
    expect(detectCountry('UTC', [])).toBe('US');
    expect(detectCountry('UTC', ['not a tag!'])).toBe('US');
  });
  it('maps Ethiopia to ETB and everywhere else to USD', () => {
    expect(currencyForCountry('ET')).toBe('ETB');
    expect(currencyForCountry('KE')).toBe('USD');
    expect(COUNTRIES[0]).toEqual({ code: 'ET', name: 'Ethiopia' });
    expect(new Set(COUNTRIES.map(country => country.code)).size).toBe(COUNTRIES.length);
  });
  it('ignores corrupt or unknown stored regions', () => {
    localStorage.setItem(REGION_KEY, '{bad');
    expect(readCountry()).toBeNull();
    localStorage.setItem(REGION_KEY, JSON.stringify({ country: 'ZZ' }));
    expect(readCountry()).toBeNull();
  });
});

describe('region picker', () => {
  it('applies the detected country currency only on the first visit', () => {
    localStorage.setItem(REGION_KEY, JSON.stringify({ country: 'ET' }));
    render(<RegionPicker />);
    expect(mocks.setCurrency).not.toHaveBeenCalled();
    const trigger = screen.getByRole('button', { name: /Ship to Ethiopia, currency USD/ });
    expect(trigger).toHaveTextContent('USD');
    expect(trigger.querySelector('img.region-flag[data-country="ET"]')).not.toBeNull();
  });

  it('remembers a first-visit detection and sets its default currency', () => {
    render(<RegionPicker />);
    expect(readCountry()).not.toBeNull();
    expect(mocks.setCurrency).toHaveBeenCalledWith(currencyForCountry(readCountry()!));
  });

  it('suggests the country currency, allows overriding it and saves both', () => {
    localStorage.setItem(REGION_KEY, JSON.stringify({ country: 'US' }));
    const onOpen = vi.fn();
    render(<RegionPicker onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Change region and currency/ }));
    expect(onOpen).toHaveBeenCalled();
    const panel = screen.getByRole('dialog', { name: 'Region and currency' });
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Ship to' }), { target: { value: 'ET' } });
    expect(within(panel).getByRole('combobox', { name: 'Currency' })).toHaveValue('ETB');
    expect(panel.querySelector('.region-select-flag img[data-country="ET"]')).not.toBeNull();
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Currency' }), { target: { value: 'USD' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(mocks.setCurrency).toHaveBeenLastCalledWith('USD');
    expect(readCountry()).toBe('ET');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes without saving on Escape or an outside click', () => {
    localStorage.setItem(REGION_KEY, JSON.stringify({ country: 'US' }));
    render(<RegionPicker />);
    const trigger = screen.getByRole('button', { name: /Change region and currency/ });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox', { name: 'Ship to' }), { target: { value: 'ET' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(readCountry()).toBe('US');
    expect(mocks.setCurrency).not.toHaveBeenCalled();
  });
});
