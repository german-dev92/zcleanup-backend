import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookController } from './payments.webhook.controller';
import { PaymentsWebhookService } from './payments.webhook.service';
import { StripeService } from './stripe.service';
import { BookingStateService } from '../booking/booking-state.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [
    PaymentsService,
    PaymentsWebhookService,
    StripeService,
    BookingStateService,
  ],
  exports: [StripeService],
})
export class PaymentsModule {}
