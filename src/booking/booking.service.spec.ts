import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BookingService } from './booking.service';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DiscountsService } from '../discounts/discounts.service';
import { StripeService } from '../payments/stripe.service';
import { BookingStateService } from './booking-state.service';
import { EmployeesService } from '../employees/employees.service';
import { GeoPricingService } from './geo-pricing.service';
import * as dbHandler from '../../test/helpers/db-handler';
import { StripeServiceMock } from '../../test/mocks/stripe.service.mock';
import { Model } from 'mongoose';

/**
 * @file booking.service.spec.ts
 * @description Test de Integración para BookingService.
 * 
 * CONCEPTOS CLAVE:
 * - Integration Test: Probamos cómo interactúa el servicio con la base de datos (Memory Server).
 * - Mocking: Reemplazamos servicios externos (Stripe, Email) por versiones falsas controladas.
 * - MongooseModule.forRoot: Conectamos NestJS a nuestra base de datos de pruebas.
 */

describe('BookingService (Integration Test)', () => {
  let service: BookingService;
  let bookingModel: Model<any>;
  let mongoUri: string;

  // Antes de todos los tests de esta suite, conectamos a la DB en memoria
  beforeAll(async () => {
    mongoUri = await dbHandler.connect();
  }, 20000); // Aumentamos el tiempo de espera para el arranque de Mongo Memory Server
  
  // Después de todos los tests, cerramos la conexión
  afterAll(async () => await dbHandler.closeDatabase());
  
  // Después de cada test, limpiamos los datos para que no afecten al siguiente
  afterEach(async () => await dbHandler.clearDatabase());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        // Usamos la URI dinámica generada por el Memory Server
        MongooseModule.forRoot(mongoUri),
        MongooseModule.forFeature([
          { name: Booking.name, schema: BookingSchema },
          { name: Payment.name, schema: PaymentSchema },
        ]),
      ],
      providers: [
        BookingService,
        BookingStateService,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }, // Mock simple
        { provide: DiscountsService, useValue: { hasUsedDiscountByNormalizedAddress: jest.fn().mockResolvedValue(false) } },
        { provide: StripeService, useValue: StripeServiceMock },
        { provide: EmployeesService, useValue: {} },
        { provide: GeoPricingService, useValue: { computeFromInput: jest.fn().mockResolvedValue({ distanceSurcharge: false, status: 'ok' }) } },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
    bookingModel = module.get(getModelToken(Booking.name));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('previewPricing', () => {
    it('should calculate base price correctly for a standard cleaning', async () => {
      const dto = {
        cleaningType: 'standard-cleaning',
        address: '123 Test St',
        email: 'test@example.com',
        name: 'Test User',
        desiredDate: '2026-06-01',
        desiredTime: '10:00',
        bedrooms: 2,
        bathrooms: 1,
      } as any;

      const result = await service.previewPricing(dto);

      expect(result).toBeDefined();
      expect(result.finalPrice).toBeGreaterThan(0);
      expect(result.discountApplied).toBe(false);
    });
  });

  describe('createBooking', () => {
    it('should save a booking in the database', async () => {
      const dto = {
        cleaningType: 'standard-cleaning',
        address: '123 Test St',
        email: 'test@example.com',
        name: 'Test User',
        desiredDate: '2026-06-01',
        desiredTime: '10:00',
        bedrooms: 1,
        bathrooms: 1,
      } as any;

      const result = await service.createBooking(dto);

      expect(result.success).toBe(true);
      
      // Verificamos que realmente esté en la base de datos
      const savedBooking = await bookingModel.findOne({ email: 'test@example.com' });
      expect(savedBooking).toBeDefined();
      expect(savedBooking.name).toBe('Test User');
    });
  });
});
