/**
 * @file test/fixtures/stripe-webhook.fixture.ts
 * @description Fixtures reutilizables para simular eventos de Stripe Webhooks.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE:
 * - Stripe reintenta (re-envía) webhooks por diseño: los eventos pueden llegar duplicados, fuera de orden o con latencia.
 * - En producción, los webhooks son el “source of truth” del estado final del pago.
 * - Tener fixtures realistas evita tests frágiles y protege integridad financiera.
 *
 * QUÉ REPRESENTA “stripe-signature”:
 * - Stripe firma cada webhook con un secreto compartido (STRIPE_WEBHOOK_SECRET).
 * - La firma evita que terceros envíen webhooks falsos para marcar pagos como “paid”.
 *
 * IMPORTANTE:
 * - En estos tests no validamos criptografía real de Stripe (eso se prueba en Stripe).
 * - Validamos NUESTRO comportamiento cuando StripeService acepta o rechaza la firma/payload.
 */

export type StripeWebhookFixtureParams = {
  bookingId: string;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  amountTotalCents?: number;
  currency?: string;
  paymentStatus?: string;
  quoteVersion?: string;
  quotedAmount?: string;
};

/**
 * @description Fixture para simular el evento “checkout.session.completed”.
 * Este es el evento más crítico porque es el que confirma “dinero recibido”.
 */
export function checkoutSessionCompletedFixture(
  params: StripeWebhookFixtureParams,
): {
  type: 'checkout.session.completed';
  data: {
    object: {
      id: string;
      amount_total: number;
      currency: string;
      payment_intent: string;
      payment_status: string;
      metadata: {
        bookingId: string;
        quoteVersion?: string;
        quotedAmount?: string;
      };
    };
  };
} {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: params.checkoutSessionId ?? 'cs_test_123',
        amount_total: params.amountTotalCents ?? 10_000,
        currency: params.currency ?? 'usd',
        payment_intent: params.paymentIntentId ?? 'pi_test_123',
        payment_status: params.paymentStatus ?? 'paid',
        metadata: {
          bookingId: params.bookingId,
          quoteVersion: params.quoteVersion,
          quotedAmount: params.quotedAmount,
        },
      },
    },
  };
}

/**
 * @description Fixture para simular un evento “payment_intent.payment_failed”.
 * IMPORTANTE:
 * - El servicio actual puede ignorar este evento (según implementación vigente).
 * - Aun así lo testeamos para asegurar que NO marque pagos como “paid” por error.
 */
export function paymentIntentFailedFixture(params: {
  bookingId: string;
  paymentIntentId?: string;
}): {
  type: 'payment_intent.payment_failed';
  data: { object: { id: string; metadata: { bookingId: string } } };
} {
  return {
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: params.paymentIntentId ?? 'pi_test_failed_123',
        metadata: { bookingId: params.bookingId },
      },
    },
  };
}
