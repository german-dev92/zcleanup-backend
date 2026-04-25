import { Test, TestingModule } from '@nestjs/testing';
import { BookingService } from './booking.service';
import { getModelToken } from '@nestjs/mongoose';
import { Booking } from './schemas/booking.schema';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DiscountsService } from '../discounts/discounts.service';
import { StripeService } from '../payments/stripe.service';
import { Payment } from '../payments/schemas/payment.schema';
import { BookingStateService } from './booking-state.service';
import { EmployeesService } from '../employees/employees.service';

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
});
