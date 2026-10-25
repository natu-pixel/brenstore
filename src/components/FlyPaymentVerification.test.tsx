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
        customerName="Abdurahim Customer"
        productSummary="1 Month VIP Access"
        amountEtb={911.0}
      />
    );

    expect(syncOrderMock).toHaveBeenCalledWith({
      id: 'BR-TEST-123',
      customer: 'Abdurahim Customer',
      product: '1 Month VIP Access',
      price: 911.0,
    });
  });

  it('displays the updated Telebirr recipient number and name', () => {
    render(
      <FlyPaymentVerification
        orderReference="BR-TEST-123"
        customerName="Test Customer"
        productSummary="1 Month VIP Access"
        amountEtb={911.0}
      />
    );

    expect(screen.getByText(/0998778411/i)).toBeInTheDocument();
    expect(screen.getByText(/Abdurahim/i)).toBeInTheDocument();
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
