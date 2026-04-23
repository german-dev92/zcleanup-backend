import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsDefined, IsIn, IsOptional, IsString } from 'class-validator';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BOOKING_STATUSES, type BookingStatus } from './types/booking-status';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

class UpdateBookingStatusDto {
  @IsDefined({ message: 'status is required' })
  @IsString({ message: 'status must be a string' })
  @IsIn(BOOKING_STATUSES, {
    message: `status must be one of: ${BOOKING_STATUSES.join(', ')}`,
  })
  status: BookingStatus;
}

class GetBookingsQueryDto {
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;
}

@Controller('booking')
export class BookingController {
  private readonly logger = new Logger(BookingController.name);

  constructor(private readonly bookingService: BookingService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getBookings(@Query() query: GetBookingsQueryDto) {
    return this.bookingService.getBookings(query.status);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.bookingService.getById(id);
  }

  @Post()
  createBooking(@Body() body: CreateBookingDto) {
    return this.bookingService.createBooking(body);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateBookingStatus(
    @Param('id') id: string,
    @Body() body: UpdateBookingStatusDto,
  ) {
    this.logger.log('PATCH /booking/:id/status');
    this.logger.log(`ID: ${id}`);
    this.logger.log(`BODY: ${JSON.stringify(body)}`);

    const booking = await this.bookingService.updateStatus(id, body.status);
    return {
      success: true,
      message: 'Booking status updated',
      data: booking,
    };
  }
}
