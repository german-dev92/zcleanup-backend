import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Booking, type BookingDocument } from './schemas/booking.schema';
import { CreateBookingDto } from './dto/create-booking.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DiscountsService } from '../discounts/discounts.service';
import { normalizeAddress } from '../common/utils/normalize-address';
import { type BookingStatus } from './types/booking-status';

@Injectable()
export class BookingService {
  constructor(
    @InjectModel(Booking.name)
    private bookingModel: Model<BookingDocument>,
    private eventEmitter: EventEmitter2,
    private discountsService: DiscountsService,
  ) {}

  async createBooking(data: CreateBookingDto) {
    try {
      data.email = this.normalizeEmail(data.email);
      if (!data.email) {
        throw new BadRequestException('Email is required');
      }

      const createPayload = { ...data, status: 'pending' as const };

      if (data.applyFirstDiscount) {
        const normalizedAddress = this.requireNormalizedAddress(data.address);

        try {
          const createdBooking = await this.createWithTransaction(
            createPayload,
            normalizedAddress,
          );
          this.emitBookingCreatedEvent(createdBooking);

          return {
            success: true,
            message: 'Booking saved successfully',
            data: createdBooking,
            discountApplied: true,
          };
        } catch (error) {
          if (this.isDuplicateKeyError(error)) {
            throw new ConflictException('Discount already used for this email');
          }

          if (this.isTransactionNotSupportedError(error)) {
            const createdBooking = await this.createWithoutTransaction(
              createPayload,
              normalizedAddress,
            );
            this.emitBookingCreatedEvent(createdBooking);

            return {
              success: true,
              message: 'Booking saved successfully',
              data: createdBooking,
              discountApplied: true,
            };
          }

          throw error;
        }
      }

      const savedBooking = await this.bookingModel.create(createPayload);

      this.emitBookingCreatedEvent(savedBooking);

      return {
        success: true,
        message: 'Booking saved successfully',
        data: savedBooking,
        discountApplied: savedBooking.applyFirstDiscount,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof ConflictException) {
        throw error;
      }
      if (this.isMongoValidationError(error)) {
        throw new BadRequestException('Invalid booking payload');
      }

      throw new InternalServerErrorException('Failed to save booking');
    }
  }

  async updateStatus(
    id: string,
    status: BookingStatus,
  ): Promise<BookingDocument> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid booking id');
    }

    const booking = await this.bookingModel.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    booking.status = status;
    return booking.save();
  }

  async getBookings(status?: BookingStatus): Promise<BookingDocument[]> {
    const filter = status ? { status } : {};
    return this.bookingModel.find(filter).sort({ createdAt: -1 });
  }

  async getById(id: string): Promise<BookingDocument> {
    const booking = await this.bookingModel.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').toLowerCase().trim();
  }

  private requireNormalizedAddress(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('Address is required to apply discount');
    }

    const normalized = normalizeAddress(value);
    if (!normalized) {
      throw new BadRequestException('Address is required to apply discount');
    }

    return normalized;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  private isTransactionNotSupportedError(error: unknown): boolean {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('message' in error) ||
      typeof (error as { message?: unknown }).message !== 'string'
    ) {
      return false;
    }

    const message = (error as { message: string }).message;
    return (
      message.includes('Transaction numbers are only allowed') ||
      message.includes('replica set member or mongos')
    );
  }

  private isMongoValidationError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      ((error as { name?: unknown }).name === 'ValidationError' ||
        (error as { name?: unknown }).name === 'CastError')
    );
  }

  private emitBookingCreatedEvent(booking: BookingDocument) {
    this.eventEmitter.emit('booking.created', booking);
  }

  private async createWithTransaction(
    data: CreateBookingDto & { status: BookingStatus },
    normalizedAddress: string,
  ): Promise<BookingDocument> {
    const session = await this.bookingModel.startSession();

    try {
      let savedBooking: BookingDocument | null = null;

      await session.withTransaction(async () => {
        const [createdBooking] = await this.bookingModel.create([data], {
          session,
        });

        await this.discountsService.markAddressAsUsed(
          {
            normalizedAddress,
            email: data.email,
            bookingId: String(createdBooking._id),
          },
          session,
        );

        savedBooking = createdBooking;
      });

      if (!savedBooking) {
        throw new InternalServerErrorException(
          'Booking transaction did not return a saved booking',
        );
      }

      return savedBooking;
    } finally {
      await session.endSession();
    }
  }

  private async createWithoutTransaction(
    data: CreateBookingDto & { status: BookingStatus },
    normalizedAddress: string,
  ): Promise<BookingDocument> {
    const bookingWithoutDiscount = {
      ...data,
      applyFirstDiscount: false,
    };

    const savedBooking = await this.bookingModel.create(bookingWithoutDiscount);

    try {
      await this.discountsService.markAddressAsUsed({
        normalizedAddress,
        email: data.email,
        bookingId: String(savedBooking._id),
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        await this.handleDuplicateDiscount(savedBooking);
      }
      throw error;
    }

    const updatedBooking = await this.bookingModel.findByIdAndUpdate(
      savedBooking._id,
      { $set: { applyFirstDiscount: true } },
      { new: true },
    );

    if (!updatedBooking) {
      throw new InternalServerErrorException(
        'Booking could not be updated after discount registration',
      );
    }

    return updatedBooking;
  }

  private async handleDuplicateDiscount(
    savedBooking: BookingDocument,
  ): Promise<never> {
    const patchedFields: Partial<BookingDocument> = {
      applyFirstDiscount: false,
    };

    if (
      savedBooking.estimatedPrice != null &&
      savedBooking.finalPricePreview != null &&
      savedBooking.finalPricePreview < savedBooking.estimatedPrice
    ) {
      patchedFields.finalPricePreview = savedBooking.estimatedPrice;
    }

    const patchedBooking = await this.bookingModel.findByIdAndUpdate(
      savedBooking._id,
      { $set: patchedFields },
      { new: true },
    );

    throw new ConflictException({
      message: 'Discount already used for this email',
      bookingId: String(savedBooking._id),
      booking: patchedBooking,
    });
  }
}
