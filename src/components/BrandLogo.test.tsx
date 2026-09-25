import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { siHbomax, siNetflix, siPubg } from 'simple-icons';
import BrandLogo from './BrandLogo';
import { resolveService, servicesForCategory, SERVICES } from '../data/logos';

const product = { name: 'Netflix', brand_key: '', initial: 'N', color_start: '#2563eb', color_end: '#1e3a8a' };

describe('service names and bundled brand logos', () => {
  it('renders the actual Netflix vector in red, not a typed N, for an existing unbranded Netflix plan', () => {
    const { container } = render(<BrandLogo product={product} />);
    expect(container.querySelector('path')).toHaveAttribute('d', siNetflix.path);
    expect(container.querySelector('svg')).toHaveAttribute('fill', '#E50914');
    expect(container.querySelector('.brand-tile')).toHaveStyle({ background: 'linear-gradient(135deg, #141414, #242424)' });
    expect(container.textContent).toBe('');
  });

  it('uses the explicitly selected logo for a custom-named plan and preserves its chosen colors', () => {
    const { container } = render(<BrandLogo product={{ ...product, brand_key: 'netflix', name: 'Family monthly' }} />);
    expect(container.querySelector('path')).toHaveAttribute('d', siNetflix.path);
    expect(container.querySelector('.brand-tile')).toHaveStyle({ background: 'linear-gradient(135deg, #2563eb, #1e3a8a)' });
  });

  it('uses HBO Max rather than the unrelated Max software icon for existing hbo keys', () => {
    const { container } = render(<BrandLogo product={{ ...product, brand_key: 'hbo', name: 'HBO Max' }} />);
    expect(container.querySelector('path')).toHaveAttribute('d', siHbomax.path);
  });

  it.each(['custom', 'private-brand'])('respects explicit %s branding instead of guessing a logo from the name', brand_key => {
    const { container } = render(<BrandLogo product={{ ...product, brand_key, initial: 'ME' }} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('ME');
  });

  it('keeps an honest initial fallback for services without a bundled logo', () => {
    const { container } = render(<BrandLogo product={{ ...product, name: 'Disney+', brand_key: 'disney-plus', initial: 'D+' }} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('D+');
  });

  it('offers Free Fire Diamonds and PUBG Mobile UC under Gaming without implying a top-up integration', () => {
    const gaming = servicesForCategory('gaming');
    expect(gaming.map(service => service.name)).toEqual(expect.arrayContaining(['Free Fire Diamonds', 'PUBG Mobile UC']));
    expect(servicesForCategory('streaming').map(service => service.key)).not.toContain('pubg-uc');
    expect(resolveService('', 'PUBG UC')).toMatchObject({ key: 'pubg-uc', category: 'gaming', icon: siPubg });
    expect(resolveService('', 'Free Fire')).toMatchObject({ key: 'free-fire-diamonds', category: 'gaming', initial: 'FF' });
  });

  it('renders the bundled PUBG brand mark for UC', () => {
    const { container } = render(<BrandLogo product={{ ...product, name: 'PUBG Mobile UC', brand_key: 'pubg-uc' }} />);
    expect(container.querySelector('path')).toHaveAttribute('d', siPubg.path);
    expect(container.querySelector('svg')).toHaveAttribute('fill', '#F4B942');
  });

  it('detects only exact names or aliases, not arbitrary matching text', () => {
    expect(resolveService('', '  NETFLIX  ')?.key).toBe('netflix');
    expect(resolveService('', 'Amazon Prime Video')?.key).toBe('prime-video');
    expect(resolveService('', 'My Netflix alternative')).toBeUndefined();
    expect(resolveService('unknown', 'Netflix')).toBeUndefined();
  });

  it('offers category-specific service names without catalog prices or inventory', () => {
    expect(servicesForCategory('streaming').map(service => service.name)).toEqual([
      'Netflix', 'Prime Video', 'Disney+', 'HBO Max', 'Apple TV+', 'Crunchyroll', 'Paramount+', 'YouTube Premium',
    ]);
    expect(servicesForCategory('music').map(service => service.name)).toContain('Spotify');
    expect(servicesForCategory('music').map(service => service.name)).not.toContain('Netflix');
    expect(servicesForCategory(undefined)).toEqual([]);
    expect(servicesForCategory('custom-category')).toEqual([]);
    expect(new Set(SERVICES.map(service => service.key)).size).toBe(SERVICES.length);
    for (const service of SERVICES) {
      expect(service.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(service.initial.length).toBeLessThanOrEqual(8);
      expect(service.color_start).toMatch(/^#[a-f0-9]{6}$/i);
      expect(service.color_end).toMatch(/^#[a-f0-9]{6}$/i);
      for (const field of ['id', 'usd_minor', 'etb_minor', 'capacity', 'billing_days', 'status']) {
        expect(service).not.toHaveProperty(field);
      }
    }
  });
});
