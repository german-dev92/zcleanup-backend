import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingStateService } from './booking-state.service';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { GeoPricingService } from './geo-pricing.service';

import { EmailModule } from '../email/email.module';
import { DiscountsModule } from '../discounts/discounts.module'; // 👈 IMPORT
import { PaymentsModule } from '../payments/payments.module';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { EmployeesModule } from '../employees/employees.module';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: User.name, schema: UserSchema },
    ]),

    EmailModule, // 👈 ya lo tienes
    DiscountsModule, // 👈 ESTE ES EL QUE TE FALTA O ESTÁ MAL
    PaymentsModule,
    EmployeesModule,
  ],
  controllers: [BookingController],
  providers: [BookingService, BookingStateService, GeoPricingService],
})
export class BookingModule {}
