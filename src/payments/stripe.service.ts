import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import { type BookingDocument } from '../booking/schemas/booking.schema';

type StripeClient = InstanceType<typeof Stripe>;

export function toStripeAmountCents(amount: number): number {
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return cents;
}

export type StripeCheckoutSessionDetails = {
  id: string;
  url: string;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
};

/**
 * @class StripeService
 * @description Servicio de integración con la API de Stripe para el procesamiento de pagos.
 * Maneja la creación de sesiones de Checkout y la validación de firmas de webhooks.
 */
@Injectable()
export class StripeService {
  private stripe: StripeClient | null = null;

  /**
   * Inicializa o devuelve la instancia del cliente de Stripe.
   * @returns Cliente de Stripe configurado con la clave secreta.
   * @throws InternalServerErrorException si la clave de Stripe no está configurada.
   */
  private getStripe(): StripeClient {
    if (this.stripe) {
      return this.stripe;
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new InternalServerErrorException('Stripe is not configured');
    }

    this.stripe = new Stripe(secretKey);
    return this.stripe;
  }

  /**
   * Construye un evento de Stripe a partir del payload del webhook y la firma.
   * Valida la autenticidad de la notificación recibida.
   * @param payload Cuerpo bruto de la solicitud del webhook.
   * @param signature Firma enviada por Stripe en las cabeceras.
   * @returns El evento de Stripe validado.
   * @throws InternalServerErrorException si el secreto del webhook no está configurado.
   */
  constructWebhookEvent(payload: Buffer, signature: string): unknown {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new InternalServerErrorException(
        'Stripe webhook is not configured',
      );
    }
    const stripe = this.getStripe();
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  /**
   * Crea una sesión de Checkout de Stripe y devuelve la URL de redirección.
   * @param booking Documento de la reserva asociada al pago.
   * @returns URL de la página de pago de Stripe.
   */
  async createCheckoutSession(booking: BookingDocument): Promise<string> {
    const details = await this.createCheckoutSessionDetails(booking);
    return details.url;
  }

  /**
   * Crea una sesión de Checkout de Stripe con detalles completos.
   * Configura URLs de éxito/cancelación, metadatos y línea de ítem del servicio.
   * @param booking Documento de la reserva.
   * @returns Detalles de la sesión creada incluyendo ID, URL y ID de PaymentIntent.
   * @throws InternalServerErrorException si el precio es inválido o no se recibe URL de sesión.
   */
  async createCheckoutSessionDetails(
    booking: BookingDocument,
  ): Promise<StripeCheckoutSessionDetails> {
    const price = booking.finalPricePreview;
    const isValidPrice =
      typeof price === 'number' && Number.isFinite(price) && price > 0;
    if (!isValidPrice) {
      throw new InternalServerErrorException('Invalid booking price');
    }

    const unitAmount = toStripeAmountCents(price);
    if (!Number.isSafeInteger(unitAmount) || unitAmount <= 0) {
      throw new InternalServerErrorException('Invalid booking price');
    }

    const frontendBase =
      (process.env.FRONTEND_URL ?? 'http://localhost:4200')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)[0] ?? 'http://localhost:4200';

    const successUrl =
      process.env.STRIPE_SUCCESS_URL ??
      `${frontendBase.replace(/\/$/, '')}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      process.env.STRIPE_CANCEL_URL ??
      `${frontendBase.replace(/\/$/, '')}/payment/cancel`;

    const stripe = this.getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: booking.email,
      metadata: {
        bookingId: String(booking._id),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: unitAmount,
            product_data: {
              name: 'Cleaning Service',
            },
          },
        },
      ],
    });

    if (!session.url) {
      throw new InternalServerErrorException(
        'Stripe checkout URL not returned',
      );
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : null;
    const amountTotal =
      typeof session.amount_total === 'number' ? session.amount_total : null;
    const currency =
      typeof session.currency === 'string' ? session.currency : null;

    return {
      id: session.id,
      url: session.url,
      amountTotal,
      currency,
      paymentIntentId,
    };
  }
}
