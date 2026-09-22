import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PRODUCTS } from './data/products';
import type { Product } from './data/products';

export const TELEGRAM_URL = 'https://t.me/brenstorebot';
export const TELEGRAM_HANDLE = '@brenstorebot';

export interface CartLine {
  product: Product;
  qty: number;
}

interface CartApi {
  lines: CartLine[];
  count: number;
  subtotalEur: number;
  add: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [qtys, setQtys] = useState<Record<string, number>>({});

  const api = useMemo<CartApi>(() => {
    const lines = Object.entries(qtys)
      .map(([id, qty]) => ({
        product: PRODUCTS.find((p) => p.id === id) as Product,
        qty,
      }))
      .filter((l) => l.product && l.qty > 0);

    return {
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      subtotalEur: lines.reduce((s, l) => s + l.product.price * l.qty, 0),
      add: (id) => setQtys((q) => ({ ...q, [id]: (q[id] ?? 0) + 1 })),
      setQty: (id, qty) =>
        setQtys((q) => {
          const next = { ...q };
          if (qty <= 0) delete next[id];
          else next[id] = Math.min(qty, 9);
          return next;
        }),
      remove: (id) =>
        setQtys((q) => {
          const next = { ...q };
          delete next[id];
          return next;
        }),
      clear: () => setQtys({}),
    };
  }, [qtys]);

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
