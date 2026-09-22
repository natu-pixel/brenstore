import { useState } from 'react';
import {
  IconArrowLeft,
  IconBrandTelegram,
  IconChevronRight,
  IconCircleCheckFilled,
} from '@tabler/icons-react';
import BrandLogo from './BrandLogo';
import { TELEGRAM_HANDLE, TELEGRAM_URL, useCart } from '../cart';
import { fmtETB } from '../data/currency';
import type { CartLine } from '../cart';

interface PlacedOrder {
  id: string;
  lines: CartLine[];
  totalEur: number;
  name: string;
}

export default function Checkout({ onBack }: { onBack: () => void }) {
  const { lines, subtotalEur, clear } = useCart();
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  const placeOrder = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const id = 'BRN-' + Date.now().toString(36).toUpperCase().slice(-6);
    setPlaced({
      id,
      lines,
      totalEur: subtotalEur,
      name: String(data.get('name') ?? ''),
    });
    clear();
  };

  if (placed) {
    return (
      <section className="auth">
        <div className="auth-card checkout-success">
          <IconCircleCheckFilled size={64} className="success-icon" />
          <h1 className="auth-title">Order Placed!</h1>
          <p className="auth-sub">
            Thanks{placed.name ? `, ${placed.name.split(' ')[0]}` : ''}! Your
            order <code className="order-id">{placed.id}</code> is in. Confirm
            and pay through our Telegram bot to activate your plans.
          </p>
          <div className="success-summary">
            {placed.lines.map(({ product: p, qty }) => (
              <div className="success-line" key={p.id}>
                <span>
                  {qty} × {p.name}
                </span>
                <b>{fmtETB(p.price * qty)}</b>
              </div>
            ))}
            <div className="success-line success-total">
              <span>Total / month</span>
              <b>{fmtETB(placed.totalEur)}</b>
            </div>
          </div>
          <a
            className="btn auth-submit"
            href={`${TELEGRAM_URL}?start=${placed.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <IconBrandTelegram size={20} stroke={2} /> Confirm on Telegram
          </a>
          <button className="auth-switch success-back" onClick={onBack}>
            Back to store
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="auth">
      <button className="auth-back" onClick={onBack}>
        <IconArrowLeft size={18} stroke={2.4} /> Back to store
      </button>

      <div className="auth-card checkout-card">
        <h1 className="auth-title">Checkout</h1>

        {lines.length === 0 ? (
          <p className="auth-sub">
            Your cart is empty — add a plan first, or order anything else via{' '}
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">
              {TELEGRAM_HANDLE}
            </a>
            .
          </p>
        ) : (
          <>
            <p className="auth-sub">
              Review your plans and drop your contact — we confirm every order
              on Telegram.
            </p>

            <ul className="checkout-list">
              {lines.map(({ product: p, qty }) => (
                <li className="checkout-line" key={p.id}>
                  <BrandLogo product={p} size={40} />
                  <div className="checkout-line-info">
                    <strong>{p.name}</strong>
                    <span>
                      {qty} × {fmtETB(p.price)}
                    </span>
                  </div>
                  <b>{fmtETB(p.price * qty)}</b>
                </li>
              ))}
              <li className="checkout-line checkout-total">
                <span>Total / month</span>
                <b>{fmtETB(subtotalEur)}</b>
              </li>
            </ul>

            <form className="auth-form" onSubmit={placeOrder}>
              <label className="auth-field">
                <span>Full name</span>
                <input name="name" type="text" placeholder="Abebe Bikila" required />
              </label>
              <label className="auth-field">
                <span>Phone</span>
                <input
                  name="phone"
                  type="tel"
                  placeholder="+251 9XX XXX XXX"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Telegram username</span>
                <input name="telegram" type="text" placeholder="@username" />
              </label>
              <button type="submit" className="btn auth-submit">
                Place Order
                <IconChevronRight size={20} stroke={2.8} className="chev" />
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
