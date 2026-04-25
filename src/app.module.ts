import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingModule } from './booking/booking.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DiscountsModule } from './discounts/discounts.module';
import { PaymentsModule } from './payments/payments.module';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI!, {
      autoIndex:
        process.env.MONGO_AUTO_INDEX === 'true' ||
        process.env.NODE_ENV !== 'production',
      autoCreate:
        process.env.MONGO_AUTO_CREATE === 'true' ||
        process.env.NODE_ENV !== 'production',
    }),
    EventEmitterModule.forRoot(),
    AuthModule,
    EmployeesModule,
    BookingModule,
    DiscountsModule,
    PaymentsModule,
  ],
})
export class AppModule {}
