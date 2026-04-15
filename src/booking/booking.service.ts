import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Booking } from './schemas/booking.schema';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingService {
  constructor(
    @InjectModel(Booking.name)
    private bookingModel: Model<Booking>,
  ) {}

  async createBooking(data: CreateBookingDto) {
    const newBooking = new this.bookingModel(data);
    await newBooking.save();

    return {
      success: true,
      message: 'Booking saved in database',
      data: newBooking,
    };
  }
}