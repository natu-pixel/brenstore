import { describe, expect, it } from 'vitest';
import { integerInput, planForm, planInput, validSlug } from './validation';

const draft = () => ({ ...planForm(), name: 'Test plan', slug: 'test-plan', initial: 'T' });

describe('admin plan validation', () => {
  it('keeps independently entered USD and ETB amounts exact', () => {
    const input = planInput({ ...draft(), category_id: 'category-1', usd: '1.23', etb: '987.65', status: 'active' });
    expect(input).toMatchObject({ usd_minor: 123, etb_minor: 98765, status: 'active' });
    expect(input).not.toHaveProperty('capacity');
  });
  it('permits unpriced drafts but not publication without both currencies', () => {
    expect(planInput(draft())).toMatchObject({ usd_minor: null, etb_minor: null });
    expect(() => planInput({ ...draft(), status: 'active', usd: '2.00' })).toThrow('independent USD and ETB');
  });
  it('permits uncategorized drafts but requires a category for publication', () => {
    expect(() => planInput({ ...draft(), status: 'active', usd: '2', etb: '200' })).toThrow('active category');
    expect(planInput(draft())).toHaveProperty('category_id', null);
  });
  it.each(['1.001', '-1', 'NaN', 'Infinity', '0', '1e3'])('rejects invalid price %s', usd => {
    expect(() => planInput({ ...draft(), usd })).toThrow();
  });
  it('requires comparison prices to exceed the price in the same currency', () => {
    expect(() => planInput({ ...draft(), usd: '2', usdCompare: '2' })).toThrow('USD comparison');
    expect(() => planInput({ ...draft(), etb: '2', etbCompare: '1' })).toThrow('ETB comparison');
    expect(() => planInput({ ...draft(), etbCompare: '20' })).toThrow('ETB comparison');
    expect(planInput({ ...draft(), usd: '2', etb: '200', usdCompare: '3', etbCompare: '201' })).toMatchObject({ usd_compare_minor: 300, etb_compare_minor: 20100 });
  });
  it('rejects invalid inventory and billing numbers', () => {
    for (const value of ['-1', '1.5', 'NaN', '', '9999999999999999999']) expect(() => integerInput(value, 'Capacity')).toThrow();
    expect(integerInput('0', 'Capacity')).toBe(0);
    expect(() => integerInput('0', 'Billing term', 1)).toThrow();
  });
  it('enforces the exact database limits before submitting quantities and terms', () => {
    expect(integerInput('1000000', 'Capacity')).toBe(1000000);
    expect(() => integerInput('1000001', 'Capacity')).toThrow('1,000,000');
    expect(planInput({ ...draft(), billing_days: '3650', low_stock_threshold: '1000000' })).toMatchObject({
      billing_days: 3650, low_stock_threshold: 1000000,
    });
    expect(() => planInput({ ...draft(), billing_days: '3651' })).toThrow('3,650');
    expect(() => planInput({ ...draft(), low_stock_threshold: '1000001' })).toThrow('1,000,000');
    expect(validSlug('a'.repeat(120))).toHaveLength(120);
    expect(() => validSlug('a'.repeat(121))).toThrow('120');
  });
  it('allows the server-supported negative sort order without allowing negative inventory', () => {
    expect(integerInput('-1000000', 'Sort order', -1_000_000)).toBe(-1000000);
    expect(() => integerInput('-1000001', 'Sort order', -1_000_000)).toThrow();
    expect(() => integerInput('-1', 'Capacity')).toThrow();
  });
  it('rejects unsafe slugs and incomplete styling', () => {
    expect(validSlug('premium-monthly')).toBe('premium-monthly');
    expect(() => validSlug('not a slug')).toThrow();
    expect(() => planInput({ ...draft(), color_start: 'url(invalid)' })).toThrow('hex');
    expect(() => planInput({ ...draft(), initial: '' })).toThrow('initial');
  });
  it('normalizes an empty category selection and matches brand metadata limits', () => {
    expect(planInput({ ...draft(), category_id: '', brand_key: 'brand_key-1', initial: 'INITIAL8' })).toMatchObject({ category_id: null, brand_key: 'brand_key-1', initial: 'INITIAL8' });
    expect(() => planInput({ ...draft(), brand_key: 'invalid key' })).toThrow('Brand key');
    expect(() => planInput({ ...draft(), brand_key: 'x'.repeat(81) })).toThrow('Brand key');
    expect(() => planInput({ ...draft(), initial: '123456789' })).toThrow('initial');
  });
  it('links top-up plans to a numeric provider package and keeps seat plans unlinked', () => {
    expect(planInput(draft())).toMatchObject({ kind: 'seat', provider_package_id: null });
    expect(planInput({ ...draft(), kind: 'topup', provider_package_id: '6' })).toMatchObject({ kind: 'topup', provider_package_id: '6' });
    expect(() => planInput({ ...draft(), kind: 'topup', provider_package_id: '' })).toThrow('provider package');
    expect(() => planInput({ ...draft(), kind: 'topup', provider_package_id: 'abc' })).toThrow('provider package');
    expect(() => planInput({ ...draft(), kind: 'seat', provider_package_id: '6' })).toThrow('game top-up');
  });
});
