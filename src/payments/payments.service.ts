import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import {
  Booking,
  type BookingDocument,
} from '../booking/schemas/booking.schema';
import { StripeService } from './stripe.service';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    private readonly stripeService: StripeService,
  ) {}

  async createCheckoutSessionUrl(bookingId: string): Promise<string> {
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

    return this.stripeService.createCheckoutSession(booking);
  }
}
