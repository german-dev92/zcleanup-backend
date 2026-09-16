import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import {
  Booking,
  type BookingDocument,
} from '../booking/schemas/booking.schema';
import { Payment, type PaymentDocument } from './schemas/payment.schema';
import { StripeService, toStripeAmountCents } from './stripe.service';

type StripeWebhookEvent = {
  type: string;
  data?: {
    object?: {
      id?: string;
      amount_total?: number;
      currency?: string;
      payment_intent?: string;
      payment_status?: string;
      metadata?: {
        bookingId?: string;
        quoteVersion?: string;
        quotedAmount?: string;
      };
    };
  };
};

@Injectable()
export class PaymentsWebhookService {
  private readonly logger = new Logger(PaymentsWebhookService.name);

  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly stripeService: StripeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const event = this.constructEvent(payload, signature);

    this.logger.debug(
      JSON.stringify({ event: 'stripe.webhook.event', type: event.type }),
    );

    if (event.type === 'checkout.session.completed') {
      await this.handleCheckoutSessionCompleted(event);
      return;
    }
  }

  private constructEvent(
    payload: Buffer,
    signature: string,
  ): StripeWebhookEvent {
    try {
      const event = this.stripeService.constructWebhookEvent(
        payload,
        signature,
      );
      if (!this.isStripeWebhookEvent(event)) {
        throw new InternalServerErrorException('Invalid webhook payload');
      }

      return event;
    } catch (error) {
      void error;
      throw new UnauthorizedException();
    }
  }

  private async handleCheckoutSessionCompleted(event: StripeWebhookEvent) {
    const paymentStatus = event.data?.object?.payment_status;
    if (paymentStatus !== 'paid') {
      this.logger.debug(
        JSON.stringify({
          event: 'stripe.webhook.session_ignored',
          reason: 'not_paid',
          paymentStatus,
        }),
      );
      return;
    }

    const checkoutSessionId = event.data?.object?.id;
    const amountTotal = event.data?.object?.amount_total;
    const currency = event.data?.object?.currency;
    const paymentIntentId = event.data?.object?.payment_intent;

    const bookingId = event.data?.object?.metadata?.bookingId;
    const quoteVersion = event.data?.object?.metadata?.quoteVersion;
    const quotedAmount = event.data?.object?.metadata?.quotedAmount;

    if (typeof bookingId !== 'string' || !bookingId.trim()) {
      throw new InternalServerErrorException('Invalid webhook payload');
    }

    if (!isValidObjectId(bookingId)) {
      throw new InternalServerErrorException('Invalid webhook payload');
    }

    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      this.logger.warn(
        JSON.stringify({
          event: 'stripe.webhook.booking_not_found',
          bookingId,
        }),
      );
      return;
    }

    if (booking.status === 'cancelled') {
      this.logger.warn(
        JSON.stringify({
          event: 'stripe.webhook.booking_ignored',
          reason: 'cancelled',
          bookingId,
        }),
      );
      return;
    }

    if (booking.paymentStatus === 'paid' || booking.status === 'paid') {
      this.logger.debug(
        JSON.stringify({
          event: 'stripe.webhook.booking_ignored',
          reason: 'already_paid',
          bookingId,
        }),
      );
      return;
    }

    const paymentContext = this.resolveWebhookPaymentContext(
      booking,
      quoteVersion,
      quotedAmount,
    );
    const current = booking.status;
    const eligible = paymentContext.eligible;
    if (!eligible) {
      this.logger.warn(
        JSON.stringify({
          event: 'stripe.webhook.booking_ignored',
          reason: 'not_eligible_for_payment',
          bookingId,
          current,
          commercialStatus:
            typeof booking.commercialStatus === 'string'
              ? booking.commercialStatus
              : null,
          paymentLifecycleStatus:
            typeof booking.paymentLifecycleStatus === 'string'
              ? booking.paymentLifecycleStatus
              : null,
        }),
      );
      return;
    }

    const expectedAmount = paymentContext.expectedAmount;
    const expectedAmountCents = toStripeAmountCents(expectedAmount);
    if (
      !Number.isSafeInteger(expectedAmountCents) ||
      expectedAmountCents <= 0
    ) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'invalid_booking_price_cents',
          bookingId,
        }),
      );
      return;
    }

    const amountTotalCents =
      typeof amountTotal === 'number' ? amountTotal : null;
    if (
      amountTotalCents === null ||
      !Number.isSafeInteger(amountTotalCents) ||
      amountTotalCents <= 0
    ) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'invalid_stripe_amount_total',
          bookingId,
        }),
      );
      return;
    }
    if (amountTotalCents !== expectedAmountCents) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'amount_mismatch',
          bookingId,
          expectedAmountCents,
          amountTotalCents,
        }),
      );
      return;
    }

    const updatedPayment = await this.paymentModel.findOneAndUpdate(
      { bookingId: String(booking._id), provider: 'stripe' },
      {
        $setOnInsert: {
          bookingId: String(booking._id),
          provider: 'stripe',
          amount: expectedAmount,
          currency: typeof currency === 'string' ? currency : 'usd',
        },
        $set: {
          status: 'paid',
          checkoutSessionId:
            typeof checkoutSessionId === 'string'
              ? checkoutSessionId
              : undefined,
          paymentIntentId:
            typeof paymentIntentId === 'string' ? paymentIntentId : undefined,
        },
      },
      { upsert: true, new: true },
    );

    if (updatedPayment.status !== 'paid') {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'payment_not_paid',
          bookingId,
          paymentStatus: updatedPayment.status,
        }),
      );
      return;
    }

    const storedAmountCents =
      typeof updatedPayment.amount === 'number'
        ? toStripeAmountCents(updatedPayment.amount)
        : null;
    if (storedAmountCents !== expectedAmountCents) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'payment_record_amount_mismatch',
          bookingId,
          expectedAmountCents,
          storedAmountCents,
          storedAmount: updatedPayment.amount,
        }),
      );
      return;
    }

    if (
      typeof updatedPayment.checkoutSessionId === 'string' &&
      typeof checkoutSessionId === 'string' &&
      updatedPayment.checkoutSessionId &&
      updatedPayment.checkoutSessionId !== checkoutSessionId
    ) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'checkout_session_mismatch',
          bookingId,
        }),
      );
      return;
    }

    booking.paymentStatus = 'paid';
    if (paymentContext.mode === 'quote_flow') {
      booking.paymentLifecycleStatus = 'paid';
    }
    if (!booking.paidAt) {
      booking.paidAt = new Date();
    }
    await booking.save();
    this.eventEmitter.emit('booking.payment_received', {
      ...(typeof booking.toObject === 'function'
        ? booking.toObject()
        : (booking as unknown as Record<string, unknown>)),
      bookingId: String(booking._id),
    });
    this.logger.log(
      JSON.stringify({ event: 'stripe.webhook.booking_paid', bookingId }),
    );
  }

  private isStripeWebhookEvent(value: unknown): value is StripeWebhookEvent {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    if (
      !('type' in value) ||
      typeof (value as { type?: unknown }).type !== 'string'
    ) {
      return false;
    }

    return true;
  }

  /**
   * Determina el contexto financiero esperado del webhook.
   *
   * OBJETIVO:
   * - Reutilizar la lógica legacy sin romper producción.
   * - Validar que los pagos del quote-flow correspondan a la cotización
   *   aceptada e invoice preparada.
   */
  private resolveWebhookPaymentContext(
    booking: BookingDocument,
    metadataQuoteVersion?: string,
    metadataQuotedAmount?: string,
  ): {
    mode: 'legacy' | 'quote_flow';
    eligible: boolean;
    expectedAmount: number;
  } {
    const commercialStatus =
      typeof booking.commercialStatus === 'string'
        ? booking.commercialStatus
        : null;
    const isQuoteFlow =
      commercialStatus !== null && commercialStatus !== 'legacy_direct_booking';

    if (!isQuoteFlow) {
      const current = booking.status;
      const eligible =
        current === 'confirmed' ||
        current === 'assigned' ||
        current === 'in_progress' ||
        current === 'completed';

      return {
        mode: 'legacy',
        eligible,
        expectedAmount: this.ensurePositiveAmount(
          booking.finalPricePreview,
          'legacy',
        ),
      };
    }

    const paymentLifecycleStatus =
      typeof booking.paymentLifecycleStatus === 'string'
        ? booking.paymentLifecycleStatus
        : null;
    const eligible =
      commercialStatus === 'quote_accepted' &&
      (paymentLifecycleStatus === 'invoice_ready' ||
        paymentLifecycleStatus === 'checkout_created' ||
        paymentLifecycleStatus === 'payment_pending' ||
        paymentLifecycleStatus === 'paid');

    const quote =
      booking.quote && typeof booking.quote === 'object'
        ? (booking.quote as unknown as Record<string, unknown>)
        : null;
    const expectedAmount = this.ensurePositiveAmount(
      quote?.finalQuotedPrice,
      'quote_flow',
    );
    const expectedQuotedAmount = expectedAmount.toFixed(2);
    const expectedQuoteVersion =
      typeof quote?.version === 'number' &&
      Number.isFinite(quote.version) &&
      quote.version > 0
        ? String(quote.version)
        : '0';

    if (
      typeof metadataQuoteVersion === 'string' &&
      metadataQuoteVersion &&
      metadataQuoteVersion !== expectedQuoteVersion
    ) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'quote_version_mismatch',
          bookingId: String(booking._id),
          expectedQuoteVersion,
          metadataQuoteVersion,
        }),
      );
      return {
        mode: 'quote_flow',
        eligible: false,
        expectedAmount,
      };
    }

    if (
      typeof metadataQuotedAmount === 'string' &&
      metadataQuotedAmount &&
      metadataQuotedAmount !== expectedQuotedAmount
    ) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'quoted_amount_mismatch',
          bookingId: String(booking._id),
          expectedQuotedAmount,
          metadataQuotedAmount,
        }),
      );
      return {
        mode: 'quote_flow',
        eligible: false,
        expectedAmount,
      };
    }

    return {
      mode: 'quote_flow',
      eligible,
      expectedAmount,
    };
  }

  private ensurePositiveAmount(value: unknown, mode: 'legacy' | 'quote_flow') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'invalid_expected_amount',
          mode,
        }),
      );
      return 0;
    }

    return value;
  }
}
