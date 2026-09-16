import { EmailBuilder } from './email.builder';

/**
 * @file email.builder.spec.ts
 * @description Tests unitarios del constructor de emails para el quote-flow.
 *
 * QUÉ PROTEGE:
 * - Destinatarios correctos por tipo de evento.
 * - Rendering básico del nuevo flujo comercial.
 * - Inclusión del precio cotizado cuando existe `quote.finalQuotedPrice`.
 */
describe('EmailBuilder', () => {
  let builder: EmailBuilder;

  beforeEach(() => {
    process.env.EMAIL_USER = 'ops@zcleanup.test';
    builder = new EmailBuilder();
  });

  it('routes booking.quote_requested emails to the internal operations mailbox', () => {
    const built = builder.buildBookingEmail({
      eventType: 'booking.quote_requested',
      booking: {
        bookingId: 'b1',
        name: 'Customer',
        email: 'customer@example.com',
        cleaningType: 'standard-cleaning',
      },
    });

    expect(built.to).toBe('ops@zcleanup.test');
    expect(built.subject).toContain('quote request');
  });

  it('routes booking.quote_sent emails to the customer and renders the quoted total', () => {
    const built = builder.buildBookingEmail({
      eventType: 'booking.quote_sent',
      booking: {
        bookingId: 'b2',
        name: 'Customer',
        email: 'customer@example.com',
        cleaningType: 'standard-cleaning',
        quote: {
          version: 2,
          finalQuotedPrice: 145,
        },
      },
    });

    expect(built.to).toBe('customer@example.com');
    expect(built.subject).toContain('quote is ready');
    expect(built.html).toContain('$145.00');
  });

  it('renders invoice_ready using the payment CTA when paymentUrl exists', () => {
    const built = builder.buildBookingEmail({
      eventType: 'booking.invoice_ready',
      booking: {
        bookingId: 'b3',
        name: 'Customer',
        email: 'customer@example.com',
        cleaningType: 'standard-cleaning',
        paymentUrl: 'https://checkout.stripe.com/test-url',
        quote: {
          version: 3,
          finalQuotedPrice: 220,
        },
      },
    });

    expect(built.to).toBe('customer@example.com');
    expect(built.subject).toContain('Invoice ready');
    expect(built.html).toContain('https://checkout.stripe.com/test-url');
    expect(built.html).toContain('Complete Payment');
  });

  it('[State A] Requested, NOT applied: 0 discount rows + total=$210 + special-conditions says Requested', () => {
    const built = builder.buildBookingEmail({
      eventType: 'booking.quote_sent',
      booking: {
        bookingId: 'bA',
        name: 'Customer A',
        email: 'a@example.com',
        cleaningType: 'standard-cleaning',
        estimatedPrice: 210,
        finalPricePreview: 210,
        firstServiceDiscountRequested: true,
        applyFirstDiscount: true,
        display: {
          pricing: {
            total: 210,
            discountApplied: false,
            items: [
              { label: 'Base Service / Package (5 bed / 3 bath)', amount: 210 },
            ],
          },
          specialConditions: ['First-Service Discount Requested'],
        },
      },
    });
    expect(built.to).toBe('a@example.com');
    expect(built.html).toContain('$210.00');
    const discountRowMatches = (built.html.match(/Discount\s*\(\s*15\s*%\s*\)/g) || []).length;
    expect(discountRowMatches).toBe(0);
    expect(built.html).toContain('First-Service Discount Requested');
    expect(built.html).not.toContain('First-Service Discount Applied');
  });

  it('[State B] Applied first-time 15%: exactly ONE Discount(15%) row; total=$178.50 + Applied indicator', () => {
    const built = builder.buildBookingEmail({
      eventType: 'booking.confirmed',
      booking: {
        bookingId: 'bB',
        name: 'Customer B',
        email: 'b@example.com',
        cleaningType: 'standard-cleaning',
        estimatedPrice: 210,
        finalPricePreview: 178.5,
        discountApplied: true,
        firstServiceDiscountRequested: true,
        applyFirstDiscount: true,
        quote: {
          version: 5,
          baseCalculatedPrice: 210,
          discountType: 'first_time_customer',
          discountPercent: 15,
          discountAmount: 31.5,
          finalQuotedPrice: 178.5,
        },
        display: {
          pricing: {
            total: 178.5,
            discountApplied: true,
            items: [
              { label: 'Base Service / Package (5 bed / 3 bath)', amount: 210 },
              { label: 'Discount (15%)', amount: -31.5 },
            ],
          },
          specialConditions: ['First-Service Discount Requested'],
        },
      },
    });
    expect(built.to).toBe('b@example.com');
    expect(built.html).toContain('$178.50');
    const discountRowMatches = (built.html.match(/Discount\s*\(\s*15\s*%\s*\)/g) || []).length;
    expect(discountRowMatches).toBe(1);
    expect(built.html).toContain('First-Service Discount Applied');
  });
});
