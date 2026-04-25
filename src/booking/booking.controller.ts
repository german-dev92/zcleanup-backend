import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BOOKING_STATUSES, type BookingStatus } from './types/booking-status';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../auth/roles.enum';
import type { AuthUser } from '../auth/auth.types';

function IsExtrasArray(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isExtrasArray',
      target: object.constructor,
      propertyName,
      constraints: [],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          void args;
          if (value == null) {
            return true;
          }
          if (!Array.isArray(value)) {
            return false;
          }

          for (const item of value) {
            if (typeof item === 'string') {
              continue;
            }

            if (typeof item === 'object' && item !== null) {
              const typeValue = (item as { type?: unknown }).type;
              const quantityValue = (item as { quantity?: unknown }).quantity;
              if (typeof typeValue !== 'string' || !typeValue.trim()) {
                return false;
              }

              if (quantityValue == null) {
                continue;
              }

              const quantity =
                typeof quantityValue === 'number'
                  ? quantityValue
                  : typeof quantityValue === 'string'
                    ? Number(quantityValue)
                    : NaN;
              if (!Number.isFinite(quantity) || Math.trunc(quantity) <= 0) {
                return false;
              }

              continue;
            }

            return false;
          }

          return true;
        },
      },
    });
  };
}

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

class AssignBookingDto {
  @IsOptional()
  @IsString({ message: 'supervisorId must be a string' })
  supervisorId?: string;

  @IsOptional()
  @IsArray({ message: 'employeeIds must be an array' })
  @ArrayNotEmpty({ message: 'employeeIds cannot be empty' })
  @IsString({ each: true, message: 'employeeIds must be strings' })
  employeeIds?: string[];

  @IsOptional()
  @IsString({ message: 'employeeId must be a string' })
  employeeId?: string;
}

class PricePreviewDto {
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  cleaningType?: string;

  @IsOptional()
  @IsString()
  serviceType?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  additionalBedrooms?: number;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsExtrasArray()
  extras?: any[];

  @IsOptional()
  @IsObject()
  dynamicFields?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  petsAtHome?: boolean;

  @IsOptional()
  @IsBoolean()
  distanceSurcharge?: boolean;

  @IsOptional()
  @IsBoolean()
  applyFirstDiscount?: boolean;

  @IsOptional()
  @IsString()
  moveMode?: string;

  @IsOptional()
  @IsObject()
  postConstruction?: Record<string, any>;

  @IsOptional()
  @IsObject()
  windowCleaning?: Record<string, any>;
}

@Controller('booking')
export class BookingController {
  private readonly logger = new Logger(BookingController.name);

  constructor(private readonly bookingService: BookingService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  getBookings(@Query() query: GetBookingsQueryDto) {
    return this.bookingService.getBookings(query.status);
  }

  @Get('assigned')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE)
  getAssignedBookings(@Req() req: { user?: AuthUser }) {
    return this.bookingService.getAssignedBookings(req.user);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  getById(@Param('id') id: string) {
    return this.bookingService.getById(id);
  }

  @Post('price-preview')
  pricePreview(@Body() body: PricePreviewDto) {
    return this.bookingService.previewPricing(
      body as unknown as CreateBookingDto,
    );
  }

  @Post()
  createBooking(@Body() body: CreateBookingDto) {
    return this.bookingService.createBooking(body);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
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
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Patch(':id/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async assignBooking(@Param('id') id: string, @Body() body: AssignBookingDto) {
    const employeeIds = Array.isArray(body.employeeIds)
      ? body.employeeIds
      : typeof body.employeeId === 'string' && body.employeeId.trim()
        ? [body.employeeId]
        : [];

    const booking = await this.bookingService.assignBooking(id, {
      supervisorId: body.supervisorId,
      employeeIds,
    });
    return {
      success: true,
      message: 'Booking assigned',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Patch(':id/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.SUPERVISOR)
  async startBooking(@Param('id') id: string, @Req() req: { user?: AuthUser }) {
    const booking = await this.bookingService.startBooking(id, req.user);
    return {
      success: true,
      message: 'Job started',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.SUPERVISOR)
  async completeBooking(
    @Param('id') id: string,
    @Req() req: { user?: AuthUser },
  ) {
    const booking = await this.bookingService.completeBooking(id, req.user);
    return {
      success: true,
      message: 'Job completed',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }
}
