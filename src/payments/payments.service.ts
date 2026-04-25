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
  type BookingDocument,
} from '../booking/schemas/booking.schema';
import { Payment, type PaymentDocument } from './schemas/payment.schema';
import { StripeService } from './stripe.service';
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

    if (booking.status !== 'confirmed') {
      throw new BadRequestException('Booking must be confirmed before payment');
    }

    const existingUrl =
      typeof booking.paymentUrl === 'string' ? booking.paymentUrl.trim() : '';
    if (existingUrl) {
      return existingUrl;
    }

    const expectedAmount = booking.finalPricePreview;
    if (
      typeof expectedAmount !== 'number' ||
      !Number.isFinite(expectedAmount) ||
      expectedAmount <= 0
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
      existingPayment.amount !== expectedAmount
    ) {
      throw new BadRequestException('Payment amount mismatch');
    }

    const details =
      await this.stripeService.createCheckoutSessionDetails(booking);

    const currency = details.currency ?? 'usd';
    const amountFromStripe =
      typeof details.amountTotal === 'number'
        ? details.amountTotal / 100
        : null;
    if (amountFromStripe !== null && amountFromStripe !== expectedAmount) {
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
      savedPayment.amount !== expectedAmount
    ) {
      throw new BadRequestException('Payment amount mismatch');
    }

    booking.paymentUrl = details.url;
    await booking.save();

    return details.url;
  }
}
