export const FLY_PAYMENT_API_BASE =
  (import.meta.env.VITE_PAYMENT_API_URL as string | undefined) ||
  'https://payment-evergreen-sunrise-2049.fly.dev';

export interface CreateFlyOrderInput {
  id?: string;
  customer: string;
  product: string;
  price: number; // In ETB
}

export interface VerifyPaymentInput {
  orderId: string;
  method: 'telebirr' | 'cbe';
  txn?: string;
  payerName?: string;
  last4?: string;
}

export interface VerifyPaymentResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Register or ensure the order exists on the Fly payment server.
 * Returns the orderId.
 */
export async function syncFlyOrder(input: CreateFlyOrderInput): Promise<string> {
  try {
    const res = await fetch(`${FLY_PAYMENT_API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const data = (await res.json()) as { ok?: boolean; orderId?: string; error?: string };

    if (res.status === 201 && data.orderId) {
      return data.orderId;
    }

    // If already exists, the server returns 409
    if (res.status === 409 || data.error?.includes('already exists')) {
      return input.id || '';
    }

    if (!res.ok) {
      console.warn('Fly order sync error:', data.error);
    }

    return data.orderId || input.id || '';
  } catch (err) {
    console.warn('Could not contact Fly order API:', err);
    return input.id || '';
  }
}

/**
 * Verify payment with Telebirr txn or CBE transfer details.
 */
export async function verifyFlyPayment(
  input: VerifyPaymentInput
): Promise<VerifyPaymentResponse> {
  const res = await fetch(`${FLY_PAYMENT_API_BASE}/api/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const data = (await res.json()) as VerifyPaymentResponse;
  return data;
}
