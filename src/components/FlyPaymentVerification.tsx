import { useEffect, useState } from 'react';
import {
  IconBuildingBank,
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
  const [method, setMethod] = useState<'telebirr' | 'cbe'>('telebirr');
  const [telebirrTxn, setTelebirrTxn] = useState('');
  const [cbePayerName, setCbePayerName] = useState('');
  const [cbeLast4, setCbeLast4] = useState('');
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

    if (method === 'telebirr') {
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
    } else {
      const trimmedPayer = cbePayerName.trim();
      const trimmedLast4 = cbeLast4.trim();
      if (!trimmedPayer || !trimmedLast4) {
        setStatus({
          type: 'error',
          message: 'Please enter both sender full name and last 4 account digits.',
        });
        return;
      }

      if (!/^\d{4}$/.test(trimmedLast4)) {
        setStatus({
          type: 'error',
          message: 'Last digits must be exactly 4 numbers.',
        });
        return;
      }

      setSubmitting(true);
      try {
        const result = await verifyFlyPayment({
          orderId: orderReference,
          method: 'cbe',
          payerName: trimmedPayer,
          last4: trimmedLast4,
        });

        if (result.ok) {
          setStatus({
            type: 'success',
            message:
              result.message || '🎉 Payment Verified! Your order is active.',
          });
          setCbePayerName('');
          setCbeLast4('');
          onPaymentVerified?.();
        } else {
          setStatus({
            type: 'error',
            message: result.error || 'Payment verification failed. Please try again.',
          });
        }
      } catch (err) {
        console.error('CBE verify error:', err);
        setStatus({
          type: 'error',
          message: '⚠️ Could not reach payment server. Please try again.',
        });
      } finally {
        setSubmitting(false);
      }
    }
  }

  return (
    <section className="payment-verification-container store-notice" aria-labelledby="pay-verify-heading" style={{ marginTop: '1.25rem' }}>
      <h2 id="pay-verify-heading" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
        <IconShieldCheck size={22} color="var(--blue-600, #2563eb)" />
        Direct Payment Verification
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
          Transfer to our official accounts:
        </strong>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span>
            • <strong>Telebirr:</strong> 09XXXXXXXX (Brenstore)
          </span>
          <button
            type="button"
            className="auth-switch"
            onClick={() => copyToClipboard('09XXXXXXXX', 'telebirr')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px' }}
          >
            {copiedKey === 'telebirr' ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copiedKey === 'telebirr' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            • <strong>CBE Account:</strong> 1000XXXXXXXX (Brenstore)
          </span>
          <button
            type="button"
            className="auth-switch"
            onClick={() => copyToClipboard('1000XXXXXXXX', 'cbe')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px' }}
          >
            {copiedKey === 'cbe' ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copiedKey === 'cbe' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Payment Method Selector */}
      <div style={{ marginBottom: '14px' }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Select Payment Method
        </span>
        <div style={{ display: 'flex', gap: '16px' }}>
          <label
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              border: `2px solid ${method === 'telebirr' ? '#2563eb' : '#cbd5e1'}`,
              borderRadius: '8px',
              background: method === 'telebirr' ? '#eff6ff' : '#fff',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            <input
              type="radio"
              name="paymentMethod"
              value="telebirr"
              checked={method === 'telebirr'}
              onChange={() => setMethod('telebirr')}
              style={{ margin: 0 }}
            />
            <IconDeviceMobile size={18} />
            Telebirr
          </label>

          <label
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              border: `2px solid ${method === 'cbe' ? '#2563eb' : '#cbd5e1'}`,
              borderRadius: '8px',
              background: method === 'cbe' ? '#eff6ff' : '#fff',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            <input
              type="radio"
              name="paymentMethod"
              value="cbe"
              checked={method === 'cbe'}
              onChange={() => setMethod('cbe')}
              style={{ margin: 0 }}
            />
            <IconBuildingBank size={18} />
            CBE Transfer
          </label>
        </div>
      </div>

      {/* Verification Form */}
      <form onSubmit={(e) => void handleConfirmPayment(e)}>
        {method === 'telebirr' ? (
          <div className="auth-field" style={{ marginBottom: '16px' }}>
            <span>Transaction Number</span>
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
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
            <div className="auth-field">
              <span>Payer Full Name</span>
              <input
                type="text"
                placeholder="e.g. Mahider Yilkal Gete"
                value={cbePayerName}
                disabled={submitting}
                onChange={(e) => setCbePayerName(e.target.value)}
                autoComplete="name"
                required
              />
              <small style={{ color: '#64748b', fontSize: '12px' }}>
                Name on the CBE bank account that transferred the money.
              </small>
            </div>
            <div className="auth-field">
              <span>Last 4 Digits of Sender Account</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="e.g. 5443"
                value={cbeLast4}
                disabled={submitting}
                onChange={(e) => setCbeLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                autoComplete="off"
                required
              />
            </div>
          </div>
        )}

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
