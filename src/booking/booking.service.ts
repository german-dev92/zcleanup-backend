import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Booking, BookingDocument } from './schemas/booking.schema';
import { CreateBookingDto } from './dto/create-booking.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DiscountsService } from '../discounts/discounts.service';
import { normalizeAddress } from '../common/utils/normalize-address';
import { BookingStatus } from './types/booking-status';
import { StripeService } from '../payments/stripe.service';
import {
  Payment,
  type PaymentDocument,
} from '../payments/schemas/payment.schema';
import { BookingStateService } from './booking-state.service';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectModel(Booking.name)
    private bookingModel: Model<BookingDocument>,
    @InjectModel(Payment.name)
    private paymentModel: Model<PaymentDocument>,
    private eventEmitter: EventEmitter2,
    private discountsService: DiscountsService,
    private stripeService: StripeService,
    private bookingStateService: BookingStateService,
  ) {}

  async createBooking(data: CreateBookingDto) {
    try {
      data.email = this.normalizeEmail(data.email);

      if (!data.email) {
        throw new BadRequestException('Email is required');
      }

      if (
        data.estimatedPrice !== undefined ||
        data.finalPricePreview !== undefined
      ) {
        this.logger.debug(
          JSON.stringify({ event: 'pricing.client_snapshot_ignored' }),
        );
      }

      const desiredAt = this.parseDesiredDateTime(
        data.desiredDate,
        data.desiredTime,
      );
      if (desiredAt.getTime() <= Date.now()) {
        throw new BadRequestException(
          'Desired date/time must be in the future',
        );
      }

      const wantsDiscountRequested = data.applyFirstDiscount === true;
      let normalizedAddress: string | null = null;
      if (wantsDiscountRequested) {
        normalizedAddress = this.requireNormalizedAddress(data.address);
      }

      let discountEligible = false;
      if (wantsDiscountRequested) {
        const normalizedAddressForDiscount = normalizedAddress;
        if (!normalizedAddressForDiscount) {
          throw new BadRequestException('Address is required');
        }
        discountEligible =
          !(await this.discountsService.hasUsedDiscountByNormalizedAddress(
            normalizedAddressForDiscount,
          ));
      }

      if (wantsDiscountRequested && !normalizedAddress) {
        throw new BadRequestException('Address is required');
      }
      if (wantsDiscountRequested && normalizedAddress && !discountEligible) {
        throw new ConflictException('Discount already used for this address');
      }

      const discountApplied =
        wantsDiscountRequested &&
        discountEligible &&
        normalizedAddress !== null;
      const pricing = this.calculatePricing(data, discountApplied);

      this.logger.debug(
        JSON.stringify({
          event: 'discount.evaluated',
          requested: wantsDiscountRequested,
          eligible: discountEligible,
          applied: discountApplied,
        }),
      );
      this.logger.debug(
        JSON.stringify({
          event: 'pricing.computed',
          estimatedPrice: pricing.estimatedPrice,
          finalPrice: pricing.finalPrice,
        }),
      );

      const existing = await this.findRecentDuplicateBooking(data);
      if (existing) {
        const existingEstimated =
          existing.estimatedPrice ?? pricing.estimatedPrice;
        const existingFinal = existing.finalPricePreview ?? pricing.finalPrice;
        if (
          typeof existing.finalPricePreview === 'number' &&
          existing.finalPricePreview !== pricing.finalPrice
        ) {
          this.logger.warn(
            JSON.stringify({
              event: 'pricing.mismatch',
              bookingId: String(existing._id),
              storedFinalPricePreview: existing.finalPricePreview,
              computedFinalPrice: pricing.finalPrice,
            }),
          );
        }
        return {
          success: true,
          message: 'Booking saved successfully',
          data: this.toFrontendBooking(existing),
          discountApplied: existing.applyFirstDiscount === true,
          pricing: {
            estimatedPrice: existingEstimated,
            discountApplied: existing.applyFirstDiscount === true,
            finalPrice: existingFinal,
          },
        };
      }

      const bookingData = this.stripClientControlledFields(data);

      if (discountApplied && normalizedAddress) {
        try {
          const createdBooking = await this.createWithDiscountTransaction(
            bookingData,
            normalizedAddress,
            pricing,
          );
          this.logPricingMismatchIfDetected(createdBooking, pricing.finalPrice);
          this.emitBookingCreatedEvent(createdBooking);

          return {
            success: true,
            message: 'Booking saved successfully',
            data: this.toFrontendBooking(createdBooking),
            discountApplied: true,
            pricing: {
              estimatedPrice: pricing.estimatedPrice,
              discountApplied: true,
              finalPrice: pricing.finalPrice,
            },
          };
        } catch (error) {
          if (this.isTransactionNotSupportedError(error)) {
            this.logger.warn(
              JSON.stringify({
                event: 'discount.fallback_without_transaction',
              }),
            );
            const createdBooking = await this.createWithDiscountRollback(
              bookingData,
              normalizedAddress,
              pricing,
            );
            this.logPricingMismatchIfDetected(
              createdBooking,
              pricing.finalPrice,
            );
            this.emitBookingCreatedEvent(createdBooking);

            return {
              success: true,
              message: 'Booking saved successfully',
              data: this.toFrontendBooking(createdBooking),
              discountApplied: true,
              pricing: {
                estimatedPrice: pricing.estimatedPrice,
                discountApplied: true,
                finalPrice: pricing.finalPrice,
              },
            };
          }

          throw error;
        }
      }

      const payload = {
        ...bookingData,
        status: 'pending' as const,
        applyFirstDiscount: false,
        estimatedPrice: pricing.estimatedPrice,
        finalPricePreview: pricing.finalPrice,
      };

      const createdBooking = await this.bookingModel.create(payload);
      this.logPricingMismatchIfDetected(createdBooking, pricing.finalPrice);
      this.emitBookingCreatedEvent(createdBooking);

      return {
        success: true,
        message: 'Booking saved successfully',
        data: this.toFrontendBooking(createdBooking),
        discountApplied: false,
        pricing: {
          estimatedPrice: pricing.estimatedPrice,
          discountApplied: false,
          finalPrice: pricing.finalPrice,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof ConflictException) throw error;

      throw new InternalServerErrorException('Failed to save booking');
    }
  }

  async updateStatus(id: string, status: BookingStatus) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid booking id');
    }

    const booking = await this.bookingModel.findById(id);
    if (!booking) throw new NotFoundException('Booking not found');

    const previous = booking.status;
    const next = this.bookingStateService.transitionBooking({
      current: previous,
      next: status,
      source: 'admin',
    });

    if (previous !== next && next === 'confirmed') {
      const expectedAmount = booking.finalPricePreview;
      const isValidPrice =
        typeof expectedAmount === 'number' &&
        Number.isFinite(expectedAmount) &&
        expectedAmount > 0;
      if (!isValidPrice) {
        throw new InternalServerErrorException('Invalid booking price');
      }

      const existingPayment = await this.paymentModel.findOne({
        bookingId: String(booking._id),
        provider: 'stripe',
      });
      if (
        existingPayment &&
        typeof existingPayment.amount === 'number' &&
        existingPayment.amount !== expectedAmount
      ) {
        throw new InternalServerErrorException('Payment amount mismatch');
      }

      const existingUrl =
        typeof booking.paymentUrl === 'string' ? booking.paymentUrl.trim() : '';
      if (existingUrl) {
        await this.paymentModel.findOneAndUpdate(
          { bookingId: String(booking._id), provider: 'stripe' },
          {
            $setOnInsert: {
              bookingId: String(booking._id),
              provider: 'stripe',
              status: 'pending',
              amount: expectedAmount,
              currency: 'usd',
            },
          },
          { upsert: true },
        );
      } else {
        const details =
          await this.stripeService.createCheckoutSessionDetails(booking);
        const currency = details.currency ?? 'usd';
        const amountFromStripe =
          typeof details.amountTotal === 'number'
            ? details.amountTotal / 100
            : null;
        if (amountFromStripe !== null && amountFromStripe !== expectedAmount) {
          throw new InternalServerErrorException('Stripe amount mismatch');
        }

        await this.paymentModel.findOneAndUpdate(
          { bookingId: String(booking._id), provider: 'stripe' },
          {
            $setOnInsert: {
              bookingId: String(booking._id),
              provider: 'stripe',
              status: 'pending',
              amount: expectedAmount,
              currency,
            },
            $set: {
              checkoutSessionId: details.id,
              paymentIntentId: details.paymentIntentId ?? undefined,
            },
          },
          { upsert: true },
        );

        booking.paymentUrl = details.url;
      }
    }

    booking.status = next;

    const updated = await booking.save();

    if (previous !== next) {
      if (next === 'confirmed') {
        this.eventEmitter.emit('booking.confirmed', updated);
      }
      if (next === 'cancelled') {
        this.eventEmitter.emit('booking.cancelled', updated);
      }
    }

    return updated;
  }

  async getBookings(status?: BookingStatus) {
    const filter = status ? { status } : {};
    return this.bookingModel.find(filter).sort({ createdAt: -1 });
  }

  async getById(id: string) {
    const booking = await this.bookingModel.findById(id);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  // --------------------------
  // HELPERS
  // --------------------------

  private normalizeEmail(email: string): string {
    return (email ?? '').toLowerCase().trim();
  }

  private requireNormalizedAddress(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('Address is required');
    }

    const normalized = normalizeAddress(value);

    if (!normalized) {
      throw new BadRequestException('Address is required');
    }

    return normalized;
  }

  private normalizeAddressIfPresent(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = normalizeAddress(value);
    return normalized ? normalized : null;
  }

  private stripClientControlledFields(
    data: CreateBookingDto,
  ): Omit<
    CreateBookingDto,
    'estimatedPrice' | 'finalPricePreview' | 'applyFirstDiscount'
  > {
    const {
      estimatedPrice: _estimatedPrice,
      finalPricePreview: _finalPricePreview,
      applyFirstDiscount: _applyFirstDiscount,
      ...rest
    } = data;
    void _estimatedPrice;
    void _finalPricePreview;
    void _applyFirstDiscount;
    return rest;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  private emitBookingCreatedEvent(booking: BookingDocument) {
    this.eventEmitter.emit('booking.created', booking);
  }

  private async createWithDiscountTransaction(
    data: Omit<
      CreateBookingDto,
      'estimatedPrice' | 'finalPricePreview' | 'applyFirstDiscount'
    >,
    normalizedAddress: string,
    pricing: { estimatedPrice: number; finalPrice: number },
  ): Promise<BookingDocument> {
    const session = await this.bookingModel.startSession();

    try {
      let saved: BookingDocument | null = null;

      await session.withTransaction(async () => {
        const [createdBooking] = await this.bookingModel.create(
          [
            {
              ...data,
              status: 'pending' as const,
              applyFirstDiscount: true,
              estimatedPrice: pricing.estimatedPrice,
              finalPricePreview: pricing.finalPrice,
            },
          ],
          { session },
        );

        await this.discountsService.markAddressAsUsed(
          {
            normalizedAddress,
            email: data.email,
            bookingId: String(createdBooking._id),
          },
          session,
        );

        saved = createdBooking;
      });

      if (!saved) {
        throw new InternalServerErrorException('Booking transaction failed');
      }

      return saved;
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Discount already used for this address');
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  private async createWithDiscountRollback(
    data: Omit<
      CreateBookingDto,
      'estimatedPrice' | 'finalPricePreview' | 'applyFirstDiscount'
    >,
    normalizedAddress: string,
    pricing: { estimatedPrice: number; finalPrice: number },
  ): Promise<BookingDocument> {
    const bookingPayload = {
      ...data,
      status: 'pending' as const,
      applyFirstDiscount: false,
      estimatedPrice: pricing.estimatedPrice,
      finalPricePreview: pricing.finalPrice,
    };

    const createdBooking = await this.bookingModel.create(bookingPayload);

    try {
      await this.discountsService.markAddressAsUsed({
        normalizedAddress,
        email: data.email,
        bookingId: String(createdBooking._id),
      });
    } catch (error) {
      await this.bookingModel.deleteOne({ _id: createdBooking._id });
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Discount already used for this address');
      }
      throw error;
    }

    const updated = await this.bookingModel.findByIdAndUpdate(
      createdBooking._id,
      {
        $set: {
          applyFirstDiscount: true,
          finalPricePreview: pricing.finalPrice,
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new InternalServerErrorException('Booking update failed');
    }

    return updated;
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

  private async findRecentDuplicateBooking(
    data: CreateBookingDto,
  ): Promise<BookingDocument | null> {
    const email = this.normalizeEmail(data.email);
    const address = typeof data.address === 'string' ? data.address.trim() : '';
    const windowStart = new Date(Date.now() - 10 * 60 * 1000);

    const baseFilter: Record<string, unknown> = {
      email,
      cleaningType: data.cleaningType,
      desiredDate: data.desiredDate,
      desiredTime: data.desiredTime,
      createdAt: { $gte: windowStart },
    };

    if (address) {
      return this.bookingModel
        .findOne({ ...baseFilter, address })
        .sort({ createdAt: -1 });
    }

    return this.bookingModel.findOne({
      ...baseFilter,
      $or: [
        { address: { $exists: false } },
        { address: null },
        { address: '' },
      ],
    });
  }

  private parseDesiredDateTime(desiredDate: string, desiredTime: string): Date {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(desiredDate);
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(desiredTime);

    if (!dateMatch || !timeMatch) {
      throw new BadRequestException('Invalid desiredDate/desiredTime format');
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);

    const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (Number.isNaN(dt.getTime())) {
      throw new BadRequestException('Invalid desiredDate/desiredTime');
    }

    return dt;
  }

  private calculatePricing(
    data: CreateBookingDto,
    discountApplied: boolean,
  ): { estimatedPrice: number; finalPrice: number } {
    const cleaningType = (data.cleaningType ?? '').toLowerCase();
    const base = cleaningType.includes('deep')
      ? 160
      : cleaningType.includes('move')
        ? 180
        : cleaningType.includes('office')
          ? 200
          : cleaningType.includes('basic')
            ? 100
            : 120;

    const extrasCount = Array.isArray(data.extras) ? data.extras.length : 0;
    const extrasFee = extrasCount * 15;
    const petsFee = data.petsAtHome === true ? 10 : 0;

    const estimatedPrice = this.roundCurrency(base + extrasFee + petsFee);
    const discountPercent = this.getFirstTimeDiscountPercent();
    const discounted = discountApplied
      ? estimatedPrice * (1 - discountPercent / 100)
      : estimatedPrice;

    return {
      estimatedPrice,
      finalPrice: this.roundCurrency(discounted),
    };
  }

  private getFirstTimeDiscountPercent(): number {
    const raw = process.env.FIRST_TIME_DISCOUNT_PERCENT;
    const parsed = raw ? Number(raw) : 15;
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
      return 15;
    }
    return parsed;
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private toFrontendBooking(booking: BookingDocument): Record<string, unknown> {
    const obj =
      typeof booking.toObject === 'function'
        ? (booking.toObject() as Record<string, unknown>)
        : (booking as unknown as Record<string, unknown>);

    const statusValue = obj.status;
    const safeStatus = typeof statusValue === 'string' ? statusValue : '';

    return {
      ...obj,
      _id: String(booking._id),
      status: safeStatus,
    };
  }

  private logPricingMismatchIfDetected(
    booking: BookingDocument,
    expectedFinalPrice: number,
  ) {
    const stored = booking.finalPricePreview;
    if (typeof stored === 'number' && stored !== expectedFinalPrice) {
      this.logger.warn(
        JSON.stringify({
          event: 'pricing.mismatch',
          bookingId: String(booking._id),
          storedFinalPricePreview: stored,
          expectedFinalPrice,
        }),
      );
    }
  }
}
