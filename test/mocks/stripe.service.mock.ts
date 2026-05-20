/**
 * @file test/mocks/stripe.service.mock.ts
 * @description Mock del servicio de Stripe.
 * Simula el comportamiento de Stripe sin hacer peticiones reales a internet.
 */
export const StripeServiceMock = {
  createCheckoutSession: jest.fn().mockResolvedValue('https://checkout.stripe.com/test-url'),
  createCheckoutSessionDetails: jest.fn().mockResolvedValue({
    id: 'session_123',
    url: 'https://checkout.stripe.com/test-url',
    amountTotal: 10000,
    currency: 'usd',
    paymentIntentId: 'pi_123'
  }),
  constructWebhookEvent: jest.fn()
};
