import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { Booking, BookingSchema } from './schemas/booking.schema';

import { EmailModule } from '../email/email.module';
import { DiscountsModule } from '../discounts/discounts.module'; // 👈 IMPORT

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Booking.name, schema: BookingSchema }]),

    EmailModule, // 👈 ya lo tienes
    DiscountsModule, // 👈 ESTE ES EL QUE TE FALTA O ESTÁ MAL
  ],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
