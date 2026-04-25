import { Test, TestingModule } from '@nestjs/testing';
import { BookingService } from './booking.service';
import { getModelToken } from '@nestjs/mongoose';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DiscountsService } from '../discounts/discounts.service';
import { StripeService, toStripeAmountCents } from '../payments/stripe.service';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { BookingStateService } from './booking-state.service';
import { EmployeesService } from '../employees/employees.service';
import { DiscountUsedSchema } from '../discounts/schemas/discount-used.schema';

describe('BookingService', () => {
  let service: BookingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        BookingStateService,
        {
          provide: getModelToken(Booking.name),
          useValue: {},
        },
        {
          provide: getModelToken(Payment.name),
          useValue: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: DiscountsService,
          useValue: {},
        },
        {
          provide: StripeService,
          useValue: { createCheckoutSession: jest.fn() },
        },
        {
          provide: EmployeesService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calculates post-construction pricing linearly with a max of 3 cleaners', () => {
    type PricingBreakdown = {
      baseServicePrice: number;
      distanceFee: number;
      finalPrice: number;
    };
    const svc = service as unknown as {
      calculatePricingBreakdown: (
        data: unknown,
        discountApplied: boolean,
      ) => PricingBreakdown;
    };

    const calc = (hours: number, cleaners: number) =>
      svc.calculatePricingBreakdown(
        {
          serviceType: 'post_construction',
          postConstruction: { hours, cleaners },
          extras: [],
          petsAtHome: false,
          distanceSurcharge: false,
        },
        false,
      ).baseServicePrice;

    expect(calc(1, 1)).toBe(60);
    expect(calc(2, 1)).toBe(100);
    expect(calc(3, 1)).toBe(140);

    expect(calc(1, 2)).toBe(80);
    expect(calc(1, 3)).toBe(100);
    expect(calc(2, 2)).toBe(120);
    expect(calc(3, 3)).toBe(180);

    expect(calc(2, 4)).toBe(140);
    expect(calc(1, 10)).toBe(100);
  });

  it('includes distance surcharge (+$20) in final price when distanceSurcharge=true', () => {
    type PricingBreakdown = { finalPrice: number; distanceFee: number };
    const svc = service as unknown as {
      calculatePricingBreakdown: (
        data: unknown,
        discountApplied: boolean,
      ) => PricingBreakdown;
    };

    const res = svc.calculatePricingBreakdown(
      {
        serviceType: 'post_construction',
        postConstruction: { hours: 1, cleaners: 1 },
        extras: [],
        petsAtHome: false,
        distanceSurcharge: true,
      },
      false,
    );

    expect(res.distanceFee).toBe(20);
    expect(res.finalPrice).toBe(80);
  });

  describe('toStripeAmountCents', () => {
    it('converts dollar amounts to integer cents deterministically', () => {
      expect(toStripeAmountCents(19.99)).toBe(1999);
      expect(toStripeAmountCents(10)).toBe(1000);
      expect(toStripeAmountCents(0.01)).toBe(1);
    });

    it('avoids common floating-point edge cases', () => {
      expect(toStripeAmountCents(0.1 + 0.2)).toBe(30);
      expect(toStripeAmountCents(10.005)).toBe(1001);
    });
  });

  describe('mongoose indexes', () => {
    const hasIndex = (
      schema: {
        indexes: () => Array<
          [Record<string, unknown>, Record<string, unknown>]
        >;
      },
      keys: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      return schema.indexes().some(([k, o]) => {
        const keysOk = Object.entries(keys).every(
          ([key, value]) => k[key] === value,
        );
        const optionsOk = options
          ? Object.entries(options).every(([key, value]) => o[key] === value)
          : true;
        return keysOk && optionsOk;
      });
    };

    it('BookingSchema defines critical indexes', () => {
      expect(hasIndex(BookingSchema, { status: 1, createdAt: -1 })).toBe(true);
      expect(hasIndex(BookingSchema, { email: 1, createdAt: -1 })).toBe(true);
      expect(hasIndex(BookingSchema, { createdAt: -1 })).toBe(true);
    });

    it('DiscountUsedSchema defines discount validation indexes', () => {
      expect(
        hasIndex(
          DiscountUsedSchema,
          { email: 1 },
          { unique: true, sparse: true },
        ),
      ).toBe(true);
      expect(
        hasIndex(
          DiscountUsedSchema,
          { normalizedAddress: 1 },
          { unique: true, sparse: true },
        ),
      ).toBe(true);
      expect(hasIndex(DiscountUsedSchema, { bookingId: 1 })).toBe(true);
    });

    it('PaymentSchema defines booking/provider uniqueness index', () => {
      expect(
        hasIndex(
          PaymentSchema,
          { bookingId: 1, provider: 1 },
          { unique: true },
        ),
      ).toBe(true);
    });
  });
});
