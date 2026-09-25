import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import type { Currency, Order, OrderDetail, TopupProcessResult } from '../features/api';
import { processTopupDeliveries, useCommand, useResource } from '../features/api';
import { formatMoney, parseMoney, priceInput } from '../lib/money';
import { AsyncState, Badge, CheckField, Dialog, EmptyState, ErrorNotice, Field, FormFooter, NoteForm, PageHeading, Pagination, ReasonDialog, SearchBox, Table } from './shared';
import { useListFilters } from './hooks';
import { canManage, dateTime, shortId, titleCase } from './utils';

export function OrderTable({ orders }: { orders: Order[] }) {
  return <Table label="Orders" columns={['Order', 'Customer', 'Date', 'Total', 'Payment', 'Order status']}>
    {orders.map(order => <tr key={order.id}><td><Link to={`/admin/orders/${order.id}`} className="admin-strong-link">{order.reference}</Link></td>
      <td>{order.customer_name}</td><td>{dateTime(order.created_at)}</td><td className="admin-numeric">{formatMoney(order.total_minor, order.currency)}</td>
      <td><Badge value={order.payment_status} /></td><td><Badge value={order.status} /></td></tr>)}
  </Table>;
}

export function OrdersPage() {
  const filters = useListFilters();
  const result = useResource('orders', filters.args);
  return <><PageHeading title="Orders" description="Verify payments, deliver access, and keep a clear operational history." />
    <section className="admin-panel"><div className="admin-toolbar"><SearchBox query={filters.query} onSearch={value => filters.setFilter('query', value)} placeholder="Search reference or customer" />
      <label className="admin-inline-field">Order status<select value={filters.status} onChange={event => filters.setFilter('status', event.target.value)}>
        <option value="">All statuses</option><option value="pending">Pending payment</option><option value="paid">Paid / awaiting fulfillment</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option>
      </select></label></div>
      <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
        {result.data && (result.data.rows.length ? <OrderTable orders={result.data.rows} /> : <EmptyState title={filters.query || filters.status ? 'No matching orders' : 'No orders yet'}>Customer orders will appear here after a successful checkout submission.</EmptyState>)}
        {result.data && <Pagination page={result.data.page} total={result.data.total} pageSize={result.data.page_size} onPage={page => filters.setFilter('page', String(page))} />}
      </AsyncState>
    </section></>;
}

export function PaymentDialog({ order, topup = false, onClose }: { order: Order; topup?: boolean; onClose: () => void }) {
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState(priceInput(order.total_minor));
  const [currency, setCurrency] = useState<Currency>(order.currency);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [delivery, setDelivery] = useState<TopupProcessResult | null>(null);
  const [delivering, setDelivering] = useState(false);
  const command = useCommand();
  const cache = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (command.isPending || delivering) return;
    setError(null);
    try {
      const minor = parseMoney(amount);
      if (minor !== order.total_minor || currency !== order.currency) throw new Error(`The received amount and currency must match ${formatMoney(order.total_minor, order.currency)} exactly. Resolve any discrepancy before confirming.`);
      if (!reference.trim()) throw new Error('Enter the external payment reference.');
      if (!verified) throw new Error('Verify the external payment before confirming.');
      await command.mutateAsync({ action: 'confirm_payment', input: { id: order.id, reference: reference.trim(), amount_minor: minor, currency } });
      if (!topup) { onClose(); return; }
      // Payment is saved; delivery now runs against the provider. Keep the dialog
      // open so the outcome is explicit instead of hidden behind a closed dialog.
      setDelivering(true);
      try {
        const result = await processTopupDeliveries(order.id, false);
        setDelivery(result);
      } catch (cause) {
        setError(new Error(`Payment confirmed and deliveries queued, but the provider run could not start: ${cause instanceof Error ? cause.message : 'unknown error'}. Use the delivery panel on this page to process them.`));
      } finally {
        setDelivering(false);
        await cache.invalidateQueries({ queryKey: ['bren'] });
      }
    } catch (cause) { setError(cause); }
  }
  if (delivery) {
    return <Dialog title="Payment confirmed — top-up delivery" onClose={onClose} busy={false}>
      <div className="admin-dialog-body">
        <p className="admin-callout">{delivery.message}</p>
        <p className="admin-muted">Delivered {delivery.delivered} · failed {delivery.failed} · still processing {delivery.open}. Every unit is recorded on the order timeline; failed units can be retried from the delivery panel.</p>
        <div className="admin-row-actions"><button className="admin-button admin-button-primary" onClick={onClose}>Close</button></div>
      </div>
    </Dialog>;
  }
  return <Dialog title="Confirm manual payment" onClose={onClose} dirty={Boolean(reference) || verified || amount !== priceInput(order.total_minor) || currency !== order.currency} busy={command.isPending || delivering}>
    <form onSubmit={submit}><fieldset className="admin-dialog-body" disabled={command.isPending || delivering}>
      <div className="admin-callout"><strong>{order.reference} · {formatMoney(order.total_minor, order.currency)}</strong><p>{topup
        ? 'Confirm only after checking the received payment outside Brenstore. This records payment and immediately starts automatic top-up delivery to the player ID on the order.'
        : 'Confirm only after checking the received payment outside Brenstore. This records payment and allocates all seats atomically. It does not deliver access or charge a payment method.'}</p></div>
      <Field label="External payment reference"><input autoFocus required maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></Field>
      <div className="admin-form-grid"><Field label="Verified amount"><input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        <Field label="Received currency"><select value={currency} onChange={event => setCurrency(event.target.value as Currency)}><option value="USD">USD</option><option value="ETB">ETB</option></select></Field></div>
      <CheckField label={topup
        ? 'I verified this payment and understand that confirmation starts paid top-up delivery and cannot be undone by cancelling the order.'
        : 'I verified this payment and understand that confirmation allocates seats and cannot be undone by cancelling the order.'} checked={verified} required onChange={setVerified} />
      <p className="admin-muted">{topup
        ? 'Delivery is charged to the store provider balance. Failed deliveries return their points automatically and can be retried.'
        : 'If any seat is unavailable, confirmation fails without partially allocating the order. Never confirm an unreceived payment to hold seats.'}</p>
      {Boolean(error) && <ErrorNotice error={error} />}</fieldset><FormFooter busy={command.isPending || delivering} label={delivering ? 'Payment saved — delivering…' : 'Confirm verified payment'} /></form>
  </Dialog>;
}

function TopupPanel({ detail, manage }: { detail: OrderDetail; manage: boolean }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const open = detail.deliveries.filter((delivery) => delivery.status === 'queued' || delivery.status === 'processing').length;
  const failed = detail.deliveries.filter((delivery) => delivery.status === 'failed').length;
  async function process(retryFailed: boolean) {
    if (busy) return;
    setBusy(true); setError(null); setMessage('');
    try {
      const result = await processTopupDeliveries(detail.order.id, retryFailed);
      setMessage(result.message);
      await cache.invalidateQueries({ queryKey: ['bren'] });
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel admin-section-gap"><div className="admin-panel-heading"><h2>Top-up delivery</h2>
    {manage && detail.order.status === 'paid' && <div className="admin-row-actions">
      <button className="admin-button" disabled={busy} onClick={() => void process(false)}>{busy ? 'Working…' : open ? 'Process / refresh deliveries' : 'Check deliveries'}</button>
      {failed > 0 && <button className="admin-button admin-button-primary" disabled={busy} onClick={() => void process(true)}>Retry {failed} failed {failed === 1 ? 'unit' : 'units'}</button>}
    </div>}</div>
    <div className="admin-panel-body">
      {message && <p className="admin-callout">{message}</p>}
      {Boolean(error) && <ErrorNotice error={error} />}
      <Table label="Top-up deliveries" columns={['Unit', 'Package', 'Player ID', 'Status', 'Provider order', 'Attempts', 'Detail']}>
        {detail.deliveries.map((delivery) => <tr key={delivery.id}>
          <td className="admin-numeric">{delivery.unit_index}</td>
          <td>{delivery.package_name}{delivery.package_id ? <small> · #{delivery.package_id}</small> : null}</td>
          <td>{delivery.player_id}</td>
          <td><Badge value={delivery.status} /></td>
          <td>{delivery.provider_order_id ?? '—'}</td>
          <td className="admin-numeric">{delivery.attempts ?? 0}</td>
          <td><small className="admin-wrap">{delivery.status === 'delivered' && delivery.delivered_at ? `Delivered ${dateTime(delivery.delivered_at)}` : delivery.last_error || '—'}</small></td>
        </tr>)}
      </Table>
      {failed > 0 && <p className="admin-muted">Failed deliveries return their points to the store balance automatically. Confirm the player ID with the customer before retrying; a wrong ID delivers to the wrong account.</p>}
    </div></section>;
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { role } = useAuth();
  const result = useResource('order', { id }, Boolean(id));
  const [action, setAction] = useState<'payment' | 'fulfill' | 'cancel' | null>(null);
  const detail = result.data;
  const isTopup = Boolean(detail?.items.some((item) => item.player_id));
  return <><Link to="/admin/orders" className="admin-back-link">← All orders</Link>
    <PageHeading title={detail?.order.reference ?? 'Order details'} description={detail ? `Placed ${dateTime(detail.order.created_at)}` : 'Payment and fulfillment are separate steps.'} />
    <AsyncState pending={result.isPending} error={result.error} retry={() => { void result.refetch(); }}>
      {detail && <>
        <div className="admin-detail-status"><div><Badge value={detail.order.status} /><Badge value={detail.order.payment_status} /></div>
          {canManage(role) && <div className="admin-row-actions">
            {detail.order.status === 'pending' && detail.order.payment_status === 'pending' && <>
              <button className="admin-button admin-button-danger" onClick={() => setAction('cancel')}>Cancel unpaid order</button>
              <button className="admin-button admin-button-primary" onClick={() => setAction('payment')}>Confirm payment</button>
            </>}
            {detail.order.status === 'paid' && detail.order.payment_status === 'confirmed' && <button className="admin-button admin-button-primary" onClick={() => setAction('fulfill')}>Mark fulfilled</button>}
          </div>}
        </div>
        {detail.order.status === 'pending' && <p className="admin-callout">{isTopup
          ? 'Pending payment — nothing has been delivered. Confirming a verified payment queues automatic top-up delivery.'
          : 'Pending payment — no seats are reserved. Confirming a verified payment checks availability and allocates seats.'}</p>}
        {detail.order.status === 'paid' && <p className="admin-callout">{isTopup
          ? 'Payment confirmed. Top-up delivery runs automatically; track each unit in the delivery panel below. The order is marked fulfilled when every unit is delivered.'
          : 'Payment confirmed. Seats are allocated, but access still needs to be delivered before marking this order fulfilled.'}</p>}
        <div className="admin-detail-grid"><div>
          <section className="admin-panel"><div className="admin-panel-heading"><h2>Order items</h2><span className="admin-muted">Immutable checkout snapshot</span></div>
            <Table label="Order items" columns={['Plan', 'Quantity', 'Unit price', 'Line total']}>
              {detail.items.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small className="admin-wrap">{item.description}</small><small>{item.player_id ? `Player ID ${item.player_id}` : `${item.billing_days}-day term`}</small></td>
                <td className="admin-numeric">{item.qty}</td><td className="admin-numeric">{formatMoney(item.unit_minor, detail.order.currency)}</td><td className="admin-numeric">{formatMoney(item.unit_minor * item.qty, detail.order.currency)}</td></tr>)}
            </Table><div className="admin-total"><span>Order total</span><strong>{formatMoney(detail.order.total_minor, detail.order.currency)}</strong></div>
          </section>
          {detail.deliveries.length > 0 && <TopupPanel detail={detail} manage={canManage(role)} />}
          <section className="admin-panel admin-section-gap"><div className="admin-panel-heading"><h2>Timeline & internal notes</h2></div>
            <div className="admin-panel-body"><NoteForm id={detail.order.id} kind="order" />
              {detail.events.length ? <ol className="admin-timeline">{detail.events.map(event => <li key={event.id}><div><strong>{titleCase(event.action)}</strong><time dateTime={event.created_at}>{dateTime(event.created_at)}</time></div>
                {event.note && <p>{event.note}</p>}<small>{event.actor_id ? `Staff / account ${shortId(event.actor_id)}` : 'System'}</small></li>)}</ol> : <EmptyState title="No timeline entries">New notes and order events will appear here.</EmptyState>}
            </div></section>
        </div><aside>
          <section className="admin-panel"><div className="admin-panel-heading"><h2>Customer contact</h2></div><div className="admin-panel-body">
            <dl className="admin-description-list"><dt>Name at checkout</dt><dd>{detail.order.customer_name}</dd><dt>Phone</dt><dd>{detail.order.phone || 'Not provided'}</dd><dt>Telegram</dt><dd>{detail.order.telegram || 'Not provided'}</dd></dl>
            <Link to={`/admin/customers/${detail.order.customer_id}`}>View customer profile →</Link>
          </div></section>
          <section className="admin-panel admin-section-gap"><div className="admin-panel-heading"><h2>Payment record</h2></div><div className="admin-panel-body">
            {detail.payment ? <dl className="admin-description-list"><dt>Status</dt><dd><Badge value="confirmed" /></dd><dt>Received amount</dt><dd>{formatMoney(detail.payment.amount_minor, detail.payment.currency)}</dd><dt>Reference</dt><dd>{detail.payment.reference}</dd>
              <dt>Confirmed</dt><dd>{dateTime(detail.payment.confirmed_at)}</dd><dt>Staff account</dt><dd title={detail.payment.confirmed_by}>{shortId(detail.payment.confirmed_by)}</dd></dl> : <p className="admin-muted">No payment has been confirmed for this order.</p>}
          </div></section>
          {canManage(role) && detail.payment && <p className="admin-muted admin-aside-note">To release seats, remove access first, then use <Link to="/admin/inventory">Inventory</Link>. Release does not issue a refund.</p>}
        </aside></div>
        {action === 'payment' && <PaymentDialog order={detail.order} topup={isTopup} onClose={() => setAction(null)} />}
        {action === 'fulfill' && <ReasonDialog title="Mark order fulfilled" action="fulfill_order" input={{ id: detail.order.id }} onClose={() => setAction(null)} label="Mark fulfilled"
          description="Confirm that access has already been delivered through your established channel. This does not allocate additional seats." acknowledge="I have delivered access for every item in this order." />}
        {action === 'cancel' && <ReasonDialog title="Cancel unpaid order" action="cancel_order" input={{ id: detail.order.id }} onClose={() => setAction(null)} label="Cancel order"
          description="This permanently cancels the unpaid order. It does not issue a refund. There are no reserved seats to release." acknowledge="I understand this unpaid order will be cancelled." />}
      </>}
    </AsyncState></>;
}
