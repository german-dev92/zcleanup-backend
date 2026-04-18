import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isValidObjectId, Model } from 'mongoose';
import {
  Booking,
  type BookingDocument,
} from '../booking/schemas/booking.schema';
import { StripeService } from './stripe.service';

type StripeWebhookEvent = {
  type: string;
  data?: {
    object?: {
      metadata?: {
        bookingId?: string;
      };
    };
  };
};

@Injectable()
export class PaymentsWebhookService {
  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    private readonly stripeService: StripeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const event = this.constructEvent(payload, signature);

    console.log('[STRIPE WEBHOOK] Event type:', event.type);

    if (event.type === 'checkout.session.completed') {
      await this.handleCheckoutSessionCompleted(event);
      return;
    }
  }

  private constructEvent(payload: Buffer, signature: string): StripeWebhookEvent {
    try {
      const event = this.stripeService.constructWebhookEvent(payload, signature);
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
    const bookingId = event.data?.object?.metadata?.bookingId;

    if (typeof bookingId !== 'string' || !bookingId.trim()) {
      throw new InternalServerErrorException('Invalid webhook payload');
    }

    if (!isValidObjectId(bookingId)) {
      throw new InternalServerErrorException('Invalid webhook payload');
    }

    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      console.log('[STRIPE WEBHOOK] Booking not found:', bookingId);
      return;
    }

    if (booking.status === 'cancelled') {
      console.log(
        '[STRIPE WEBHOOK] Booking is cancelled, ignoring:',
        bookingId,
      );
      return;
    }

    if (booking.status === 'confirmed') {
      console.log('[STRIPE WEBHOOK] Booking already confirmed:', bookingId);
      return;
    }

    booking.status = 'confirmed';
    const updated = await booking.save();

    this.eventEmitter.emit('booking.confirmed', updated);
    console.log('[STRIPE WEBHOOK] Booking confirmed:', bookingId);
  }

  private isStripeWebhookEvent(value: unknown): value is StripeWebhookEvent {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    if (!('type' in value) || typeof (value as { type?: unknown }).type !== 'string') {
      return false;
    }

    return true;
  }
}
