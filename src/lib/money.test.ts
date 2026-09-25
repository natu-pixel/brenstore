import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney, priceInput } from './money';

describe('independent currency amounts', () => {
  it('parses decimal strings into exact integer minor units', () => {
    expect(parseMoney('4.99')).toBe(499);
    expect(parseMoney('1200.5')).toBe(120050);
    expect(parseMoney(' 0.01 ')).toBe(1);
  });
  it.each(['', '0', '-2', '1.001', '1e3', 'Infinity', 'NaN', '1,000', '1000000000'])('rejects invalid amount %s', (value) => {
    expect(() => parseMoney(value)).toThrow();
  });
  it('formats prices without conversion', () => {
    expect(formatMoney(499, 'USD')).toContain('4.99');
    expect(formatMoney(85000, 'ETB')).toContain('850.00');
    expect(priceInput(null)).toBe('');
    expect(priceInput(1)).toBe('0.01');
  });
  it('rejects unsafe output instead of producing a misleading total', () => {
    expect(() => formatMoney(1.2, 'USD')).toThrow();
    expect(() => formatMoney(-1, 'ETB')).toThrow();
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow();
  });
});
