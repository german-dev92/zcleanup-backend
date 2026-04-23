import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import {
  Booking,
  type BookingDocument,
} from '../booking/schemas/booking.schema';
import { Payment, type PaymentDocument } from './schemas/payment.schema';
import { StripeService } from './stripe.service';
import { BookingStateService } from '../booking/booking-state.service';

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
    private readonly bookingStateService: BookingStateService,
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

    if (booking.status === 'paid') {
      this.logger.debug(
        JSON.stringify({
          event: 'stripe.webhook.booking_ignored',
          reason: 'already_paid',
          bookingId,
        }),
      );
      return;
    }

    const current = booking.status;
    if (current !== 'confirmed') {
      this.logger.warn(
        JSON.stringify({
          event: 'stripe.webhook.booking_ignored',
          reason: 'not_confirmed',
          bookingId,
          current,
        }),
      );
      return;
    }

    const expectedAmount = booking.finalPricePreview;
    const isValidExpectedAmount =
      typeof expectedAmount === 'number' &&
      Number.isFinite(expectedAmount) &&
      expectedAmount > 0;
    if (!isValidExpectedAmount) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'invalid_booking_price',
          bookingId,
        }),
      );
      return;
    }

    const amountFromStripe =
      typeof amountTotal === 'number' ? amountTotal / 100 : null;
    if (amountFromStripe !== null && amountFromStripe !== expectedAmount) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'amount_mismatch',
          bookingId,
          expectedAmount,
          amountFromStripe,
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
          status: 'paid',
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

    if (updatedPayment.amount !== expectedAmount) {
      this.logger.error(
        JSON.stringify({
          event: 'stripe.webhook.refused',
          reason: 'payment_record_amount_mismatch',
          bookingId,
          expectedAmount,
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

    const next = this.bookingStateService.transitionBooking({
      current,
      next: 'paid',
      source: 'webhook',
    });

    booking.status = next;
    await booking.save();
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
}
