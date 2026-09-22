import {
  IconChevronRight,
  IconMinus,
  IconPlus,
  IconShoppingCart,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import BrandLogo from './BrandLogo';
import { useCart } from '../cart';
import { fmtETB } from '../data/currency';

export default function CartDrawer({
  open,
  onClose,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const { lines, count, subtotalEur, setQty, remove, clear } = useCart();

  return (
    <>
      <div
        className={'drawer-overlay' + (open ? ' is-open' : '')}
        onClick={onClose}
      />
      <aside className={'cart-drawer' + (open ? ' is-open' : '')} aria-label="Cart">
        <header className="drawer-head">
          <h2>
            <IconShoppingCart size={22} stroke={2.4} /> Your Cart
            {count > 0 && <span className="drawer-count">{count}</span>}
          </h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close cart">
            <IconX size={20} stroke={2.4} />
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="drawer-empty">
            <IconShoppingCart size={44} stroke={1.6} />
            <p>Your cart is empty.</p>
            <span>Add a shared plan to get started!</span>
          </div>
        ) : (
          <>
            <ul className="drawer-list">
              {lines.map(({ product: p, qty }) => (
                <li className="drawer-item" key={p.id}>
                  <BrandLogo product={p} size={44} />
                  <div className="drawer-item-info">
                    <strong>{p.name}</strong>
                    <span>{p.plan}</span>
                    <div className="qty-stepper">
                      <button
                        onClick={() => setQty(p.id, qty - 1)}
                        aria-label={`Decrease ${p.name} quantity`}
                      >
                        <IconMinus size={14} stroke={2.6} />
                      </button>
                      <b>{qty}</b>
                      <button
                        onClick={() => setQty(p.id, qty + 1)}
                        aria-label={`Increase ${p.name} quantity`}
                      >
                        <IconPlus size={14} stroke={2.6} />
                      </button>
                    </div>
                  </div>
                  <div className="drawer-item-side">
                    <span className="drawer-item-price">
                      {fmtETB(p.price * qty)}
                    </span>
                    <button
                      className="drawer-item-remove"
                      onClick={() => remove(p.id)}
                      aria-label={`Remove ${p.name}`}
                    >
                      <IconTrash size={17} stroke={2} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <footer className="drawer-foot">
              <div className="drawer-subtotal">
                <span>Subtotal / month</span>
                <strong>{fmtETB(subtotalEur)}</strong>
              </div>
              <button className="btn drawer-checkout" onClick={onCheckout}>
                Checkout <IconChevronRight size={20} stroke={2.8} className="chev" />
              </button>
              <button className="drawer-clear" onClick={clear}>
                <IconTrash size={16} stroke={2} /> Clear cart
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
