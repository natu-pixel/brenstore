/* eslint-disable react/only-export-components -- The shared cart includes its provider, hook, and tested state helpers. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { currencySchema, planSchema, useResource } from './features/api';
import type { Currency, Plan } from './features/api';
import { planPrice } from './data/products';

export const CART_KEY = 'brenstore.cart.v1';
export const MAX_QUANTITY = 9;
export const MAX_LINES = 50;
const storedLineSchema = z.object({ product: planSchema, qty: z.number().int().min(1).max(MAX_QUANTITY) });
const cartSchema = z.object({
  version: z.literal(1),
  currency: currencySchema,
  items: z.array(storedLineSchema).max(MAX_LINES).refine((items) => new Set(items.map((item) => item.product.id)).size === items.length),
});
export type StoredLine = z.infer<typeof storedLineSchema>;
export type CartState = z.infer<typeof cartSchema>;
export interface CartLine extends StoredLine {
  current: Plan | undefined;
  unitMinor: number | null;
  errors: string[];
  canIncrease: boolean;
}
const emptyCart = (): CartState => ({ version: 1, currency: 'USD', items: [] });

export function parseCart(raw: string | null): CartState {
  if (!raw) return emptyCart();
  return cartSchema.parse(JSON.parse(raw));
}

export function cartLine(item: StoredLine, catalog: Plan[] | undefined, currency: Currency, catalogError = false): CartLine {
  const current = catalog?.find((plan) => plan.id === item.product.id);
  const errors: string[] = [];
  const unitMinor = planPrice(item.product, currency);
  if (catalogError) errors.push('Availability could not be verified. Retry loading the catalog.');
  else if (!catalog) errors.push('Checking current availability…');
  else if (!current || current.status !== 'active') errors.push('This plan is no longer available. Remove it to continue.');
  else {
    if (current.kind !== 'topup' && (current.available ?? 0) < item.qty) errors.push(`Only ${current.available ?? 0} seats available. Reduce quantity or remove this plan.`);
    if (planPrice(current, currency) !== unitMinor) errors.push('The price has changed. Review and accept the current price.');
  }
  if (unitMinor === null) errors.push(`This plan has no ${currency} price.`);
  else if (!Number.isSafeInteger(unitMinor * item.qty)) errors.push('This line total exceeds the supported amount. Reduce the quantity or remove this plan.');
  return {
    ...item, current, unitMinor, errors,
    canIncrease: errors.length === 0 && item.qty < MAX_QUANTITY
      && (current?.kind === 'topup' || item.qty < (current?.available ?? 0)),
  };
}

export function addCartItem(state: CartState, plan: Plan): CartState {
  const existing = state.items.find((item) => item.product.id === plan.id);
  if (plan.status !== 'active' || planPrice(plan, state.currency) === null) throw new Error('This plan is unavailable in the selected currency.');
  if (state.items.some((item) => item.product.kind !== plan.kind)) throw new Error(
    plan.kind === 'topup'
      ? 'Game top-ups are ordered separately. Clear the subscription plans from your cart first.'
      : 'Subscription plans are ordered separately. Clear the game top-ups from your cart first.',
  );
  if (existing && planPrice(existing.product, state.currency) !== planPrice(plan, state.currency)) throw new Error('Review the changed price in your cart before adding more.');
  const cap = plan.kind === 'topup' ? MAX_QUANTITY : Math.min(MAX_QUANTITY, plan.available ?? 0);
  if ((existing?.qty ?? 0) >= cap) throw new Error(plan.kind === 'topup'
    ? `You can add at most ${MAX_QUANTITY} units per top-up plan.`
    : `You can add at most ${cap} currently available seats per plan.`);
  if (!existing && state.items.length >= MAX_LINES) throw new Error('An order can contain at most 50 different plans.');
  const total = state.items.reduce((sum, item) => sum + (planPrice(item.product, state.currency) ?? 0) * item.qty, 0) + (planPrice(plan, state.currency) ?? 0);
  if (!Number.isSafeInteger(total)) throw new Error('The cart total exceeds the supported monetary amount.');
  return {
    ...state,
    items: existing
      ? state.items.map((item) => item.product.id === plan.id ? { ...item, qty: item.qty + 1 } : item)
      : [...state.items, { product: plan, qty: 1 }],
  };
}

interface CartApi {
  lines: CartLine[];
  count: number;
  subtotalMinor: number | null;
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  add: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  acceptPrice: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  clearPurchased: (items: { plan_id: string; qty: number; unit_minor: number }[], currency: Currency) => void;
  error: string | null;
  dismissError: () => void;
  ready: boolean;
}
const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try { return { state: parseCart(localStorage.getItem(CART_KEY)), error: null }; }
    catch { return { state: emptyCart(), error: 'Your saved cart could not be read. Please review and rebuild it before ordering.' }; }
  });
  const [state, setState] = useState<CartState>(initial.state);
  const [error, setError] = useState<string | null>(initial.error);
  const catalog = useResource('catalog');
  const update = useCallback((change: (current: CartState) => CartState) => {
    setState((current) => {
      try {
        const next = change(current);
        try { localStorage.setItem(CART_KEY, JSON.stringify(next)); }
        catch { setError('Your browser could not save the cart. Enable site storage before navigating away.'); }
        return next;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not change the cart.');
        return current;
      }
    });
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== CART_KEY) return;
      try { setState(parseCart(event.newValue)); }
      catch { setError('The saved cart changed but could not be read. Reload and review your cart.'); }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const lines = useMemo(() => state.items.map((item) => cartLine(item, catalog.data, state.currency, catalog.isError)), [state, catalog.data, catalog.isError]);
  const total = lines.reduce((sum, line) => sum + (line.unitMinor ?? 0) * line.qty, 0);
  const subtotalMinor = lines.some((line) => line.unitMinor === null) || !Number.isSafeInteger(total) ? null : total;

  const api: CartApi = {
    lines, count: lines.reduce((sum, line) => sum + line.qty, 0), subtotalMinor, currency: state.currency,
    setCurrency: (currency) => update((current) => ({ ...current, currency })),
    add: (id) => {
      const plan = catalog.data?.find((item) => item.id === id);
      if (!plan || catalog.isError) { setError('The catalog is unavailable. Retry before adding a plan.'); return; }
      update((current) => addCartItem(current, plan));
    },
    setQty: (id, qty) => update((current) => {
      const item = current.items.find((line) => line.product.id === id);
      if (!item) return current;
      if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QUANTITY) throw new Error('Choose a quantity from 1 to 9.');
      if (qty > item.qty) {
        const line = cartLine(item, catalog.data, current.currency, catalog.isError);
        if (!line.canIncrease || (line.current?.kind !== 'topup' && qty > (line.current?.available ?? 0))) throw new Error('Cannot increase quantity. Review the availability and price in your cart.');
      }
      return { ...current, items: current.items.flatMap((line) => line.product.id !== id ? [line] : qty === 0 ? [] : [{ ...line, qty }]) };
    }),
    acceptPrice: (id) => update((current) => {
      const plan = catalog.data?.find((item) => item.id === id && item.status === 'active');
      if (!plan || catalog.isError) throw new Error('Reload the catalog before accepting a price.');
      return { ...current, items: current.items.map((item) => item.product.id === id ? { ...item, product: plan } : item) };
    }),
    remove: (id) => update((current) => ({ ...current, items: current.items.filter((line) => line.product.id !== id) })),
    clear: () => update((current) => ({ ...current, items: [] })),
    clearPurchased: (items, currency) => update((current) => ({
      ...current,
      items: current.items.flatMap((line) => {
        const purchased = items.find((item) => item.plan_id === line.product.id && item.unit_minor === planPrice(line.product, currency));
        if (!purchased) return [line];
        const qty = line.qty - purchased.qty;
        return qty > 0 ? [{ ...line, qty }] : [];
      }),
    })),
    error, dismissError: () => setError(null),
    ready: lines.length > 0 && subtotalMinor !== null && lines.every((line) => line.errors.length === 0) && !catalog.isFetching,
  };
  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
