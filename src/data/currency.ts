/** Conversion rates to Ethiopian Birr. */
export const EUR_TO_ETB = 205;
export const USD_TO_ETB = 195;

/** Convert an amount to ETB and format it, e.g. "ETB 1,023". */
export function fmtETB(amount: number, from: 'EUR' | 'USD' = 'EUR'): string {
  const rate = from === 'EUR' ? EUR_TO_ETB : USD_TO_ETB;
  return 'ETB ' + Math.round(amount * rate).toLocaleString('en-US');
}
