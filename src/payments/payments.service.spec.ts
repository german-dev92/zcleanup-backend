import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Model } from 'mongoose';

import * as dbHandler from '../../test/helpers/db-handler';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { UserRole } from '../auth/roles.enum';

/**
 * @file payments.service.spec.ts
 * @description Tests focalizados para la nueva compuerta de pagos.
 *
 * QUÉ PROTEGE:
 * - Compatibilidad del flujo legacy con pagos inmediatos.
 * - Nueva precondición del quote-flow antes de crear checkout.
 * - Metadata financiera enviada a Stripe para trazabilidad.
 */
describe('PaymentsService (Integration Test)', () => {
  let moduleRef: TestingModule;
  let service: PaymentsService;
  let bookingModel: Model<any>;
  let paymentModel: Model<any>;
  let stripeMock: { createCheckoutSessionDetails: jest.Mock };
  let mongoUri: string;

  beforeAll(async () => {
    mongoUri = await dbHandler.connect();
  }, 20000);

  afterAll(async () => {
    await dbHandler.closeDatabase();
  });

  afterEach(async () => {
    if (paymentModel) await paymentModel.deleteMany({});
    if (bookingModel) await bookingModel.deleteMany({});
    if (moduleRef) await moduleRef.close();
    jest.clearAllMocks();
  });

  const adminActor = {
    sub: 'admin_1',
    email: 'admin@zcleanup.test',
    role: UserRole.ADMIN,
  };

  const createLegacyBooking = async (overrides?: Partial<any>) =>
    bookingModel.create({
      name: 'Legacy User',
      email: 'legacy@example.com',
      phone: '8135550123',
      address: '123 Test St, Tampa, FL',
      cleaningType: 'standard-cleaning',
      desiredDate: '2099-01-01',
      desiredTime: '10:00',
      bedrooms: 2,
      bathrooms: 1,
      status: 'confirmed',
      paymentStatus: 'pending',
      estimatedPrice: 100,
      finalPricePreview: 100,
      ...overrides,
    });

  const createQuoteFlowBooking = async (overrides?: Partial<any>) =>
    bookingModel.create({
      name: 'Quote User',
      email: 'quote@example.com',
      phone: '8135550123',
      address: '123 Test St, Tampa, FL',
      cleaningType: 'standard-cleaning',
      desiredDate: '2099-01-01',
      desiredTime: '10:00',
      bedrooms: 2,
      bathrooms: 1,
      status: 'pending',
      commercialStatus: 'quote_accepted',
      paymentLifecycleStatus: 'invoice_ready',
      paymentStatus: 'pending',
      estimatedPrice: 100,
      finalPricePreview: 100,
      quote: {
        version: 3,
        status: 'accepted',
        baseCalculatedPrice: 100,
        finalQuotedPrice: 145,
      },
      ...overrides,
    });

  beforeEach(async () => {
    stripeMock = {
      /**
       * Mock de Stripe:
       * - Validamos que PaymentsService le pase el contexto correcto.
       * - No ejecutamos llamadas reales a Stripe en tests.
       */
      createCheckoutSessionDetails: jest.fn().mockResolvedValue({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/test-url',
        amountTotal: 14_500,
        currency: 'usd',
        paymentIntentId: 'pi_test_1',
      }),
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongoUri),
        MongooseModule.forFeature([
          { name: Booking.name, schema: BookingSchema },
          { name: Payment.name, schema: PaymentSchema },
        ]),
      ],
      providers: [
        PaymentsService,
        { provide: StripeService, useValue: stripeMock },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
    bookingModel = moduleRef.get(getModelToken(Booking.name));
    paymentModel = moduleRef.get(getModelToken(Payment.name));
  });

  describe('Legacy Compatibility', () => {
    it('keeps legacy confirmed bookings payable using finalPricePreview', async () => {
      // Arrange
      const booking = await createLegacyBooking({
        finalPricePreview: 120,
        estimatedPrice: 120,
      });
      stripeMock.createCheckoutSessionDetails.mockResolvedValueOnce({
        id: 'cs_legacy',
        url: 'https://checkout.stripe.com/legacy',
        amountTotal: 12_000,
        currency: 'usd',
        paymentIntentId: 'pi_legacy',
      });

      // Act
      const url = await service.createCheckoutSessionUrl(
        String(booking._id),
        adminActor,
      );

      // Assert
      expect(url).toBe('https://checkout.stripe.com/legacy');
      expect(stripeMock.createCheckoutSessionDetails).toHaveBeenCalledWith(
        expect.objectContaining({ _id: booking._id }),
        expect.objectContaining({
          amount: 120,
          quoteVersion: 'legacy',
          quotedAmount: '120.00',
        }),
      );
    });
  });

  describe('Quote Flow Preconditions', () => {
    it('creates checkout only when quote is accepted and invoice is ready', async () => {
      // Arrange
      const booking = await createQuoteFlowBooking();

      // Act
      const url = await service.createCheckoutSessionUrl(
        String(booking._id),
        adminActor,
      );

      // Assert
      expect(url).toBe('https://checkout.stripe.com/test-url');
      expect(stripeMock.createCheckoutSessionDetails).toHaveBeenCalledWith(
        expect.objectContaining({ _id: booking._id }),
        expect.objectContaining({
          amount: 145,
          quoteVersion: '3',
          quotedAmount: '145.00',
        }),
      );

      const updatedBooking = await bookingModel.findById(String(booking._id));
      expect(updatedBooking.paymentLifecycleStatus).toBe('checkout_created');
    });

    it('rejects quote-flow payments when commercialStatus is not quote_accepted', async () => {
      // Arrange
      const booking = await createQuoteFlowBooking({
        commercialStatus: 'quote_sent',
      });

      // Act + Assert
      await expect(
        service.createCheckoutSessionUrl(String(booking._id), adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(stripeMock.createCheckoutSessionDetails).not.toHaveBeenCalled();
    });

    it('rejects quote-flow payments when invoice is not ready', async () => {
      // Arrange
      const booking = await createQuoteFlowBooking({
        paymentLifecycleStatus: 'not_ready',
      });

      // Act + Assert
      await expect(
        service.createCheckoutSessionUrl(String(booking._id), adminActor),
      ).rejects.toThrow(BadRequestException);
      expect(stripeMock.createCheckoutSessionDetails).not.toHaveBeenCalled();
    });
  });
});
