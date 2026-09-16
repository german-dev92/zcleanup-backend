import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import {
  Booking,
  type BookingCommercialStatus,
  type BookingDocument,
} from '../booking/schemas/booking.schema';
import { Payment, type PaymentDocument } from './schemas/payment.schema';
import { StripeService, toStripeAmountCents } from './stripe.service';
import type { AuthUser } from '../auth/auth.types';
import { UserRole } from '../auth/roles.enum';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly stripeService: StripeService,
  ) {}

  async createCheckoutSessionUrl(
    bookingId: string,
    actor: AuthUser | undefined,
  ): Promise<string> {
    if (!actor) {
      throw new UnauthorizedException();
    }

    if (!isValidObjectId(bookingId)) {
      throw new BadRequestException('Invalid bookingId');
    }

    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status === 'cancelled') {
      throw new BadRequestException('Cannot pay for a cancelled booking');
    }

    if (booking.paymentStatus === 'paid' || booking.status === 'paid') {
      throw new BadRequestException('Booking is already paid');
    }

    if (actor.role !== UserRole.ADMIN) {
      const actorEmail = typeof actor.email === 'string' ? actor.email : '';
      const bookingEmail =
        typeof booking.email === 'string' ? booking.email : '';
      if (!actorEmail || actorEmail !== bookingEmail.toLowerCase().trim()) {
        throw new ForbiddenException();
      }
    }

    const paymentContext = this.resolvePaymentContext(booking);

    const existingUrl =
      typeof booking.paymentUrl === 'string' ? booking.paymentUrl.trim() : '';
    if (existingUrl) {
      return existingUrl;
    }

    const expectedAmount = paymentContext.expectedAmount;
    const expectedAmountCents = toStripeAmountCents(expectedAmount);
    if (
      !Number.isSafeInteger(expectedAmountCents) ||
      expectedAmountCents <= 0
    ) {
      throw new BadRequestException('Invalid booking price');
    }

    const existingPayment = await this.paymentModel.findOne({
      bookingId: String(booking._id),
      provider: 'stripe',
    });
    if (
      existingPayment &&
      typeof existingPayment.amount === 'number' &&
      toStripeAmountCents(existingPayment.amount) !== expectedAmountCents
    ) {
      throw new BadRequestException('Payment amount mismatch');
    }

    const details = await this.stripeService.createCheckoutSessionDetails(
      booking,
      {
        amount: expectedAmount,
        quoteVersion: paymentContext.quoteVersion,
        quotedAmount: paymentContext.quotedAmount,
      },
    );

    const currency = details.currency ?? 'usd';
    const amountTotalCents =
      typeof details.amountTotal === 'number' ? details.amountTotal : null;
    if (amountTotalCents !== null && amountTotalCents !== expectedAmountCents) {
      throw new BadRequestException('Stripe amount mismatch');
    }

    const savedPayment = await this.paymentModel.findOneAndUpdate(
      { bookingId: String(booking._id), provider: 'stripe' },
      {
        $setOnInsert: {
          bookingId: String(booking._id),
          provider: 'stripe',
          status: 'pending',
          amount: expectedAmount,
          currency,
        },
        $set: {
          checkoutSessionId: details.id,
          paymentIntentId: details.paymentIntentId ?? undefined,
        },
      },
      { upsert: true, new: true },
    );

    if (
      typeof savedPayment.amount === 'number' &&
      toStripeAmountCents(savedPayment.amount) !== expectedAmountCents
    ) {
      throw new BadRequestException('Payment amount mismatch');
    }

    booking.paymentUrl = details.url;
    if (paymentContext.mode === 'quote_flow') {
      booking.paymentLifecycleStatus = 'checkout_created';
    }
    await booking.save();

    return details.url;
  }

  /**
   * Decide si el booking debe pagarse con reglas legacy o con reglas del nuevo
   * quote-flow y devuelve el monto exacto que Stripe debe cobrar.
   *
   * COMPATIBILIDAD:
   * - Legacy: conserva la regla actual `status === confirmed` y usa
   *   `finalPricePreview`.
   * - Quote-flow: exige `quote_accepted + invoice_ready + finalQuotedPrice`.
   */
  private resolvePaymentContext(booking: BookingDocument): {
    mode: 'legacy' | 'quote_flow';
    expectedAmount: number;
    quoteVersion: string;
    quotedAmount: string;
  } {
    const commercialStatus = this.readCommercialStatus(booking);
    const isQuoteFlow =
      commercialStatus !== null && commercialStatus !== 'legacy_direct_booking';

    if (!isQuoteFlow) {
      if (booking.status !== 'confirmed') {
        throw new BadRequestException(
          'Booking must be confirmed before payment',
        );
      }

      const expectedAmount = this.ensurePositiveAmount(
        booking.finalPricePreview,
        'Invalid booking price',
      );
      return {
        mode: 'legacy',
        expectedAmount,
        quoteVersion: 'legacy',
        quotedAmount: expectedAmount.toFixed(2),
      };
    }

    if (commercialStatus !== 'quote_accepted') {
      throw new BadRequestException(
        'Booking quote must be accepted before payment',
      );
    }

    if (booking.paymentLifecycleStatus !== 'invoice_ready') {
      throw new BadRequestException(
        'Booking invoice must be ready before payment',
      );
    }

    const quote =
      booking.quote && typeof booking.quote === 'object'
        ? (booking.quote as unknown as Record<string, unknown>)
        : null;
    const expectedAmount = this.ensurePositiveAmount(
      quote?.finalQuotedPrice,
      'Invalid quoted price',
    );
    const quoteVersion =
      typeof quote?.version === 'number' &&
      Number.isFinite(quote.version) &&
      quote.version > 0
        ? String(quote.version)
        : '0';

    return {
      mode: 'quote_flow',
      expectedAmount,
      quoteVersion,
      quotedAmount: expectedAmount.toFixed(2),
    };
  }

  private readCommercialStatus(
    booking: BookingDocument,
  ): BookingCommercialStatus | null {
    return typeof booking.commercialStatus === 'string'
      ? booking.commercialStatus
      : null;
  }

  private ensurePositiveAmount(value: unknown, errorMessage: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(errorMessage);
    }
    return value;
  }
}
