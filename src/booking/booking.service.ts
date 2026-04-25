import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { EmployeesService } from '../employees/employees.service';
import type { AuthUser } from '../auth/auth.types';
import { UserRole } from '../auth/roles.enum';

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
    private employeesService: EmployeesService,
  ) {}

  async previewPricing(data: CreateBookingDto) {
    const wantsDiscountRequested = data.applyFirstDiscount === true;

    let discountEligible = false;
    let discountApplied = false;
    if (wantsDiscountRequested) {
      const address =
        typeof data.address === 'string' ? data.address.trim() : '';
      if (address) {
        try {
          const normalizedAddress = this.requireNormalizedAddress(address);
          discountEligible =
            !(await this.discountsService.hasUsedDiscountByNormalizedAddress(
              normalizedAddress,
            ));
          discountApplied = discountEligible;
        } catch {
          discountEligible = false;
          discountApplied = false;
        }
      }
    }

    const pricing = this.calculatePricingBreakdown(data, discountApplied);
    return {
      estimatedPrice: pricing.estimatedPrice,
      finalPricePreview: pricing.finalPrice,
      baseServicePrice: pricing.baseServicePrice,
      additionalBedroomsFee: pricing.additionalBedroomsFee,
      discountedEstimatedPrice: pricing.discountedEstimatedPrice,
      discountPercent: pricing.discountPercent,
      discountAmount: pricing.discountAmount,
      extrasTotal: pricing.extrasTotal,
      petsFee: pricing.petsFee,
      distanceFee: pricing.distanceFee,
      discountRequested: wantsDiscountRequested,
      discountEligible,
      discountApplied,
    };
  }

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
      const pricing = this.calculatePricingBreakdown(data, discountApplied);

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
    await this.attachAssignedEmployeeMeta([updated]);

    if (previous !== next) {
      if (next === 'confirmed') {
        this.eventEmitter.emit('booking.confirmed', {
          ...this.toFrontendBooking(updated),
          bookingId: String(updated._id),
        });
      }
      if (next === 'cancelled') {
        this.eventEmitter.emit('booking.cancelled', {
          ...this.toFrontendBooking(updated),
          bookingId: String(updated._id),
        });
      }
    }

    return updated;
  }

  async getBookings(
    status?: BookingStatus,
  ): Promise<Record<string, unknown>[]> {
    const filter = status ? { status } : {};
    const bookings = await this.bookingModel
      .find(filter)
      .sort({ createdAt: -1 });
    await this.attachAssignedEmployeeMeta(bookings);
    return bookings.map((b) => this.toFrontendBooking(b));
  }

  async getById(id: string): Promise<Record<string, unknown>> {
    const booking = await this.bookingModel.findById(id);
    if (!booking) throw new NotFoundException('Booking not found');
    await this.attachAssignedEmployeeMeta([booking]);
    return this.toFrontendBooking(booking);
  }

  async assignBooking(
    bookingId: string,
    input: { supervisorId?: string; employeeIds: string[] },
  ): Promise<BookingDocument> {
    if (!isValidObjectId(bookingId)) {
      throw new BadRequestException('Invalid booking id');
    }
    const employeeIds = Array.isArray(input.employeeIds)
      ? input.employeeIds.filter((id) => typeof id === 'string')
      : [];

    const supervisorIdRaw =
      typeof input.supervisorId === 'string' ? input.supervisorId : '';
    const supervisorId = supervisorIdRaw.trim();

    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.status === 'cancelled') {
      throw new ConflictException('Cannot assign a cancelled booking');
    }
    if (booking.paymentStatus === 'paid' || booking.status === 'paid') {
      throw new ConflictException('Cannot assign a paid booking');
    }
    if (booking.status === 'completed') {
      throw new ConflictException('Cannot assign a completed booking');
    }

    const assignable =
      booking.status === 'confirmed' || booking.status === 'assigned';
    if (!assignable) {
      throw new BadRequestException(
        'Booking can only be assigned/reassigned when confirmed or assigned',
      );
    }

    const normalizedEmployeeIds = Array.from(
      new Set(employeeIds.map((id) => id.trim()).filter((id) => id)),
    );
    if (normalizedEmployeeIds.length === 0) {
      throw new BadRequestException('employeeIds is required');
    }
    for (const id of normalizedEmployeeIds) {
      if (!isValidObjectId(id)) {
        throw new BadRequestException('Invalid employee id');
      }
    }

    if (supervisorId && !isValidObjectId(supervisorId)) {
      throw new BadRequestException('Invalid supervisor id');
    }

    const employeesMap =
      await this.employeesService.getActiveEmployeesWithUserMeta(
        normalizedEmployeeIds,
      );

    for (const id of normalizedEmployeeIds) {
      const meta = employeesMap.get(id);
      if (!meta) {
        throw new NotFoundException('Employee not found');
      }
      if (meta.userRole !== UserRole.EMPLOYEE) {
        throw new BadRequestException('Employees must have employee role');
      }
    }

    let supervisorSnapshot: { employeeId: unknown; name: string } | undefined =
      undefined;
    if (supervisorId) {
      const supervisorMeta =
        await this.employeesService.getActiveEmployeeWithUserEmail(
          supervisorId,
        );
      if (supervisorMeta.userRole !== UserRole.SUPERVISOR) {
        throw new BadRequestException('Supervisor must have supervisor role');
      }
      supervisorSnapshot = {
        employeeId: supervisorMeta.employee._id,
        name:
          typeof supervisorMeta.employee.name === 'string'
            ? supervisorMeta.employee.name.trim()
            : '',
      };
    }

    const currentAssignedEmployeeIds = Array.isArray(booking.assignedEmployees)
      ? booking.assignedEmployees
          .map((entry) =>
            entry && typeof entry === 'object' && 'employeeId' in entry
              ? String((entry as { employeeId?: unknown }).employeeId)
              : '',
          )
          .filter((id) => id)
      : booking.assignedEmployeeId
        ? [String(booking.assignedEmployeeId)]
        : [];
    const currentSupervisorId =
      booking.assignedSupervisor &&
      typeof booking.assignedSupervisor === 'object' &&
      'employeeId' in booking.assignedSupervisor
        ? String(
            (booking.assignedSupervisor as { employeeId?: unknown }).employeeId,
          )
        : '';

    const currentEmployeeSet = new Set(currentAssignedEmployeeIds);
    const nextEmployeeSet = new Set(normalizedEmployeeIds);
    const sameEmployees =
      currentEmployeeSet.size === nextEmployeeSet.size &&
      Array.from(nextEmployeeSet).every((id) => currentEmployeeSet.has(id));
    const sameSupervisor = supervisorId
      ? currentSupervisorId === supervisorId
      : !currentSupervisorId;

    if (sameEmployees && sameSupervisor && booking.status === 'assigned') {
      await this.attachAssignedEmployeeMeta([booking]);
      return booking;
    }

    const assignedEmployeesSnapshot = normalizedEmployeeIds.map((id) => {
      const meta = employeesMap.get(id);
      const employee = meta?.employee;
      return {
        employeeId: employee?._id,
        name:
          employee && typeof employee.name === 'string'
            ? employee.name.trim()
            : '',
        role: meta?.userRole ?? UserRole.EMPLOYEE,
      };
    });

    const primaryEmployeeId = normalizedEmployeeIds[0];
    const primaryMeta = employeesMap.get(primaryEmployeeId);
    const primaryEmployee = primaryMeta?.employee;
    const primaryEmail = primaryMeta?.userEmail ?? '';
    const primaryName =
      primaryEmployee && typeof primaryEmployee.name === 'string'
        ? primaryEmployee.name.trim()
        : '';

    const baseFilter = {
      _id: booking._id,
      status: { $in: ['confirmed', 'assigned'] },
      paymentStatus: { $ne: 'paid' },
    };

    const updateCore = {
      assignedEmployees: assignedEmployeesSnapshot,
      assignedEmployeeId: primaryEmployee?._id,
      assignedEmployeeEmail: primaryEmail,
      assignedEmployeeName: primaryName,
      status: 'assigned' as const,
    };

    const update: Record<string, unknown> = { $set: updateCore };
    if (supervisorSnapshot) {
      (update.$set as Record<string, unknown>)['assignedSupervisor'] =
        supervisorSnapshot;
    } else {
      update['$unset'] = { assignedSupervisor: 1 };
    }

    const now = new Date();
    const updatedWithAssignedAt = await this.bookingModel.findOneAndUpdate(
      { ...baseFilter, assignedAt: { $exists: false } },
      {
        ...update,
        $set: { ...(update.$set as Record<string, unknown>), assignedAt: now },
      },
      { new: true },
    );
    if (updatedWithAssignedAt) {
      return updatedWithAssignedAt;
    }

    const updated = await this.bookingModel.findOneAndUpdate(
      baseFilter,
      update,
      { new: true },
    );
    if (!updated) {
      throw new ConflictException('Booking assignment conflict');
    }

    return updated;
  }

  async startBooking(
    bookingId: string,
    user?: AuthUser,
  ): Promise<BookingDocument> {
    if (!isValidObjectId(bookingId)) {
      throw new BadRequestException('Invalid booking id');
    }

    const userId = typeof user?.sub === 'string' ? user.sub : '';
    if (!userId) {
      throw new BadRequestException('Invalid employee');
    }

    const employee =
      await this.employeesService.getActiveEmployeeByUserId(userId);

    const actorRole = user?.role;
    const isSupervisor = actorRole === UserRole.SUPERVISOR;

    const updated = await this.bookingModel.findOneAndUpdate(
      {
        _id: bookingId,
        $or: isSupervisor
          ? [{ 'assignedSupervisor.employeeId': employee._id }]
          : [
              { assignedEmployeeId: employee._id },
              { 'assignedEmployees.employeeId': employee._id },
            ],
        status: 'assigned',
        startedAt: { $exists: false },
      },
      { $set: { status: 'in_progress', startedAt: new Date() } },
      { new: true },
    );

    if (updated) {
      await this.attachAssignedEmployeeMeta([updated]);
      return updated;
    }

    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (isSupervisor) {
      const supervisorId =
        booking.assignedSupervisor &&
        typeof booking.assignedSupervisor === 'object' &&
        'employeeId' in booking.assignedSupervisor
          ? String(
              (booking.assignedSupervisor as { employeeId?: unknown }).employeeId,
            )
          : '';
      if (!supervisorId) {
        throw new BadRequestException('Booking is not assigned');
      }
      if (supervisorId !== String(employee._id)) {
        throw new ForbiddenException('You are not assigned to this booking');
      }
    } else {
      const assignedEmployeeIds = Array.isArray(booking.assignedEmployees)
        ? booking.assignedEmployees
            .map((entry) =>
              entry && typeof entry === 'object' && 'employeeId' in entry
                ? String((entry as { employeeId?: unknown }).employeeId)
                : '',
            )
            .filter((id) => id)
        : [];
      const legacyAssignedEmployeeId = booking.assignedEmployeeId
        ? String(booking.assignedEmployeeId)
        : '';
      const isAssigned =
        assignedEmployeeIds.includes(String(employee._id)) ||
        legacyAssignedEmployeeId === String(employee._id);
      if (!isAssigned) {
        const hasAnyAssignment =
          assignedEmployeeIds.length > 0 || Boolean(legacyAssignedEmployeeId);
        if (!hasAnyAssignment) {
          throw new BadRequestException('Booking is not assigned');
        }
        throw new ForbiddenException('You are not assigned to this booking');
      }
    }
    if (booking.status !== 'assigned') {
      throw new BadRequestException('Booking must be assigned before start');
    }
    if (booking.startedAt) {
      await this.attachAssignedEmployeeMeta([booking]);
      return booking;
    }

    throw new ConflictException('Job start conflict');
  }

  async completeBooking(
    bookingId: string,
    user?: AuthUser,
  ): Promise<BookingDocument> {
    if (!isValidObjectId(bookingId)) {
      throw new BadRequestException('Invalid booking id');
    }

    const userId = typeof user?.sub === 'string' ? user.sub : '';
    if (!userId) {
      throw new BadRequestException('Invalid employee');
    }

    const employee =
      await this.employeesService.getActiveEmployeeByUserId(userId);

    const actorRole = user?.role;
    const isSupervisor = actorRole === UserRole.SUPERVISOR;

    const updated = await this.bookingModel.findOneAndUpdate(
      {
        _id: bookingId,
        $or: isSupervisor
          ? [{ 'assignedSupervisor.employeeId': employee._id }]
          : [
              { assignedEmployeeId: employee._id },
              { 'assignedEmployees.employeeId': employee._id },
            ],
        status: 'in_progress',
        completedAt: { $exists: false },
      },
      { $set: { status: 'completed', completedAt: new Date() } },
      { new: true },
    );

    if (updated) {
      await this.attachAssignedEmployeeMeta([updated]);
      return updated;
    }

    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (isSupervisor) {
      const supervisorId =
        booking.assignedSupervisor &&
        typeof booking.assignedSupervisor === 'object' &&
        'employeeId' in booking.assignedSupervisor
          ? String(
              (booking.assignedSupervisor as { employeeId?: unknown }).employeeId,
            )
          : '';
      if (!supervisorId) {
        throw new BadRequestException('Booking is not assigned');
      }
      if (supervisorId !== String(employee._id)) {
        throw new ForbiddenException('You are not assigned to this booking');
      }
    } else {
      const assignedEmployeeIds = Array.isArray(booking.assignedEmployees)
        ? booking.assignedEmployees
            .map((entry) =>
              entry && typeof entry === 'object' && 'employeeId' in entry
                ? String((entry as { employeeId?: unknown }).employeeId)
                : '',
            )
            .filter((id) => id)
        : [];
      const legacyAssignedEmployeeId = booking.assignedEmployeeId
        ? String(booking.assignedEmployeeId)
        : '';
      const isAssigned =
        assignedEmployeeIds.includes(String(employee._id)) ||
        legacyAssignedEmployeeId === String(employee._id);
      if (!isAssigned) {
        const hasAnyAssignment =
          assignedEmployeeIds.length > 0 || Boolean(legacyAssignedEmployeeId);
        if (!hasAnyAssignment) {
          throw new BadRequestException('Booking is not assigned');
        }
        throw new ForbiddenException('You are not assigned to this booking');
      }
    }
    if (booking.status !== 'in_progress') {
      throw new BadRequestException(
        'Booking must be in progress before completion',
      );
    }
    if (booking.completedAt) {
      await this.attachAssignedEmployeeMeta([booking]);
      return booking;
    }

    throw new ConflictException('Job completion conflict');
  }

  async getAssignedBookings(
    user?: AuthUser,
  ): Promise<Record<string, unknown>[]> {
    const userId = typeof user?.sub === 'string' ? user.sub : '';
    if (!userId) {
      throw new BadRequestException('Invalid employee');
    }

    const employee =
      await this.employeesService.getActiveEmployeeByUserId(userId);

    const employeeEmail =
      typeof user?.email === 'string' ? this.normalizeEmail(user.email) : '';

    const bookings = await this.bookingModel
      .find({
        $or: [
          { 'assignedEmployees.employeeId': employee._id },
          { assignedEmployeeId: employee._id },
          ...(employeeEmail ? [{ assignedEmployeeEmail: employeeEmail }] : []),
        ],
      })
      .sort({ desiredDate: 1, desiredTime: 1 });
    await this.attachAssignedEmployeeMeta(bookings);
    return bookings.map((b) => this.toFrontendBooking(b));
  }

  // --------------------------

  private normalizeEmail(email: string): string {
    return (email ?? '').toLowerCase().trim();
  }

  private async attachAssignedEmployeeMeta(bookings: BookingDocument[]) {
    const employeeIds: string[] = [];
    for (const booking of bookings) {
      if (booking.assignedEmployeeId) {
        employeeIds.push(String(booking.assignedEmployeeId));
      }
      if (Array.isArray(booking.assignedEmployees)) {
        for (const entry of booking.assignedEmployees) {
          if (
            entry &&
            typeof entry === 'object' &&
            'employeeId' in entry &&
            (entry as { employeeId?: unknown }).employeeId
          ) {
            employeeIds.push(
              String((entry as { employeeId?: unknown }).employeeId),
            );
          }
        }
      }
      if (
        booking.assignedSupervisor &&
        typeof booking.assignedSupervisor === 'object' &&
        'employeeId' in booking.assignedSupervisor &&
        (booking.assignedSupervisor as { employeeId?: unknown }).employeeId
      ) {
        employeeIds.push(
          String(
            (booking.assignedSupervisor as { employeeId?: unknown }).employeeId,
          ),
        );
      }
    }

    const map = await this.employeesService.getEmployeeMetaMap(employeeIds);

    for (const booking of bookings) {
      if (!booking.assignedEmployeeId) {
        if (
          Array.isArray(booking.assignedEmployees) &&
          booking.assignedEmployees.length > 0
        ) {
          for (const entry of booking.assignedEmployees) {
            const entryId =
              entry &&
              typeof entry === 'object' &&
              'employeeId' in entry &&
              (entry as { employeeId?: unknown }).employeeId
                ? String((entry as { employeeId?: unknown }).employeeId)
                : '';
            if (!entryId) continue;
            const meta = map.get(entryId);
            if (
              entry &&
              typeof entry === 'object' &&
              'name' in entry &&
              !(entry as { name?: unknown }).name
            ) {
              (entry as { name?: unknown }).name = meta?.name ?? '';
            }
            if (
              entry &&
              typeof entry === 'object' &&
              'role' in entry &&
              !(entry as { role?: unknown }).role
            ) {
              (entry as { role?: unknown }).role =
                meta?.role ?? UserRole.EMPLOYEE;
            }
          }
        }

        if (
          booking.assignedSupervisor &&
          typeof booking.assignedSupervisor === 'object' &&
          'employeeId' in booking.assignedSupervisor
        ) {
          const supId = String(
            (booking.assignedSupervisor as { employeeId?: unknown }).employeeId,
          );
          const supMeta = map.get(supId);
          if (
            'name' in booking.assignedSupervisor &&
            !(booking.assignedSupervisor as { name?: unknown }).name
          ) {
            (booking.assignedSupervisor as { name?: unknown }).name =
              supMeta?.name ?? '';
          }
        }

        continue;
      }

      const meta = map.get(String(booking.assignedEmployeeId));

      if (!booking.assignedEmployeeEmail) {
        booking.assignedEmployeeEmail = meta?.email ?? '';
      }
      if (!booking.assignedEmployeeName) {
        booking.assignedEmployeeName = meta?.name ?? '';
      }

      if (
        (!Array.isArray(booking.assignedEmployees) ||
          booking.assignedEmployees.length === 0) &&
        booking.assignedEmployeeId
      ) {
        booking.assignedEmployees = [
          {
            employeeId: booking.assignedEmployeeId,
            name: booking.assignedEmployeeName ?? meta?.name ?? '',
            role: meta?.role ?? UserRole.EMPLOYEE,
          },
        ] as unknown as typeof booking.assignedEmployees;
      }

      if (Array.isArray(booking.assignedEmployees)) {
        for (const entry of booking.assignedEmployees) {
          const entryId =
            entry &&
            typeof entry === 'object' &&
            'employeeId' in entry &&
            (entry as { employeeId?: unknown }).employeeId
              ? String((entry as { employeeId?: unknown }).employeeId)
              : '';
          if (!entryId) continue;
          const entryMeta = map.get(entryId);
          if (
            entry &&
            typeof entry === 'object' &&
            'name' in entry &&
            !(entry as { name?: unknown }).name
          ) {
            (entry as { name?: unknown }).name = entryMeta?.name ?? '';
          }
          if (
            entry &&
            typeof entry === 'object' &&
            'role' in entry &&
            !(entry as { role?: unknown }).role
          ) {
            (entry as { role?: unknown }).role =
              entryMeta?.role ?? UserRole.EMPLOYEE;
          }
        }
      }

      if (
        booking.assignedSupervisor &&
        typeof booking.assignedSupervisor === 'object' &&
        'employeeId' in booking.assignedSupervisor
      ) {
        const supId = String(
          (booking.assignedSupervisor as { employeeId?: unknown }).employeeId,
        );
        const supMeta = map.get(supId);
        if (
          'name' in booking.assignedSupervisor &&
          !(booking.assignedSupervisor as { name?: unknown }).name
        ) {
          (booking.assignedSupervisor as { name?: unknown }).name =
            supMeta?.name ?? '';
        }
      }
    }
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
    this.eventEmitter.emit('booking.created', {
      ...this.toFrontendBooking(booking),
      bookingId: String(booking._id),
    });
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
    const pricing = this.calculatePricingBreakdown(data, discountApplied);
    return {
      estimatedPrice: pricing.estimatedPrice,
      finalPrice: pricing.finalPrice,
    };
  }

  private calculatePricingBreakdown(
    data: CreateBookingDto,
    discountApplied: boolean,
  ): {
    estimatedPrice: number;
    finalPrice: number;
    baseServicePrice: number;
    additionalBedroomsFee: number;
    discountedEstimatedPrice: number;
    discountPercent: number;
    discountAmount: number;
    extrasTotal: number;
    petsFee: number;
    distanceFee: number;
  } {
    const nodeEnv =
      typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
    const debugPricing =
      nodeEnv !== 'production' && process.env.DEBUG_PRICING === '1';
    const log = debugPricing ? console.log : () => undefined;

    const rawService =
      this.readStringField(data, 'serviceType') ||
      this.readStringField(data, 'service') ||
      this.readStringField(data, 'cleaningType');
    const normalizedService = this.normalizeServiceType(rawService);

    log('[PRICING SERVICE TYPE]', {
      raw: rawService || 'UNKNOWN',
      normalized: normalizedService,
      serviceType: this.readStringField(data, 'serviceType') || undefined,
      cleaningType: this.readStringField(data, 'cleaningType') || undefined,
    });

    const extrasResult = this.calculateExtras(
      this.readUnknownField(data, 'extras'),
    );
    log('[PRICING EXTRAS BREAKDOWN]', extrasResult);

    const petsFee = this.readBooleanField(data, 'petsAtHome') ? 10 : 0;
    const distanceFee = this.readBooleanField(data, 'distanceSurcharge')
      ? 20
      : 0;

    let baseServicePrice = 0;
    let additionalBedrooms = 0;
    let additionalBedroomsFee = 0;

    if (
      normalizedService === 'standard' ||
      normalizedService === 'deep' ||
      normalizedService === 'apartment' ||
      normalizedService === 'move'
    ) {
      const bedrooms = this.readRequiredIntField(data, 'bedrooms', 1);
      const bathrooms = this.readRequiredIntField(data, 'bathrooms', 1);
      additionalBedrooms = this.readIntField(data, 'additionalBedrooms', 0);

      if (normalizedService === 'standard') {
        const result = this.calculateStandard(
          bedrooms,
          bathrooms,
          additionalBedrooms,
        );
        baseServicePrice = result.baseServicePrice;
        additionalBedroomsFee = result.additionalBedroomsFee;
        log('[PRICING BASE]', {
          service: 'STANDARD',
          bedrooms,
          bathrooms,
          baseServicePrice,
        });
        log('[PRICING ADDITIONALS]', {
          service: 'STANDARD',
          additionalBedrooms,
          additionalBedroomsFee,
          perBedroom: 30,
        });
      } else if (normalizedService === 'deep') {
        const result = this.calculateDeep(
          bedrooms,
          bathrooms,
          additionalBedrooms,
        );
        baseServicePrice = result.baseServicePrice;
        additionalBedroomsFee = result.additionalBedroomsFee;
        log('[PRICING BASE]', {
          service: 'DEEP',
          bedrooms,
          bathrooms,
          baseServicePrice,
        });
        log('[PRICING ADDITIONALS]', {
          service: 'DEEP',
          additionalBedrooms,
          additionalBedroomsFee,
          perBedroom: 40,
        });
      } else if (normalizedService === 'apartment') {
        const result = this.calculateApartment(
          bedrooms,
          bathrooms,
          additionalBedrooms,
        );
        baseServicePrice = result.baseServicePrice;
        additionalBedroomsFee = result.additionalBedroomsFee;
        log('[PRICING BASE]', {
          service: 'APARTMENT',
          bedrooms,
          bathrooms,
          baseServicePrice,
        });
        log('[PRICING ADDITIONALS]', {
          service: 'APARTMENT',
          additionalBedrooms,
          additionalBedroomsFee,
          perBedroom: 20,
        });
      } else if (normalizedService === 'move') {
        const moveModeRaw = this.readStringField(data, 'moveMode');
        const moveMode = this.normalizeMoveMode(moveModeRaw);
        const result = this.calculateMove(
          bedrooms,
          bathrooms,
          additionalBedrooms,
          moveMode,
        );
        baseServicePrice = result.baseServicePrice;
        additionalBedroomsFee = result.additionalBedroomsFee;
        log('[PRICING BASE]', {
          service: 'MOVE',
          moveMode,
          bedrooms,
          bathrooms,
          baseServicePrice,
          moveBreakdown: result.breakdown,
        });
        log('[PRICING ADDITIONALS]', {
          service: 'MOVE',
          moveMode,
          additionalBedrooms,
          additionalBedroomsFee,
        });
      }
    } else if (normalizedService === 'post_construction') {
      const hours = this.readRequiredIntNestedField(
        data,
        ['postConstruction', 'hours'],
        1,
      );
      const cleaners = this.readRequiredIntNestedField(
        data,
        ['postConstruction', 'cleaners'],
        1,
      );
      baseServicePrice = this.calculatePostConstruction(hours, cleaners);
      log('[PRICING BASE]', {
        service: 'POST_CONSTRUCTION',
        hours,
        cleaners,
        baseServicePrice,
      });
      log('[PRICING ADDITIONALS]', {
        service: 'POST_CONSTRUCTION',
        additionalBedrooms: 0,
        additionalBedroomsFee: 0,
      });
    } else if (normalizedService === 'window') {
      const windowCount = this.readRequiredIntNestedField(
        data,
        ['windowCleaning', 'windowCount'],
        1,
      );
      baseServicePrice = this.calculateWindow(windowCount);
      log('[PRICING BASE]', {
        service: 'WINDOW',
        windowCount,
        baseServicePrice,
      });
      log('[PRICING ADDITIONALS]', {
        service: 'WINDOW',
        additionalBedrooms: 0,
        additionalBedroomsFee: 0,
      });
    } else {
      throw new BadRequestException('Unknown service type');
    }

    const estimatedPriceRaw = baseServicePrice + additionalBedroomsFee;
    const estimatedPrice = this.roundCurrency(estimatedPriceRaw);

    const discountPercent = this.getFirstTimeDiscountPercent();
    const discountedEstimatedRaw = discountApplied
      ? estimatedPrice * (1 - discountPercent / 100)
      : estimatedPrice;
    const discountedEstimatedPrice = this.roundCurrency(discountedEstimatedRaw);
    const discountAmount = discountApplied
      ? this.roundCurrency(estimatedPrice - discountedEstimatedPrice)
      : 0;

    log('[PRICING DISCOUNT]', {
      discountApplied,
      discountPercent,
      estimatedPrice,
      discountedEstimatedPrice,
      discountAmount,
    });

    const extrasTotal = this.roundCurrency(extrasResult.total);
    const finalPriceRaw =
      discountedEstimatedPrice + extrasTotal + petsFee + distanceFee;
    const finalPrice = this.roundCurrency(finalPriceRaw);

    log('[PRICING FINAL]', {
      estimatedPrice,
      finalPrice,
      components: {
        discountedEstimatedPrice,
        extrasTotal,
        petsFee,
        distanceFee,
      },
    });

    return {
      estimatedPrice,
      finalPrice,
      baseServicePrice: this.roundCurrency(baseServicePrice),
      additionalBedroomsFee: this.roundCurrency(additionalBedroomsFee),
      discountedEstimatedPrice,
      discountPercent,
      discountAmount,
      extrasTotal,
      petsFee,
      distanceFee,
    };
  }

  private calculateStandard(
    bedrooms: number,
    bathrooms: number,
    additionalBedrooms: number,
  ): { baseServicePrice: number; additionalBedroomsFee: number } {
    const table: Record<string, number> = {
      '1/1': 120,
      '2/1': 140,
      '2/2': 160,
      '3/2': 180,
      '4/2': 210,
      '4/3': 250,
    };
    const baseServicePrice = this.lookupTablePrice(table, bedrooms, bathrooms);
    const additionalBedroomsFee =
      this.safeNonNegativeInt(additionalBedrooms) * 30;
    return { baseServicePrice, additionalBedroomsFee };
  }

  private calculateDeep(
    bedrooms: number,
    bathrooms: number,
    additionalBedrooms: number,
  ): { baseServicePrice: number; additionalBedroomsFee: number } {
    const table: Record<string, number> = {
      '1/1': 180,
      '2/2': 240,
      '3/2': 280,
      '4/3': 360,
    };
    const baseServicePrice = this.lookupTablePrice(table, bedrooms, bathrooms);
    const additionalBedroomsFee =
      this.safeNonNegativeInt(additionalBedrooms) * 40;
    return { baseServicePrice, additionalBedroomsFee };
  }

  private calculateApartment(
    bedrooms: number,
    bathrooms: number,
    additionalBedrooms: number,
  ): { baseServicePrice: number; additionalBedroomsFee: number } {
    const table: Record<string, number> = {
      '1/1': 110,
      '2/1': 130,
      '2/2': 140,
      '3/2': 170,
      '4/2': 190,
    };
    const baseServicePrice = this.lookupTablePrice(table, bedrooms, bathrooms);
    const additionalBedroomsFee =
      this.safeNonNegativeInt(additionalBedrooms) * 20;
    return { baseServicePrice, additionalBedroomsFee };
  }

  private calculateMove(
    bedrooms: number,
    bathrooms: number,
    additionalBedrooms: number,
    moveMode: 'move_in' | 'move_out' | 'both',
  ): {
    baseServicePrice: number;
    additionalBedroomsFee: number;
    breakdown: Record<string, unknown>;
  } {
    const moveOutTable: Record<string, number> = {
      '1/1': 185,
      '2/2': 250,
      '3/2': 290,
      '4/3': 365,
    };
    const moveInTable: Record<string, number> = {
      '1/1': 120,
      '2/1': 130,
      '2/2': 130,
      '3/2': 150,
      '4/2': 170,
      '4/3': 170,
    };

    const addBedrooms = this.safeNonNegativeInt(additionalBedrooms);

    if (moveMode === 'move_out') {
      const baseServicePrice = this.lookupTablePrice(
        moveOutTable,
        bedrooms,
        bathrooms,
      );
      const additionalBedroomsFee = addBedrooms * 40;
      return {
        baseServicePrice,
        additionalBedroomsFee,
        breakdown: { mode: 'move_out' },
      };
    }

    if (moveMode === 'move_in') {
      const baseServicePrice = this.lookupTablePrice(
        moveInTable,
        bedrooms,
        bathrooms,
      );
      const additionalBedroomsFee = addBedrooms * 30;
      return {
        baseServicePrice,
        additionalBedroomsFee,
        breakdown: { mode: 'move_in' },
      };
    }

    const moveOutBase = this.lookupTablePrice(
      moveOutTable,
      bedrooms,
      bathrooms,
    );
    const moveOutAdd = addBedrooms * 40;
    const moveInBase = this.lookupTablePrice(moveInTable, bedrooms, bathrooms);
    const moveInAdd = addBedrooms * 30;

    const sumBase = moveOutBase + moveInBase;
    const sumAdd = moveOutAdd + moveInAdd;

    const discountedBase = sumBase * 0.8;
    const discountedAdd = sumAdd * 0.8;

    return {
      baseServicePrice: discountedBase,
      additionalBedroomsFee: discountedAdd,
      breakdown: {
        mode: 'both',
        moveOut: { base: moveOutBase, additionalBedroomsFee: moveOutAdd },
        moveIn: { base: moveInBase, additionalBedroomsFee: moveInAdd },
        discountPercent: 20,
      },
    };
  }

  private calculatePostConstruction(hours: number, cleaners: number): number {
    return hours * cleaners * 60;
  }

  private calculateWindow(windowCount: number): number {
    return windowCount * 8;
  }

  private calculateExtras(extrasRaw: unknown): {
    total: number;
    items: Array<{
      type: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }>;
  } {
    const extras = Array.isArray(extrasRaw) ? extrasRaw : [];
    const items: Array<{
      type: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }> = [];

    let total = 0;

    for (const extra of extras) {
      if (typeof extra === 'string') {
        const type = extra.toLowerCase().trim();
        const quantity = 1;
        const unitPrice = this.getExtraUnitPrice(type);
        const subtotal = unitPrice * quantity;
        items.push({ type, quantity, unitPrice, subtotal });
        total += subtotal;
        continue;
      }

      if (typeof extra === 'object' && extra !== null) {
        const typeValue = (extra as { type?: unknown }).type;
        const quantityValue = (extra as { quantity?: unknown }).quantity;
        const type =
          typeof typeValue === 'string' ? typeValue.toLowerCase().trim() : '';
        if (!type) {
          throw new BadRequestException('Invalid extra type');
        }
        const quantity = this.safePositiveInt(quantityValue, 1);
        const unitPrice = this.getExtraUnitPrice(type);
        const subtotal = unitPrice * quantity;
        items.push({ type, quantity, unitPrice, subtotal });
        total += subtotal;
        continue;
      }

      throw new BadRequestException('Invalid extras format');
    }

    return { total, items };
  }

  private getExtraUnitPrice(type: string): number {
    const normalized = type.toLowerCase().trim();
    if (normalized === 'fridge') return 30;
    if (normalized === 'oven') return 30;
    if (normalized === 'cabinets') return 35;
    if (normalized === 'heavy') return 25;
    if (normalized === 'same_day') return 20;
    if (normalized === 'garage') return 30;
    if (normalized === 'organize') return 30;
    if (normalized === 'laundry') return 15;
    if (normalized === 'outside_windows') return 8;
    throw new BadRequestException(`Unknown extra: ${type}`);
  }

  private lookupTablePrice(
    table: Record<string, number>,
    bedrooms: number,
    bathrooms: number,
  ): number {
    const key = `${bedrooms}/${bathrooms}`;
    const value = table[key];
    if (typeof value !== 'number') {
      throw new BadRequestException(`Unsupported bedrooms/bathrooms: ${key}`);
    }
    return value;
  }

  private normalizeServiceType(raw: string): string {
    const value = (raw ?? '').toLowerCase().trim();
    if (!value) {
      throw new BadRequestException('serviceType is required');
    }
    if (value.includes('standard') || value.includes('basic'))
      return 'standard';
    if (value.includes('deep')) return 'deep';
    if (value.includes('move')) return 'move';
    if (value.includes('post') || value.includes('construction'))
      return 'post_construction';
    if (value.includes('apartment')) return 'apartment';
    if (value.includes('window')) return 'window';
    throw new BadRequestException('Unknown service type');
  }

  private normalizeMoveMode(raw: string): 'move_in' | 'move_out' | 'both' {
    const value = (raw ?? '').toLowerCase().trim();
    if (value === 'move_in') return 'move_in';
    if (value === 'move_out') return 'move_out';
    if (value === 'both') return 'both';
    throw new BadRequestException('moveMode is required');
  }

  private readUnknownField(data: CreateBookingDto, key: string): unknown {
    const record = data as unknown as Record<string, unknown>;
    if (key in record) return record[key];
    const dyn = (record['dynamicFields'] ?? null) as unknown;
    if (
      dyn &&
      typeof dyn === 'object' &&
      key in (dyn as Record<string, unknown>)
    ) {
      return (dyn as Record<string, unknown>)[key];
    }
    return undefined;
  }

  private readStringField(data: CreateBookingDto, key: string): string {
    const value = this.readUnknownField(data, key);
    return typeof value === 'string' ? value : '';
  }

  private readBooleanField(data: CreateBookingDto, key: string): boolean {
    const value = this.readUnknownField(data, key);
    return value === true;
  }

  private readIntField(
    data: CreateBookingDto,
    key: string,
    fallback: number,
  ): number {
    const value = this.readUnknownField(data, key);
    const num =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    if (!Number.isFinite(num)) return fallback;
    return Math.trunc(num);
  }

  private readRequiredIntField(
    data: CreateBookingDto,
    key: string,
    min: number,
  ): number {
    const value = this.readUnknownField(data, key);
    const num =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    const intVal = Number.isFinite(num) ? Math.trunc(num) : NaN;
    if (!Number.isFinite(intVal) || intVal < min) {
      throw new BadRequestException(`${key} is required`);
    }
    return intVal;
  }

  private readRequiredIntNestedField(
    data: CreateBookingDto,
    path: [string, string],
    min: number,
  ): number {
    const record = data as unknown as Record<string, unknown>;
    const [outerKey, innerKey] = path;

    const candidates: unknown[] = [];
    candidates.push(record[outerKey] ?? undefined);

    const dyn = record['dynamicFields'];
    if (dyn && typeof dyn === 'object') {
      candidates.push((dyn as Record<string, unknown>)[outerKey]);
    }

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }
      const innerValue = (candidate as Record<string, unknown>)[innerKey];
      const num =
        typeof innerValue === 'number'
          ? innerValue
          : typeof innerValue === 'string'
            ? Number(innerValue)
            : NaN;
      const intVal = Number.isFinite(num) ? Math.trunc(num) : NaN;
      if (Number.isFinite(intVal) && intVal >= min) {
        return intVal;
      }
    }

    throw new BadRequestException(`${outerKey}.${innerKey} is required`);
  }

  private safeNonNegativeInt(value: unknown): number {
    const num =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    const intVal = Number.isFinite(num) ? Math.trunc(num) : 0;
    return intVal > 0 ? intVal : 0;
  }

  private safePositiveInt(value: unknown, fallback: number): number {
    const num =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN;
    const intVal = Number.isFinite(num) ? Math.trunc(num) : NaN;
    if (!Number.isFinite(intVal) || intVal <= 0) return fallback;
    return intVal;
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

  formatBookingForDisplay(booking: BookingDocument): Record<string, unknown> {
    return this.toFrontendBooking(booking);
  }

  private normalizeDisplayCode(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private toTitleCaseFromCode(value: string): string {
    const cleaned = value
      .trim()
      .replace(/[_]+/g, '-')
      .replace(/[^\w-]+/g, ' ')
      .replace(/-+/g, ' ')
      .trim();
    if (!cleaned) return '';
    return cleaned
      .split(/\s+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private parseBedroomsBathroomsFromPackage(
    value: unknown,
  ): { bedrooms: number; bathrooms: number } | null {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    const match = raw.match(/(\d+)\s*[-/]\s*(\d+)/);
    if (!match) return null;
    const bedrooms = Number(match[1]);
    const bathrooms = Number(match[2]);
    if (!Number.isFinite(bedrooms) || !Number.isFinite(bathrooms)) return null;
    if (bedrooms <= 0 || bathrooms <= 0) return null;
    return { bedrooms: Math.trunc(bedrooms), bathrooms: Math.trunc(bathrooms) };
  }

  private getDisplayFrequencyLabel(code: string): string {
    const normalized = code.trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'one-time' || normalized === 'one_time')
      return 'One-time';
    if (normalized === 'weekly') return 'Weekly';
    if (normalized === 'biweekly' || normalized === 'bi-weekly')
      return 'Biweekly';
    if (normalized === 'monthly') return 'Monthly';
    return this.toTitleCaseFromCode(normalized);
  }

  private getDisplayServiceLabel(code: string): string {
    const normalized = code.trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'standard-cleaning') return 'Standard Cleaning';
    if (normalized === 'deep-cleaning') return 'Deep Cleaning';
    if (normalized === 'apartment-cleaning') return 'Apartment Cleaning';
    if (normalized === 'move-in-move-out') return 'Move-In / Move-Out';
    if (normalized === 'post-construction') return 'Post-Construction Cleaning';
    if (normalized === 'window-cleaning') return 'Window Cleaning';
    return this.toTitleCaseFromCode(normalized);
  }

  private normalizeExtraType(value: unknown): string {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'windows_exterior') return 'outside_windows';
    return normalized;
  }

  private getDisplayExtraLabel(type: string): string {
    const map: Record<string, string> = {
      fridge: 'Inside Fridge',
      oven: 'Inside Oven',
      cabinets: 'Inside Cabinets',
      inside_windows: 'Inside Windows',
      outside_windows: 'Outside Windows',
      laundry: 'Laundry',
      organize_clothes: 'Organize Clothes',
      garage: 'Garage',
      heavy_buildup: 'Heavy Buildup',
      same_day: 'Same Day Service',
    };
    const normalized = type.trim().toLowerCase();
    return map[normalized] ?? this.toTitleCaseFromCode(normalized);
  }

  private buildDisplayExtras(extras: unknown): {
    items: Array<{ type: string; label: string; quantity?: number }>;
    summary: string;
  } {
    const list = Array.isArray(extras) ? extras : [];
    const items: Array<{ type: string; label: string; quantity?: number }> = [];

    for (const item of list) {
      if (typeof item === 'string') {
        const type = this.normalizeExtraType(item);
        if (!type) continue;
        items.push({ type, label: this.getDisplayExtraLabel(type) });
        continue;
      }

      if (item && typeof item === 'object') {
        const typeRaw = (item as { type?: unknown }).type;
        const quantityRaw = (item as { quantity?: unknown }).quantity;
        const type = this.normalizeExtraType(typeRaw);
        if (!type) continue;
        const quantity = this.safePositiveInt(quantityRaw, 1);
        items.push({
          type,
          label: this.getDisplayExtraLabel(type),
          quantity,
        });
      }
    }

    const summary =
      items.length === 0
        ? 'None'
        : items
            .map((x) =>
              typeof x.quantity === 'number' && x.quantity > 1
                ? `${x.label} × ${x.quantity}`
                : x.label,
            )
            .join(', ');

    return { items, summary };
  }

  private buildDisplayProperty(obj: Record<string, unknown>): {
    address: string;
    bedrooms?: number;
    bathrooms?: number;
    additionalBedrooms?: number;
    summary: string;
    details: Array<{ label: string; value: string }>;
  } {
    const address = typeof obj.address === 'string' ? obj.address.trim() : '';
    const cleaningType = this.normalizeDisplayCode(obj.cleaningType);
    const dynRaw = obj.dynamicFields;
    const dyn =
      dynRaw && typeof dynRaw === 'object'
        ? (dynRaw as Record<string, unknown>)
        : {};

    const details: Array<{ label: string; value: string }> = [];
    let bedrooms: number | undefined = undefined;
    let bathrooms: number | undefined = undefined;
    let additionalBedrooms: number | undefined = undefined;

    const topBedrooms = this.safeNonNegativeInt(obj.bedrooms);
    const topBathrooms = this.safeNonNegativeInt(obj.bathrooms);
    const topAdditional = this.safeNonNegativeInt(obj.additionalBedrooms);

    if (topBedrooms) bedrooms = topBedrooms;
    if (topBathrooms) bathrooms = topBathrooms;
    if (topAdditional || obj.additionalBedrooms != null)
      additionalBedrooms = topAdditional;

    const dynBedrooms = this.safeNonNegativeInt(dyn.bedrooms);
    const dynBathrooms = this.safeNonNegativeInt(dyn.bathrooms);
    if (!bedrooms && dynBedrooms) bedrooms = dynBedrooms;
    if (!bathrooms && dynBathrooms) bathrooms = dynBathrooms;

    const dynAdditional = this.safeNonNegativeInt(dyn.additionalBedrooms);
    if (
      additionalBedrooms == null &&
      (dynAdditional || dyn.additionalBedrooms != null)
    ) {
      additionalBedrooms = dynAdditional;
    }

    const normalizedService = this.normalizeServiceType(cleaningType);
    if (
      normalizedService === 'standard' ||
      normalizedService === 'deep' ||
      normalizedService === 'apartment'
    ) {
      if (!bedrooms || !bathrooms) {
        const pkgKey =
          normalizedService === 'standard'
            ? dyn.stdPackage
            : normalizedService === 'deep'
              ? dyn.deepPackage
              : dyn.aptPackage;
        const parsed = this.parseBedroomsBathroomsFromPackage(pkgKey);
        if (parsed) {
          bedrooms = bedrooms || parsed.bedrooms;
          bathrooms = bathrooms || parsed.bathrooms;
        }
      }

      if (additionalBedrooms == null) {
        const extraKey =
          normalizedService === 'standard'
            ? dyn.extraBedrooms
            : normalizedService === 'deep'
              ? dyn.deepExtraBedrooms
              : dyn.aptExtraBedrooms;
        additionalBedrooms = this.safeNonNegativeInt(extraKey);
      }

      if (bedrooms)
        details.push({ label: 'Bedrooms', value: String(bedrooms) });
      if (bathrooms)
        details.push({ label: 'Bathrooms', value: String(bathrooms) });
      if (additionalBedrooms != null)
        details.push({
          label: 'Additional Bedrooms',
          value: String(additionalBedrooms),
        });
    } else if (normalizedService === 'move') {
      const moveMode =
        typeof dyn.moveMode === 'string'
          ? dyn.moveMode
          : typeof obj.moveMode === 'string'
            ? obj.moveMode
            : '';

      const showMoveOut =
        moveMode === 'move_out' || moveMode === 'both' || !moveMode;
      const showMoveIn =
        moveMode === 'move_in' || moveMode === 'both' || !moveMode;

      if (showMoveOut) {
        const parsed =
          this.parseBedroomsBathroomsFromPackage(dyn.moPackage) ?? null;
        const moBedrooms =
          this.safeNonNegativeInt(dyn.moveOutBedrooms) || parsed?.bedrooms || 0;
        const moBathrooms =
          this.safeNonNegativeInt(dyn.moveOutBathrooms) ||
          parsed?.bathrooms ||
          0;
        const moExtra = this.safeNonNegativeInt(dyn.moveOutExtraBedrooms);
        if (moBedrooms)
          details.push({
            label: 'Move-Out Bedrooms',
            value: String(moBedrooms),
          });
        if (moBathrooms)
          details.push({
            label: 'Move-Out Bathrooms',
            value: String(moBathrooms),
          });
        if (moExtra || dyn.moveOutExtraBedrooms != null)
          details.push({
            label: 'Move-Out Additional Bedrooms',
            value: String(moExtra),
          });
      }

      if (showMoveIn) {
        const parsed =
          this.parseBedroomsBathroomsFromPackage(dyn.miPackage) ?? null;
        const miBedrooms =
          this.safeNonNegativeInt(dyn.moveInBedrooms) || parsed?.bedrooms || 0;
        const miBathrooms =
          this.safeNonNegativeInt(dyn.moveInBathrooms) ||
          parsed?.bathrooms ||
          0;
        const miExtra = this.safeNonNegativeInt(dyn.moveInExtraBedrooms);
        if (miBedrooms)
          details.push({
            label: 'Move-In Bedrooms',
            value: String(miBedrooms),
          });
        if (miBathrooms)
          details.push({
            label: 'Move-In Bathrooms',
            value: String(miBathrooms),
          });
        if (miExtra || dyn.moveInExtraBedrooms != null)
          details.push({
            label: 'Move-In Additional Bedrooms',
            value: String(miExtra),
          });
      }
    } else if (normalizedService === 'post_construction') {
      const pcRaw = dyn.postConstruction;
      const pc =
        pcRaw && typeof pcRaw === 'object'
          ? (pcRaw as Record<string, unknown>)
          : {};
      const hours = this.safeNonNegativeInt(pc.hours);
      const cleaners = this.safeNonNegativeInt(pc.cleaners);
      if (hours) details.push({ label: 'Hours', value: String(hours) });
      if (cleaners)
        details.push({ label: 'Cleaners', value: String(cleaners) });
    } else if (normalizedService === 'window') {
      const wcRaw = dyn.windowCleaning;
      const wc =
        wcRaw && typeof wcRaw === 'object'
          ? (wcRaw as Record<string, unknown>)
          : {};
      const windowCount =
        this.safeNonNegativeInt(wc.windowCount) ||
        this.safeNonNegativeInt(dyn.windowsQuantity) ||
        this.safeNonNegativeInt(dyn.windowCount);
      if (windowCount)
        details.push({ label: 'Windows', value: String(windowCount) });
    }

    let summary = address || 'N/A';
    if (bedrooms && bathrooms) {
      const addText =
        additionalBedrooms != null && additionalBedrooms > 0
          ? ` (+${additionalBedrooms} add.)`
          : '';
      summary = `${bedrooms} bed / ${bathrooms} bath${addText}`;
    }

    return {
      address: address || 'N/A',
      bedrooms,
      bathrooms,
      additionalBedrooms,
      summary,
      details,
    };
  }

  private buildDisplayPricing(obj: Record<string, unknown>): {
    base: number;
    extras: number;
    discount: number;
    total: number;
    discountApplied: boolean;
    discountPercent: number;
    items: Array<{ label: string; amount: number }>;
  } {
    const discountApplied = obj.applyFirstDiscount === true;
    const dynRaw = obj.dynamicFields;
    const dyn =
      dynRaw && typeof dynRaw === 'object'
        ? (dynRaw as Record<string, unknown>)
        : {};

    const property = this.buildDisplayProperty(obj);
    const bedrooms = property.bedrooms;
    const bathrooms = property.bathrooms;
    const additionalBedrooms =
      property.additionalBedrooms != null ? property.additionalBedrooms : 0;

    const distanceSurcharge =
      obj.distanceSurcharge === true || dyn.distanceSurcharge === true;

    const baseData = {
      cleaningType: this.normalizeDisplayCode(obj.cleaningType),
      address: typeof obj.address === 'string' ? obj.address.trim() : '',
      extras: Array.isArray(obj.extras) ? obj.extras : [],
      dynamicFields: dyn,
      petsAtHome: obj.petsAtHome === true,
      distanceSurcharge,
      applyFirstDiscount: discountApplied,
      frequency: typeof obj.frequency === 'string' ? obj.frequency : '',
      bedrooms,
      bathrooms,
      additionalBedrooms,
      moveMode:
        typeof dyn.moveMode === 'string'
          ? dyn.moveMode
          : typeof obj.moveMode === 'string'
            ? obj.moveMode
            : '',
      postConstruction: dyn.postConstruction,
      windowCleaning: dyn.windowCleaning,
    } as unknown as CreateBookingDto;

    try {
      const breakdown = this.calculatePricingBreakdown(
        baseData,
        discountApplied,
      );
      const estimatedBase = this.roundCurrency(
        breakdown.baseServicePrice + breakdown.additionalBedroomsFee,
      );
      const extras = this.roundCurrency(
        breakdown.extrasTotal + breakdown.petsFee + breakdown.distanceFee,
      );
      const discount = discountApplied
        ? -this.roundCurrency(breakdown.discountAmount)
        : 0;

      const storedTotal =
        typeof obj.finalPricePreview === 'number' &&
        Number.isFinite(obj.finalPricePreview)
          ? obj.finalPricePreview
          : null;
      const total = this.roundCurrency(storedTotal ?? breakdown.finalPrice);

      const items = [
        { label: 'Base service', amount: estimatedBase },
        ...(breakdown.additionalBedroomsFee > 0
          ? [
              {
                label: 'Additional bedrooms',
                amount: breakdown.additionalBedroomsFee,
              },
            ]
          : []),
        ...(breakdown.extrasTotal > 0
          ? [{ label: 'Selected extras', amount: breakdown.extrasTotal }]
          : []),
        ...(breakdown.petsFee > 0
          ? [{ label: 'Pets', amount: breakdown.petsFee }]
          : []),
        ...(breakdown.distanceFee > 0
          ? [{ label: 'Distance surcharge', amount: breakdown.distanceFee }]
          : []),
        ...(discountApplied && breakdown.discountAmount > 0
          ? [
              {
                label: `Discount (${breakdown.discountPercent}%)`,
                amount: -breakdown.discountAmount,
              },
            ]
          : []),
      ];

      return {
        base: estimatedBase,
        extras,
        discount,
        total,
        discountApplied,
        discountPercent: breakdown.discountPercent,
        items,
      };
    } catch {
      const estimatedPrice =
        typeof obj.estimatedPrice === 'number' &&
        Number.isFinite(obj.estimatedPrice)
          ? this.roundCurrency(obj.estimatedPrice)
          : 0;
      const total =
        typeof obj.finalPricePreview === 'number' &&
        Number.isFinite(obj.finalPricePreview)
          ? this.roundCurrency(obj.finalPricePreview)
          : estimatedPrice;
      const extras = this.roundCurrency(Math.max(0, total - estimatedPrice));
      return {
        base: estimatedPrice,
        extras,
        discount: 0,
        total,
        discountApplied,
        discountPercent: this.getFirstTimeDiscountPercent(),
        items: [
          { label: 'Base service', amount: estimatedPrice },
          ...(extras > 0 ? [{ label: 'Extras & fees', amount: extras }] : []),
        ],
      };
    }
  }

  private buildDisplayModel(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const cleaningType = this.normalizeDisplayCode(obj.cleaningType);
    const serviceLabel =
      this.getDisplayServiceLabel(cleaningType) || cleaningType || 'Service';
    const frequencyCode = this.normalizeDisplayCode(obj.frequency);
    const frequencyLabel =
      this.getDisplayFrequencyLabel(frequencyCode) ||
      (frequencyCode ? this.toTitleCaseFromCode(frequencyCode) : 'One-time');

    const extras = this.buildDisplayExtras(obj.extras);
    const property = this.buildDisplayProperty(obj);
    const pricing = this.buildDisplayPricing(obj);

    const specialConditions: string[] = [];
    if (obj.petsAtHome === true) specialConditions.push('Pets at home');
    if (obj.useOwnProducts === true)
      specialConditions.push('Use customer-provided products');

    const notes = this.extractCustomerNotes(obj);

    return {
      customer: {
        name: typeof obj.name === 'string' ? obj.name : '',
        email: typeof obj.email === 'string' ? obj.email : '',
        phone: typeof obj.phone === 'string' ? obj.phone : '',
      },
      service: {
        code: cleaningType,
        label: serviceLabel,
      },
      schedule: {
        date: typeof obj.desiredDate === 'string' ? obj.desiredDate : '',
        time: typeof obj.desiredTime === 'string' ? obj.desiredTime : '',
        frequency: {
          code: frequencyCode,
          label: frequencyLabel,
        },
      },
      property,
      extras,
      notes,
      specialConditions,
      pricing: {
        ...pricing,
        currency: 'USD',
      },
    };
  }

  private extractCustomerNotes(obj: Record<string, unknown>): string {
    const dynRaw = obj.dynamicFields;
    const dyn =
      dynRaw && typeof dynRaw === 'object'
        ? (dynRaw as Record<string, unknown>)
        : {};

    const candidates = [
      obj.notes,
      obj.customerNotes,
      obj.specialInstructions,
      dyn.notes,
      dyn.customerNotes,
      dyn.specialInstructions,
      dyn.instructions,
      dyn.comment,
      dyn.comments,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const value = candidate.trim();
      if (!value) continue;
      return value;
    }

    return '';
  }

  private toFrontendBooking(booking: BookingDocument): Record<string, unknown> {
    const obj =
      typeof booking.toObject === 'function'
        ? (booking.toObject() as Record<string, unknown>)
        : (booking as unknown as Record<string, unknown>);

    const statusValue = obj.status;
    const safeStatus = typeof statusValue === 'string' ? statusValue : '';

    const legacyAssignedEmployeeId = booking.assignedEmployeeId
      ? booking.assignedEmployeeId.toHexString()
      : '';

    const assignedEmployeesValue = obj.assignedEmployees;
    const assignedEmployees = Array.isArray(assignedEmployeesValue)
      ? assignedEmployeesValue
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const employeeIdValue = (entry as { employeeId?: unknown })
              .employeeId;
            if (!employeeIdValue) return null;
            const nameValue = (entry as { name?: unknown }).name;
            const roleValue = (entry as { role?: unknown }).role;
            return {
              employeeId: this.stringifyObjectId(employeeIdValue),
              name: typeof nameValue === 'string' ? nameValue : '',
              role: typeof roleValue === 'string' ? roleValue : '',
            };
          })
          .filter((entry) => entry !== null)
      : [];

    const derivedAssignedEmployees =
      assignedEmployees.length > 0
        ? assignedEmployees
        : legacyAssignedEmployeeId
          ? [
              {
                employeeId: legacyAssignedEmployeeId,
                name:
                  typeof obj.assignedEmployeeName === 'string'
                    ? obj.assignedEmployeeName
                    : '',
                role: UserRole.EMPLOYEE,
              },
            ]
          : [];

    const assignedSupervisorValue = obj.assignedSupervisor;
    const assignedSupervisor =
      assignedSupervisorValue &&
      typeof assignedSupervisorValue === 'object' &&
      'employeeId' in assignedSupervisorValue
        ? {
            employeeId: this.stringifyObjectId(
              (assignedSupervisorValue as { employeeId?: unknown }).employeeId,
            ),
            name:
              typeof (assignedSupervisorValue as { name?: unknown }).name ===
              'string'
                ? String((assignedSupervisorValue as { name?: unknown }).name)
                : '',
          }
        : undefined;

    return {
      ...obj,
      _id: String(booking._id),
      status: safeStatus,
      assignedEmployees: derivedAssignedEmployees,
      assignedSupervisor,
      display: this.buildDisplayModel(obj),
    };
  }

  private stringifyObjectId(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value !== 'object' || value === null) return '';

    const candidate = value as {
      _bsontype?: unknown;
      toHexString?: unknown;
    };

    if (
      candidate._bsontype === 'ObjectId' &&
      typeof candidate.toHexString === 'function'
    ) {
      return (candidate.toHexString as () => string)();
    }

    return '';
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
