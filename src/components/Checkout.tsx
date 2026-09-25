/* eslint-disable react/only-export-components -- Checkout exposes tested persistence helpers alongside its routed views. */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { IconArrowLeft, IconBrandTelegram, IconChevronRight, IconCircleCheckFilled } from '@tabler/icons-react';
import BrandLogo from './BrandLogo';
import { useCart } from '../cart';
import { useAuth } from '../auth/AuthProvider';
import { currencySchema, DatabaseError, readResource, runCommand, useCommand, useResource } from '../features/api';
import type { OrderDetail } from '../features/api';
import { formatMoney } from '../lib/money';
import { safeTelegramUrl } from '../lib/telegram';
import { planPrice } from '../data/products';

export const playerIdPattern = /^[0-9]{6,20}$/;
const orderItemInput = z.object({
  plan_id: z.string().uuid(), qty: z.number().int().min(1).max(9), unit_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  player_id: z.string().trim().regex(playerIdPattern).optional(),
});
const payloadSchema = z.object({
  idempotency_key: z.string().uuid(), currency: currencySchema,
  name: z.string().trim().min(2).max(120), phone: z.string().trim().min(5).max(40),
  telegram: z.string().trim().max(80), items: z.array(orderItemInput).min(1).max(50)
    .refine((items) => new Set(items.map((item) => item.plan_id)).size === items.length)
    .refine((items) => Number.isSafeInteger(items.reduce((sum, item) => sum + item.qty * item.unit_minor, 0))),
});
const intentSchema = z.object({
  version: z.literal(1), customer_id: z.string().uuid(), payload: payloadSchema,
  state: z.enum(['pending', 'verified', 'rejected']),
  orderId: z.string().uuid().optional(),
  names: z.array(z.string()), createdAt: z.string(),
});
export type CheckoutIntent = z.infer<typeof intentSchema>;
export const intentKey = (customerId: string) => `brenstore.checkout.v1.${customerId}`;

export function loadCheckoutIntent(customerId: string): CheckoutIntent | null {
  const raw = localStorage.getItem(intentKey(customerId));
  if (!raw) return null;
  const intent = intentSchema.parse(JSON.parse(raw));
  if (intent.customer_id !== customerId || (intent.state === 'verified' && !intent.orderId)) throw new Error('The saved order attempt could not be verified. Contact support before trying another order.');
  return intent;
}

export function saveCheckoutIntent(intent: CheckoutIntent): void {
  intentSchema.parse(intent);
  localStorage.setItem(intentKey(intent.customer_id), JSON.stringify(intent));
  if (localStorage.getItem(intentKey(intent.customer_id)) !== JSON.stringify(intent)) throw new Error('Your browser could not save the order attempt. Enable site storage before ordering.');
}

export function verifySavedOrder(detail: OrderDetail, intent: CheckoutIntent): void {
  if (detail.order.customer_id !== intent.customer_id || detail.order.currency !== intent.payload.currency ||
      detail.items.length !== intent.payload.items.length ||
      !intent.payload.items.every((item) => detail.items.some((saved) => saved.plan_id === item.plan_id && saved.qty === item.qty && saved.unit_minor === item.unit_minor && (saved.player_id ?? null) === (item.player_id ?? null))) ||
      detail.order.total_minor !== intent.payload.items.reduce((sum, item) => sum + item.qty * item.unit_minor, 0)) {
    throw new Error('The saved order did not match this checkout attempt. Contact support; do not place a replacement order.');
  }
}

async function checkoutLock<T>(customerId: string, task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Safe checkout needs browser locking. Use an up-to-date browser over HTTPS (or localhost), and enable site storage.');
  return navigator.locks.request(`brenstore.checkout.${customerId}`, task);
}

export default function Checkout() {
  const { user } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const profile = useResource('profile', {}, Boolean(user));
  const catalog = useResource('catalog');
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const active = useRef(true);
  const [contacts, setContacts] = useState({ name: '', phone: '', telegram: '' });
  const [playerIds, setPlayerIds] = useState<Record<string, string>>({});
  const contactChanged = useRef(false);
  const customerId = user?.id ?? '';
  const cartSeats = cart.lines.reduce((sum, line) => sum + line.qty, 0);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    const refresh = () => {
      try { setIntent(loadCheckoutIntent(customerId)); setStorageError(''); }
      catch { setStorageError('The saved checkout attempt cannot be read. Enable site storage or contact support before ordering again. Do not clear browser data if an order may already have been submitted.'); }
    };
    refresh();
    const onStorage = (event: StorageEvent) => { if (event.key === intentKey(customerId)) refresh(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [customerId]);
  useEffect(() => {
    if (profile.data && !contactChanged.current) {
      const { name, phone, telegram } = profile.data;
      setContacts((current) => current.name === name && current.phone === phone && current.telegram === telegram ? current : { name, phone, telegram });
    }
  }, [profile.data]);

  async function placeOrder(event?: React.FormEvent) {
    event?.preventDefault();
    if (submitting.current || !user || storageError) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      await checkoutLock(user.id, async () => {
        let saved = loadCheckoutIntent(user.id);
        if (saved?.state === 'verified') {
          if (active.current) { setIntent(saved); navigate(`/orders/${saved.orderId}`); }
          return;
        }
        if (saved?.state === 'rejected') throw new Error('Review the rejected attempt before submitting a new quote.');
        if (!saved) {
          if (!cart.ready) throw new Error('Review the cart prices and availability before submitting.');
          const payload = payloadSchema.parse({
            idempotency_key: crypto.randomUUID(), currency: cart.currency, ...contacts,
            items: cart.lines.map((line) => ({
              plan_id: line.product.id, qty: line.qty, unit_minor: line.unitMinor,
              ...(line.product.kind === 'topup' ? { player_id: (playerIds[line.product.id] ?? '').trim() } : {}),
            })),
          });
          saved = { version: 1, customer_id: user.id, payload, state: 'pending', names: cart.lines.map((line) => line.product.name), createdAt: new Date().toISOString() };
          // Write BEFORE sending. Unknown failures must retry this exact payload,
          // even after a reload, price change, or edits to the local cart.
          saveCheckoutIntent(saved);
        }
        setIntent(saved);
        let response: { id?: string };
        try { response = await runCommand('create_order', saved.payload); }
        catch (cause) {
          // This constraint rejection is issued only after the server's
          // existing-idempotency lookup. Other failures may hide a saved order.
          if (cause instanceof DatabaseError && cause.code === '23514') {
            const rejected: CheckoutIntent = { ...saved, state: 'rejected' };
            saveCheckoutIntent(rejected); setIntent(rejected);
          }
          throw cause;
        }
        if (!response.id) throw new Error('The server response did not include an order ID. Resolve this attempt using the same saved key.');
        const detail = await readResource('order', { id: response.id });
        verifySavedOrder(detail, saved);
        const verified: CheckoutIntent = { ...saved, state: 'verified', orderId: detail.order.id };
        saveCheckoutIntent(verified);
        if (!active.current) return;
        setIntent(verified);
        cart.clearPurchased(saved.payload.items, saved.payload.currency);
        await cache.invalidateQueries({ queryKey: ['bren'] });
        navigate(`/orders/${detail.order.id}`, { replace: true });
      });
    } catch (cause) {
      setError(cause instanceof z.ZodError ? 'Enter a full name (2–120 characters), phone (5–40 characters), valid cart quantities, and a numeric player ID (6–20 digits) for each top-up.' : cause instanceof Error ? cause.message : 'The order could not be verified. Retry the saved attempt.');
    } finally { submitting.current = false; setBusy(false); }
  }

  async function startNew() {
    if (!user || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      await checkoutLock(user.id, async () => {
        const saved = loadCheckoutIntent(user.id);
        if (saved?.state === 'pending') throw new Error('An unresolved order attempt exists. Resolve it before starting a new order.');
        localStorage.removeItem(intentKey(user.id)); setIntent(null);
      });
      await catalog.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start a new checkout.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <section className="auth">
    <Link className="auth-back" to="/#products"><IconArrowLeft size={18} /> Back to store</Link>
    <div className="auth-card checkout-card">
      <h1 className="auth-title">Checkout</h1>
      <p className="auth-sub">Manual payment · No seats are held until staff confirms payment. Review the currency and each plan's billing period.</p>
      {storageError && <p className="auth-error" role="alert">{storageError}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {intent ? (<>
        {intent.state === 'verified' && cart.lines.length > 0 && <section className="checkout-current-cart store-notice" aria-labelledby="current-cart-heading">
          <h2 id="current-cart-heading">Current cart ({cartSeats} {cartSeats === 1 ? 'seat' : 'seats'})</h2>
          <p>Review these quantities before placing a separate order. This cart does not change your earlier saved order.</p>
          <ul className="checkout-list">
            {cart.lines.map((line) => <li className="success-line" key={line.product.id}>
              <span>{line.qty} × {line.product.name}</span>
              <b>{line.unitMinor === null || !Number.isSafeInteger(line.unitMinor * line.qty) ? 'Review prices' : formatMoney(line.unitMinor * line.qty, cart.currency)}</b>
            </li>)}
          </ul>
          <p className="checkout-cart-total"><span>Cart total</span><b>{cart.subtotalMinor === null ? 'Review prices' : formatMoney(cart.subtotalMinor, cart.currency)}</b></p>
          <button className="btn auth-submit" disabled={busy || Boolean(storageError)} onClick={() => void startNew()}>Review this cart</button>
        </section>}
        <section className="checkout-attempt" aria-labelledby="checkout-attempt-heading">
          <h2 id="checkout-attempt-heading">{intent.state === 'pending' ? 'Resolve your previous attempt' : intent.state === 'verified' ? 'Previous order — already saved' : 'Order attempt rejected'}</h2>
          <p>{intent.state === 'pending' ? 'The result may be unknown. Retry only this saved request, regardless of changes to your cart. No replacement order can be created until this attempt is resolved.' : intent.state === 'verified' ? 'This is your earlier order, not your current cart. Saved does not mean paid: open the order to check its payment and fulfillment status.' : 'The server definitively rejected this transaction. Review current prices and availability before making a new attempt.'}</p>
          <ul className="checkout-list">{intent.payload.items.map((item, index) => <li className="success-line" key={item.plan_id}><span>{item.qty} × {intent.names[index] ?? item.plan_id}</span><b>{formatMoney(item.unit_minor * item.qty, intent.payload.currency)}</b></li>)}</ul>
          <p>Contact: {intent.payload.name} · {intent.payload.phone}</p>
          <p className="cart-note">Saved attempt: <code>{intent.payload.idempotency_key}</code></p>
          {intent.state === 'pending' ? <button className="btn auth-submit" disabled={busy || Boolean(storageError)} onClick={() => void placeOrder()}>{busy ? 'Resolving saved order…' : 'Resolve saved order attempt'}</button> : <>
            {intent.orderId && <Link className="btn auth-submit" to={`/orders/${intent.orderId}`}>View saved order</Link>}
            {intent.state === 'rejected' && <button className="auth-guest" disabled={busy || Boolean(storageError)} onClick={() => void startNew()}>Review cart for a new attempt</button>}
            {intent.state === 'verified' && cart.lines.length === 0 && <Link className="auth-guest" to="/#products">Shop for another order</Link>}
          </>}
        </section>
      </>) : !cart.lines.length ? <p className="auth-sub">Your cart is empty. <Link to="/#products">Browse available plans</Link>.</p> : <>
        <label className="currency-selector">Order currency<select value={cart.currency} disabled={busy} onChange={(e) => cart.setCurrency(e.target.value === 'ETB' ? 'ETB' : 'USD')}><option>USD</option><option>ETB</option></select></label>
        <ul className="checkout-list">
          {cart.lines.map((line) => <li className="checkout-line" key={line.product.id}>
            <BrandLogo product={line.product} size={40} />
            <div className="checkout-line-info"><strong>{line.product.name}</strong><span>{line.qty} × {line.unitMinor === null ? 'Unpriced' : formatMoney(line.unitMinor, cart.currency)} · {line.product.kind === 'topup' ? 'one-time top-up' : `${line.product.billing_days} days`}</span>
              {line.product.kind === 'topup' && <label className="auth-field checkout-player"><span>Free Fire player ID</span>
                <input name={`player-${line.product.id}`} type="text" inputMode="numeric" autoComplete="off" required
                  minLength={6} maxLength={20} pattern="[0-9]{6,20}" placeholder="Numbers only, e.g. 2345678901"
                  aria-label={`Free Fire player ID for ${line.product.name}`}
                  value={playerIds[line.product.id] ?? ''} disabled={busy}
                  onChange={(e) => setPlayerIds({ ...playerIds, [line.product.id]: e.target.value.replace(/\D/g, '').slice(0, 20) })} />
                <small>Delivery goes to this exact ID — double-check it before ordering.</small>
              </label>}
              {line.errors.map((problem) => <p className="cart-line-error" role="alert" key={problem}>{problem}</p>)}
              {line.current && planPrice(line.current, cart.currency) !== null && planPrice(line.current, cart.currency) !== line.unitMinor && <button className="auth-switch" disabled={busy} onClick={() => cart.acceptPrice(line.product.id)}>Accept {formatMoney(planPrice(line.current, cart.currency)!, cart.currency)} per seat</button>}
              <div className="checkout-line-actions"><button className="auth-switch" disabled={busy} onClick={() => cart.setQty(line.product.id, line.qty - 1)}>Reduce quantity</button><button className="auth-switch" disabled={busy} onClick={() => cart.remove(line.product.id)}>Remove</button></div>
            </div>
            <b>{line.unitMinor === null ? '—' : Number.isSafeInteger(line.unitMinor * line.qty) ? formatMoney(line.unitMinor * line.qty, cart.currency) : 'Review amount'}</b>
          </li>)}
          <li className="checkout-line checkout-total"><span>Order total</span><b>{cart.subtotalMinor === null ? 'Review prices' : formatMoney(cart.subtotalMinor, cart.currency)}</b></li>
        </ul>
        {catalog.isError && <button className="auth-switch" onClick={() => void catalog.refetch()}>Retry catalog</button>}
        {profile.isError && <p className="store-notice">Saved contacts could not be loaded. Enter them below, or <button className="auth-switch" onClick={() => void profile.refetch()}>retry your profile</button>.</p>}
        <form className="auth-form" onSubmit={(e) => void placeOrder(e)}>
          {(['name', 'phone', 'telegram'] as const).map((key) => <label className="auth-field" key={key}><span>{key === 'name' ? 'Full name' : key === 'phone' ? 'Phone' : 'Telegram username (optional)'}</span><input name={key} type={key === 'phone' ? 'tel' : 'text'} autoComplete={key === 'name' ? 'name' : key === 'phone' ? 'tel' : 'off'} required={key !== 'telegram'} minLength={key === 'name' ? 2 : key === 'phone' ? 5 : undefined} maxLength={key === 'name' ? 120 : key === 'phone' ? 40 : 80} value={contacts[key]} disabled={busy} onChange={(e) => { contactChanged.current = true; setContacts({ ...contacts, [key]: e.target.value }); }} /></label>)}
          <button type="submit" className="btn auth-submit" disabled={!cart.ready || busy || Boolean(storageError)}>{busy ? 'Saving order…' : 'Place pending order'}<IconChevronRight size={20} className="chev" /></button>
        </form>
      </>}
      <Link className="auth-guest" to="/orders">View my saved orders</Link>
    </div>
  </section>;
}

const deliveryStatusLabels: Record<OrderDetail['deliveries'][number]['status'], string> = {
  queued: 'Queued for delivery',
  processing: 'Delivering…',
  delivered: 'Delivered',
  failed: 'Delivery issue — our team has been notified',
};

export function OrderPage() {
  const { id = '' } = useParams();
  const validId = z.string().uuid().safeParse(id).success;
  const order = useResource('order', { id }, validId);
  const instructions = useResource('payment_instructions');
  const detail = order.data;
  const telegram = safeTelegramUrl(instructions.data?.telegram_url, detail?.order.reference);
  const isTopup = Boolean(detail?.items.some((item) => item.player_id));
  return <section className="auth"><div className="auth-card checkout-card">
    {!validId ? <p className="auth-error" role="alert">Invalid order link.</p> : order.isPending ? <p role="status">Loading your saved order…</p> : order.isError ? <><h1 className="auth-title">Order unavailable</h1><p className="auth-error" role="alert">{order.error.message}</p><button className="btn" onClick={() => void order.refetch()}>Retry order</button></> : detail && <>
      <IconCircleCheckFilled size={56} className="success-icon" />
      <h1 className="auth-title">Saved Order</h1>
      <p className="auth-sub">Reference <code className="order-id">{detail.order.reference}</code></p>
      <dl className="order-facts"><div><dt>Order status</dt><dd>{detail.order.status}</dd></div><div><dt>Payment</dt><dd>{detail.order.payment_status}</dd></div><div><dt>Placed</dt><dd>{new Date(detail.order.created_at).toLocaleString()}</dd></div></dl>
      <div className="success-summary">
        {detail.items.map((item) => <div className="success-line" key={item.id}><span>{item.qty} × {item.name}<small className="order-term">{item.player_id ? `Player ID ${item.player_id} · ${formatMoney(item.unit_minor, detail.order.currency)} each` : `${item.billing_days} days · ${formatMoney(item.unit_minor, detail.order.currency)} per seat`}</small></span><b>{formatMoney(item.unit_minor * item.qty, detail.order.currency)}</b></div>)}
        <div className="success-line success-total"><span>Total</span><b>{formatMoney(detail.order.total_minor, detail.order.currency)}</b></div>
      </div>
      {detail.deliveries.length > 0 && <div className="delivery-status" aria-label="Top-up delivery status">
        <h2>Top-up delivery</h2>
        <ul className="checkout-list">
          {detail.deliveries.map((delivery) => <li className="success-line" key={delivery.id}>
            <span>{delivery.package_name} · unit {delivery.unit_index} · player {delivery.player_id}</span>
            <b>{deliveryStatusLabels[delivery.status]}</b>
          </li>)}
        </ul>
        {detail.deliveries.some((delivery) => delivery.status === 'failed') && <p className="store-notice">A delivery could not be completed. Staff has the details and will resolve or refund it — contact us with your order reference if needed.</p>}
      </div>}
      <p>{detail.order.customer_name} · {detail.order.phone}{detail.order.telegram ? ` · ${detail.order.telegram}` : ''}</p>
      {detail.order.status === 'pending' && <>
        <p className="store-notice">{isTopup
          ? 'This pending order has not been delivered yet. Contact staff with the reference before paying; the top-up is delivered automatically to the player ID above once staff confirms payment.'
          : 'This pending order does not reserve seats. Contact staff with the reference before paying; availability is checked when staff confirms payment. Payment and access are not automated.'}</p>
        <h2>Payment instructions</h2>
        {instructions.isPending ? <p role="status">Loading instructions…</p> : instructions.isError ? <><p className="auth-error" role="alert">Payment instructions unavailable: {instructions.error.message}</p><button className="auth-switch" onClick={() => void instructions.refetch()}>Retry instructions</button></> : <p className="payment-instructions">{instructions.data.manual_payment_instructions || 'Payment instructions have not been configured. Do not send payment until staff provides verified instructions.'}</p>}
      </>}
      {detail.payment && <p>Confirmed payment: {formatMoney(detail.payment.amount_minor, detail.payment.currency)} · Reference {detail.payment.reference}</p>}
      {telegram && <a className="btn auth-submit" href={telegram} target="_blank" rel="noreferrer"><IconBrandTelegram size={20} /> Contact staff with this reference</a>}
      <button className="auth-guest" disabled={order.isFetching} onClick={() => void order.refetch()}>{order.isFetching ? 'Refreshing…' : 'Refresh order status'}</button>
    </>}
    <Link className="auth-guest" to="/orders">My orders</Link><Link className="auth-guest" to="/#products">Back to store</Link>
  </div></section>;
}

function CustomerProfile() {
  const profile = useResource('profile');
  const command = useCommand();
  const [saved, setSaved] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaved(false);
    const fields = new FormData(event.currentTarget);
    try {
      await command.mutateAsync({ action: 'save_profile', input: { name: String(fields.get('name')).trim(), phone: String(fields.get('phone')).trim(), telegram: String(fields.get('telegram')).trim() } });
      setSaved(true);
    } catch { /* The mutation error is rendered below without losing input. */ }
  }
  return <details className="profile-panel"><summary>My contact details</summary>
    {profile.isPending ? <p role="status">Loading profile…</p> : profile.isError ? <><p className="auth-error" role="alert">{profile.error.message}</p><button className="auth-switch" onClick={() => void profile.refetch()}>Retry profile</button></> : <form className="auth-form" onSubmit={(event) => void save(event)}>
      <p>{profile.data.email}</p>
      <label className="auth-field"><span>Full name</span><input name="name" required minLength={2} maxLength={120} defaultValue={profile.data.name} autoComplete="name" /></label>
      <label className="auth-field"><span>Phone</span><input name="phone" type="tel" maxLength={40} defaultValue={profile.data.phone} autoComplete="tel" /></label>
      <label className="auth-field"><span>Telegram username</span><input name="telegram" maxLength={80} defaultValue={profile.data.telegram} /></label>
      {command.isError && <p className="auth-error" role="alert">{command.error.message}</p>}
      {saved && <p role="status">Contact details saved. Existing order snapshots are unchanged.</p>}
      <button className="btn" disabled={command.isPending}>{command.isPending ? 'Saving…' : 'Save contact details'}</button>
    </form>}
  </details>;
}

export function MyOrders() {
  const [page, setPage] = useState(1);
  const orders = useResource('my_orders', { page, page_size: 10 });
  return <section className="auth"><div className="auth-card checkout-card">
    <h1 className="auth-title">My Orders</h1>
    <CustomerProfile />
    {orders.isPending ? <p role="status">Loading orders…</p> : orders.isError ? <><p className="auth-error" role="alert">Orders unavailable: {orders.error.message}</p><button className="btn" onClick={() => void orders.refetch()}>Retry orders</button></> : !orders.data.rows.length ? <p>No orders yet. <Link to="/#products">Find your first plan</Link>.</p> : <>
      <ul className="customer-orders">{orders.data.rows.map((order) => <li key={order.id}><Link to={`/orders/${order.id}`}><strong>{order.reference}</strong><span>{new Date(order.created_at).toLocaleDateString()} · {order.status} · payment {order.payment_status}</span><b>{formatMoney(order.total_minor, order.currency)}</b></Link></li>)}</ul>
      <div className="order-pagination"><button className="auth-switch" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {orders.data.total} orders</span><button className="auth-switch" disabled={page * 10 >= orders.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
    </>}
    <Link className="auth-guest" to="/checkout">Checkout / resolve a saved attempt</Link>
    <Link className="auth-guest" to="/#products">Back to store</Link>
  </div></section>;
}
