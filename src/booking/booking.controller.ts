import { Body, Controller, Param, Patch, Post, Get } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BOOKING_STATUSES, type BookingStatus } from './types/booking-status';

class UpdateBookingStatusDto {
  @IsIn(BOOKING_STATUSES)
  status: BookingStatus;
}

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) { }
@Get('ping')
ping() {
  console.log('PING HIT');
  return { ok: true };
}
  @Post()
  createBooking(@Body() body: CreateBookingDto) {
    return this.bookingService.createBooking(body);
  }

  @Patch(':id/status')
  updateBookingStatus(
    @Param('id') id: string,
    @Body() body: UpdateBookingStatusDto,
  ) {
    console.log('HIT ENDPOINT');
    return this.bookingService.updateStatus(id, body.status);
  }

}
