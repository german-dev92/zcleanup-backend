import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingModule } from './booking/booking.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DiscountsModule } from './discounts/discounts.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI!),
    EventEmitterModule.forRoot(),
    BookingModule,
    DiscountsModule,
  ],
})
export class AppModule {}
