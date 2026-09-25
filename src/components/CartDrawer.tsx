import { useEffect, useRef } from 'react';
import { IconChevronRight, IconMinus, IconPlus, IconShoppingCart, IconTrash, IconX } from '@tabler/icons-react';
import BrandLogo from './BrandLogo';
import { useCart } from '../cart';
import { formatMoney } from '../lib/money';
import { planPrice } from '../data/products';
import type { Currency } from '../features/api';

export default function CartDrawer({ open, onClose, onCheckout }: { open: boolean; onClose: () => void; onCheckout: () => void }) {
  const { lines, count, subtotalMinor, currency, setCurrency, setQty, acceptPrice, remove, clear } = useCart();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (open && element && !element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={dialog} className="cart-drawer is-open" aria-labelledby="cart-heading" onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      <header className="drawer-head">
        <h2 id="cart-heading"><IconShoppingCart size={22} /> Your Cart {count > 0 && <span className="drawer-count">{count}</span>}</h2>
        <button className="drawer-close" onClick={onClose} aria-label="Close cart"><IconX size={20} /></button>
      </header>
      <label className="currency-selector drawer-currency">Order currency<select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option>USD</option><option>ETB</option></select></label>
      {!lines.length ? <div className="drawer-empty"><IconShoppingCart size={44} /><p>Your cart is empty.</p><span>Add a shared plan to get started!</span></div> : <>
        <ul className="drawer-list">
          {lines.map((line) => {
            const { product: plan, qty, unitMinor } = line;
            const currentPrice = line.current ? planPrice(line.current, currency) : null;
            return (
              <li className="drawer-item" key={plan.id}>
                <BrandLogo product={plan} size={40} />
                <div className="drawer-item-info">
                  <strong>{plan.name}</strong><span>{plan.description}</span>
                  <div className="qty-stepper">
                    <button onClick={() => setQty(plan.id, qty - 1)} aria-label={`Decrease ${plan.name} quantity`}><IconMinus size={14} /></button>
                    <b>{qty}</b>
                    <button disabled={!line.canIncrease} onClick={() => setQty(plan.id, qty + 1)} aria-label={`Increase ${plan.name} quantity`}><IconPlus size={14} /></button>
                  </div>
                  {line.errors.map((error) => <p key={error} className="cart-line-error" role="alert">{error}</p>)}
                  {line.current && currentPrice !== null && currentPrice !== unitMinor && <button className="auth-switch" onClick={() => acceptPrice(plan.id)}>Accept {formatMoney(currentPrice, currency)} per seat</button>}
                </div>
                <div className="drawer-item-side">
                  <span className="drawer-item-price">{unitMinor === null ? 'Unpriced' : Number.isSafeInteger(unitMinor * qty) ? formatMoney(unitMinor * qty, currency) : 'Review amount'}</span>
                  <button className="drawer-item-remove" onClick={() => remove(plan.id)} aria-label={`Remove ${plan.name}`}><IconTrash size={17} /></button>
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="drawer-foot">
          <div className="drawer-subtotal"><span>Order total</span><strong>{subtotalMinor === null ? 'Review prices' : formatMoney(subtotalMinor, currency)}</strong></div>
          <p className="cart-note">Pending orders do not hold seats. Availability is checked again when staff confirms payment.</p>
          <button className="btn drawer-checkout" onClick={onCheckout}>Checkout <IconChevronRight size={20} className="chev" /></button>
          <button className="drawer-clear" onClick={clear}><IconTrash size={16} /> Clear cart</button>
        </footer>
      </>}
    </dialog>
  );
}
