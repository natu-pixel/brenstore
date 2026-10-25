import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FlyPaymentVerification from './FlyPaymentVerification';
import * as paymentApi from '../features/paymentApi';

vi.mock('../features/paymentApi', () => ({
  syncFlyOrder: vi.fn(),
  verifyFlyPayment: vi.fn(),
}));

describe('FlyPaymentVerification component', () => {
  const syncOrderMock = vi.mocked(paymentApi.syncFlyOrder);
  const verifyPaymentMock = vi.mocked(paymentApi.verifyFlyPayment);

  beforeEach(() => {
    vi.clearAllMocks();
    syncOrderMock.mockResolvedValue('BR-TEST-123');
  });

  it('automatically registers the order with Fly payment API on mount', async () => {
    render(
      <FlyPaymentVerification
        orderReference="BR-TEST-123"
        customerName="Test Customer"
        productSummary="1 Month VIP Access"
        amountEtb={911.0}
      />
    );

    expect(syncOrderMock).toHaveBeenCalledWith({
      id: 'BR-TEST-123',
      customer: 'Test Customer',
      product: '1 Month VIP Access',
      price: 911.0,
    });
  });

  it('validates Telebirr input and submits verification successfully', async () => {
    verifyPaymentMock.mockResolvedValue({
      ok: true,
      message: '🎉 Payment Verified! Your order is active.',
    });

    const onVerified = vi.fn();

    render(
      <FlyPaymentVerification
        orderReference="BR-TEST-123"
        customerName="Test Customer"
        productSummary="1 Month VIP Access"
        amountEtb={911.0}
        onPaymentVerified={onVerified}
      />
    );

    // Verify Telebirr is selected by default
    const txnInput = screen.getByPlaceholderText('e.g. DJI91DDRVT');
    fireEvent.change(txnInput, { target: { value: 'dji91ddrvt' } });
    expect((txnInput as HTMLInputElement).value).toBe('DJI91DDRVT');

    const submitBtn = screen.getByRole('button', { name: /confirm payment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(verifyPaymentMock).toHaveBeenCalledWith({
        orderId: 'BR-TEST-123',
        method: 'telebirr',
        txn: 'DJI91DDRVT',
      });
      expect(screen.getByText(/🎉 Payment Verified!/i)).toBeInTheDocument();
      expect(onVerified).toHaveBeenCalled();
    });
  });

  it('switches to CBE mode and submits payerName + last4 digits', async () => {
    verifyPaymentMock.mockResolvedValue({
      ok: true,
      message: 'Payment confirmed. Your order is active.',
    });

    render(
      <FlyPaymentVerification
        orderReference="BR-TEST-123"
        customerName="Test Customer"
        productSummary="1 Month VIP Access"
        amountEtb={911.0}
      />
    );

    const cbeRadio = screen.getByLabelText(/cbe transfer/i);
    fireEvent.click(cbeRadio);

    const nameInput = screen.getByPlaceholderText('e.g. Mahider Yilkal Gete');
    const last4Input = screen.getByPlaceholderText('e.g. 5443');

    fireEvent.change(nameInput, { target: { value: 'Mahider Yilkal' } });
    fireEvent.change(last4Input, { target: { value: '5443' } });

    const submitBtn = screen.getByRole('button', { name: /confirm payment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(verifyPaymentMock).toHaveBeenCalledWith({
        orderId: 'BR-TEST-123',
        method: 'cbe',
        payerName: 'Mahider Yilkal',
        last4: '5443',
      });
    });
  });

  it('displays error message when verification fails', async () => {
    verifyPaymentMock.mockResolvedValue({
      ok: false,
      error: 'We could not find that transaction.',
    });

    render(
      <FlyPaymentVerification
        orderReference="BR-TEST-123"
        customerName="Test Customer"
        productSummary="1 Month VIP Access"
        amountEtb={911.0}
      />
    );

    const txnInput = screen.getByPlaceholderText('e.g. DJI91DDRVT');
    fireEvent.change(txnInput, { target: { value: 'INVALID123' } });

    const submitBtn = screen.getByRole('button', { name: /confirm payment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText('We could not find that transaction.')
      ).toBeInTheDocument();
    });
  });
});
