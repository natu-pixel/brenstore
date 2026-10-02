import type { OrderDetail } from '../features/contracts';

export default function OrderProgress({ detail }: { detail: OrderDetail }) {
  const { order, items, deliveries } = detail;
  const paid = order.payment_status === 'confirmed';
  const fulfilled = order.status === 'fulfilled';
  const cancelled = order.status === 'cancelled';
  const isTopup = items.some((item) => item.player_id !== null);
  const total = items.reduce((sum, item) => sum + item.qty, 0);
  const delivered = deliveries.filter((delivery) => delivery.status === 'delivered').length;
  const failed = deliveries.some((delivery) => delivery.status === 'failed');
  const steps = [
    { title: 'Order saved', complete: true, text: 'Your order reference is ready.' },
    { title: 'Payment confirmed', complete: paid, text: paid ? 'Staff recorded a verified payment.' : cancelled ? 'No payment was confirmed.' : 'Waiting for staff to verify payment.' },
    { title: isTopup ? 'Top-up delivered' : 'Access delivered', complete: fulfilled,
      text: fulfilled ? (isTopup ? 'All purchased top-up units are delivered.' : 'Staff marked access as delivered.')
        : cancelled ? 'This order will not be fulfilled.'
        : !paid ? 'Delivery starts after payment confirmation.'
        : isTopup ? `${delivered} of ${total} units delivered.`
        : 'Staff will manually deliver your access.' },
  ];
  return <section className="order-progress" aria-labelledby="order-progress-heading">
    <h2 id="order-progress-heading">Order progress</h2>
    <div role="status" aria-live="polite" aria-atomic="true">
      {cancelled ? <p className="store-notice">Order cancelled. Do not send payment for this order. If you already paid, contact staff with your reference; cancellation does not issue a refund.</p>
        : fulfilled ? <p>Fulfillment complete.</p>
        : !paid ? <p>Order saved, but payment is not yet confirmed.</p>
        : isTopup && delivered > 0 ? <p>Partially delivered: {delivered} of {total} units. {failed ? 'A remaining unit needs staff attention.' : 'Remaining units are awaiting delivery.'}</p>
        : <p>{isTopup && failed ? 'Payment confirmed. Delivery needs staff attention.' : 'Payment confirmed. Fulfillment is not yet complete.'}</p>}
      <ol className="order-steps">
        {steps.map((step, index) => <li key={step.title} className={step.complete ? 'is-complete' : ''}
          aria-current={!cancelled && !fulfilled && index === (paid ? 2 : 1) ? 'step' : undefined}>
          <span className="order-step-number" aria-hidden="true">{index + 1}</span>
          <div><strong>{step.title}</strong><small>{step.complete ? 'Complete' : cancelled ? 'Not completed' : 'Pending'}</small><p>{step.text}</p></div>
        </li>)}
      </ol>
    </div>
  </section>;
}
