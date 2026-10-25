import { useEffect, useState } from 'react';
import {
  IconCheck,
  IconCopy,
  IconDeviceMobile,
  IconShieldCheck,
} from '@tabler/icons-react';
import { syncFlyOrder, verifyFlyPayment } from '../features/paymentApi';

interface FlyPaymentVerificationProps {
  orderReference: string;
  customerName: string;
  productSummary: string;
  amountEtb: number;
  onPaymentVerified?: () => void;
}

export default function FlyPaymentVerification({
  orderReference,
  customerName,
  productSummary,
  amountEtb,
  onPaymentVerified,
}: FlyPaymentVerificationProps) {
  const [telebirrTxn, setTelebirrTxn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });

  // Ensure Fly.io has this order registered
  useEffect(() => {
    if (!orderReference || !amountEtb) return;
    void syncFlyOrder({
      id: orderReference,
      customer: customerName || 'Brenstore Customer',
      product: productSummary || 'Subscription / Top-up',
      price: amountEtb,
    });
  }, [orderReference, customerName, productSummary, amountEtb]);

  function copyToClipboard(text: string, key: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
      });
    }
  }

  async function handleConfirmPayment(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ type: 'idle', message: '' });

    const trimmedTxn = telebirrTxn.trim();
    if (!trimmedTxn) {
      setStatus({
        type: 'error',
        message: 'Please enter your Telebirr transaction number.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyFlyPayment({
        orderId: orderReference,
        method: 'telebirr',
        txn: trimmedTxn,
      });

      if (result.ok) {
        setStatus({
          type: 'success',
          message:
            result.message || '🎉 Payment Verified! Your order is active.',
        });
        setTelebirrTxn('');
        onPaymentVerified?.();
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Payment verification failed. Please try again.',
        });
      }
    } catch (err) {
      console.error('Telebirr verify error:', err);
      setStatus({
        type: 'error',
        message: '⚠️ Could not reach payment server. Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="payment-verification-container store-notice" aria-labelledby="pay-verify-heading" style={{ marginTop: '1.25rem' }}>
      <h2 id="pay-verify-heading" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
        <IconShieldCheck size={22} color="var(--blue-600, #2563eb)" />
        Telebirr Payment Verification
      </h2>
      <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#475569' }}>
        Order Reference: <strong style={{ color: '#0f172a' }}>{orderReference}</strong>
        <br />
        Amount to Pay: <strong style={{ color: '#0f172a' }}>ETB {amountEtb.toFixed(2)}</strong>
      </p>

      {/* Transfer Instructions Box */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '14px',
          fontSize: '0.9rem',
          lineHeight: '1.6',
          marginBottom: '16px',
        }}
      >
        <strong style={{ display: 'block', color: '#1e293b', marginBottom: '6px' }}>
          Transfer ETB {amountEtb.toFixed(2)} via Telebirr:
        </strong>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <IconDeviceMobile size={18} color="#2563eb" />
            <strong>Telebirr:</strong> 0998778411 (Abdurahim)
          </span>
          <button
            type="button"
            className="auth-switch"
            onClick={() => copyToClipboard('0998778411', 'telebirr')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px' }}
          >
            {copiedKey === 'telebirr' ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copiedKey === 'telebirr' ? 'Copied' : 'Copy number'}
          </button>
        </div>
      </div>

      {/* Verification Form */}
      <form onSubmit={(e) => void handleConfirmPayment(e)}>
        <div className="auth-field" style={{ marginBottom: '16px' }}>
          <span>Telebirr Transaction Number</span>
          <input
            type="text"
            placeholder="e.g. DJI91DDRVT"
            value={telebirrTxn}
            disabled={submitting}
            onChange={(e) => setTelebirrTxn(e.target.value.toUpperCase())}
            autoComplete="off"
            required
          />
          <small style={{ color: '#64748b', fontSize: '12px' }}>
            Enter the transaction number from your Telebirr SMS.
          </small>
        </div>

        <button
          type="submit"
          className="btn auth-submit"
          disabled={submitting}
          style={{ width: '100%', marginTop: '6px' }}
        >
          {submitting ? 'Verifying payment with bank…' : 'Confirm Payment'}
        </button>
      </form>

      {/* Status Feedback */}
      {status.type !== 'idle' && (
        <div
          role="alert"
          style={{
            marginTop: '14px',
            padding: '12px 14px',
            borderRadius: '8px',
            fontSize: '0.9rem',
            lineHeight: '1.4',
            textAlign: 'center',
            fontWeight: 600,
            background: status.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: status.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${status.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          {status.message}
        </div>
      )}
    </section>
  );
}
