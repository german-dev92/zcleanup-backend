import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';

import * as dbHandler from '../../test/helpers/db-handler';
import {
  checkoutSessionCompletedFixture,
  paymentIntentFailedFixture,
} from '../../test/fixtures/stripe-webhook.fixture';

import { PaymentsWebhookService } from './payments.webhook.service';
import { StripeService } from './stripe.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { toStripeAmountCents } from './stripe.service';

/**
 * @file payments.webhook.service.spec.ts
 * @description Suite de testing de nivel producción para PaymentsWebhookService.
 *
 * POR QUÉ ES CRÍTICO:
 * - Los webhooks son el punto de verdad final para marcar pagos como "paid".
 * - Stripe puede reenviar eventos duplicados; si no hay idempotencia se crean cobros duplicados o estados corruptos.
 * - Un webhook falsificado podría marcar reservas como pagadas sin recibir dinero real.
 *
 * QUÉ PROTEGE ESTA SUITE:
 * - Integridad financiera (amount mismatch, firma inválida, duplicados).
 * - Integridad de estados (booking.paymentStatus).
 * - Persistencia correcta de Payment (unique index bookingId+provider).
 *
 * PATRÓN AAA:
 * - Arrange: Preparamos Booking/Payment/Mocks.
 * - Act: Ejecutamos handleWebhook().
 * - Assert: Verificamos DB/llamadas/mutaciones.
 */

describe('PaymentsWebhookService (Integration Test)', () => {
  let moduleRef: TestingModule;
  let service: PaymentsWebhookService;
  let bookingModel: Model<any>;
  let paymentModel: Model<any>;
  let stripeMock: { constructWebhookEvent: jest.Mock };
  let mongoUri: string;

  beforeAll(async () => {
    mongoUri = await dbHandler.connect();
  }, 20000);

  afterAll(async () => {
    await dbHandler.closeDatabase();
  });

  afterEach(async () => {
    // Limpiamos usando MODELOS del módulo (misma conexión que usa el servicio)
    if (paymentModel) await paymentModel.deleteMany({});
    if (bookingModel) await bookingModel.deleteMany({});
    if (moduleRef) await moduleRef.close();
    jest.clearAllMocks();
  });

  const createBooking = async (overrides?: Partial<any>) => {
    const created = await bookingModel.create({
      name: 'Webhook User',
      email: 'webhook@example.com',
      phone: '8135550123',
      address: '123 Test St, Tampa, FL',
      cleaningType: 'standard-cleaning',
      desiredDate: '2099-01-01',
      desiredTime: '10:00',
      bedrooms: 2,
      bathrooms: 1,
      status: 'confirmed', // elegible para pago según PaymentsWebhookService
      paymentStatus: 'pending',
      finalPricePreview: 100, // USD
      estimatedPrice: 100,
      ...overrides,
    });
    return created;
  };

  const buildRawBody = (event: unknown) => Buffer.from(JSON.stringify(event));

  beforeEach(async () => {
    stripeMock = {
      /**
       * Mock de verificación firma+payload:
       * - En producción StripeService valida firma con STRIPE_WEBHOOK_SECRET.
       * - En tests, controlamos el resultado: "evento válido" vs "firma inválida".
       */
      constructWebhookEvent: jest.fn(),
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
        PaymentsWebhookService,
        { provide: StripeService, useValue: stripeMock },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(PaymentsWebhookService);
    bookingModel = moduleRef.get(getModelToken(Booking.name));
    paymentModel = moduleRef.get(getModelToken(Payment.name));
  });

  describe('Webhook Processing', () => {
    describe('checkout.session.completed', () => {
      it('marks booking.paymentStatus=paid and upserts Payment without duplicates (idempotent)', async () => {
        // Arrange
        const booking = await createBooking({
          status: 'confirmed',
          paymentStatus: 'pending',
          finalPricePreview: 123.45,
        });
        const bookingId = String(booking._id);
        const expectedAmountCents = toStripeAmountCents(
          booking.finalPricePreview,
        );

        const event = checkoutSessionCompletedFixture({
          bookingId,
          checkoutSessionId: 'cs_test_paid_1',
          paymentIntentId: 'pi_test_paid_1',
          amountTotalCents: expectedAmountCents,
          currency: 'usd',
          paymentStatus: 'paid',
        });

        stripeMock.constructWebhookEvent.mockReturnValue(event);
        const emitter = moduleRef.get(EventEmitter2);

        // Act
        await service.handleWebhook(buildRawBody(event), 't=123,v1=signature');

        // Assert (Booking)
        const updatedBooking = await bookingModel.findById(bookingId);
        expect(updatedBooking).toBeTruthy();
        expect(updatedBooking.paymentStatus).toBe('paid');
        expect(updatedBooking.paidAt).toBeInstanceOf(Date);

        // Assert (Payment)
        const payment = await paymentModel.findOne({
          bookingId,
          provider: 'stripe',
        });
        expect(payment).toBeTruthy();
        expect(payment.status).toBe('paid');
        expect(payment.paymentIntentId).toBe('pi_test_paid_1');
        expect(payment.checkoutSessionId).toBe('cs_test_paid_1');
        expect(emitter.emit).toHaveBeenCalledWith(
          'booking.payment_received',
          expect.objectContaining({
            bookingId,
          }),
        );

        // Act (duplicate event)
        const paidAtBefore = updatedBooking.paidAt;
        await service.handleWebhook(buildRawBody(event), 't=123,v1=signature');

        // Assert idempotencia: no hay duplicados
        const count = await paymentModel.countDocuments({
          bookingId,
          provider: 'stripe',
        });
        expect(count).toBe(1);

        const updatedBooking2 = await bookingModel.findById(bookingId);
        expect(updatedBooking2.paymentStatus).toBe('paid');
        // paidAt no debe “moverse” en reintentos
        expect(String(updatedBooking2.paidAt)).toBe(String(paidAtBefore));
      });

      it('marks quote-flow booking as paid using quote.finalQuotedPrice and Stripe metadata', async () => {
        // Arrange
        const booking = await createBooking({
          status: 'pending',
          commercialStatus: 'quote_accepted',
          paymentLifecycleStatus: 'checkout_created',
          paymentStatus: 'pending',
          finalPricePreview: 100,
          quote: {
            version: 4,
            status: 'accepted',
            finalQuotedPrice: 145,
          },
        });
        const bookingId = String(booking._id);
        const expectedAmountCents = toStripeAmountCents(145);

        const event = checkoutSessionCompletedFixture({
          bookingId,
          checkoutSessionId: 'cs_quote_paid_1',
          paymentIntentId: 'pi_quote_paid_1',
          amountTotalCents: expectedAmountCents,
          currency: 'usd',
          paymentStatus: 'paid',
          quoteVersion: '4',
          quotedAmount: '145.00',
        });

        stripeMock.constructWebhookEvent.mockReturnValue(event);
        const emitter = moduleRef.get(EventEmitter2);

        // Act
        await service.handleWebhook(buildRawBody(event), 't=123,v1=signature');

        // Assert
        const updatedBooking = await bookingModel.findById(bookingId);
        expect(updatedBooking.paymentStatus).toBe('paid');
        expect(updatedBooking.paymentLifecycleStatus).toBe('paid');

        const payment = await paymentModel.findOne({
          bookingId,
          provider: 'stripe',
        });
        expect(payment).toBeTruthy();
        expect(payment.amount).toBe(145);
        expect(emitter.emit).toHaveBeenCalledWith(
          'booking.payment_received',
          expect.objectContaining({
            bookingId,
          }),
        );
      });

      it('refuses amount mismatch and keeps booking consistent', async () => {
        // Arrange
        const booking = await createBooking({ finalPricePreview: 100 });
        const bookingId = String(booking._id);
        const wrongAmountCents =
          toStripeAmountCents(booking.finalPricePreview) + 1;

        const event = checkoutSessionCompletedFixture({
          bookingId,
          amountTotalCents: wrongAmountCents,
          paymentStatus: 'paid',
        });
        stripeMock.constructWebhookEvent.mockReturnValue(event);

        // Act
        await service.handleWebhook(buildRawBody(event), 't=123,v1=signature');

        // Assert: no mutación financiera si hay mismatch
        const updatedBooking = await bookingModel.findById(bookingId);
        expect(updatedBooking.paymentStatus).toBe('pending');

        const payment = await paymentModel.findOne({
          bookingId,
          provider: 'stripe',
        });
        expect(payment).toBeNull();
      });

      it('ignores checkout.session.completed when payment_status != paid', async () => {
        // Arrange
        const booking = await createBooking({ finalPricePreview: 100 });
        const bookingId = String(booking._id);
        const amountCents = toStripeAmountCents(booking.finalPricePreview);

        const event = checkoutSessionCompletedFixture({
          bookingId,
          amountTotalCents: amountCents,
          paymentStatus: 'unpaid',
        });
        stripeMock.constructWebhookEvent.mockReturnValue(event);

        // Act
        await service.handleWebhook(buildRawBody(event), 't=123,v1=signature');

        // Assert
        const updatedBooking = await bookingModel.findById(bookingId);
        expect(updatedBooking.paymentStatus).toBe('pending');
        expect(
          await paymentModel.countDocuments({ bookingId, provider: 'stripe' }),
        ).toBe(0);
      });

      it('refuses quote-flow webhook when metadata quotedAmount does not match the accepted quote', async () => {
        // Arrange
        const booking = await createBooking({
          status: 'pending',
          commercialStatus: 'quote_accepted',
          paymentLifecycleStatus: 'checkout_created',
          paymentStatus: 'pending',
          quote: {
            version: 4,
            status: 'accepted',
            finalQuotedPrice: 145,
          },
        });
        const bookingId = String(booking._id);

        const event = checkoutSessionCompletedFixture({
          bookingId,
          amountTotalCents: toStripeAmountCents(145),
          paymentStatus: 'paid',
          quoteVersion: '4',
          quotedAmount: '999.00',
        });
        stripeMock.constructWebhookEvent.mockReturnValue(event);

        // Act
        await service.handleWebhook(buildRawBody(event), 't=123,v1=signature');

        // Assert
        const updatedBooking = await bookingModel.findById(bookingId);
        expect(updatedBooking.paymentStatus).toBe('pending');
        expect(
          await paymentModel.countDocuments({ bookingId, provider: 'stripe' }),
        ).toBe(0);
      });
    });

    describe('payment_intent.payment_failed', () => {
      it('does not mark booking as paid and does not create Payment (financial integrity)', async () => {
        // Arrange
        const booking = await createBooking({ finalPricePreview: 100 });
        const bookingId = String(booking._id);
        const event = paymentIntentFailedFixture({ bookingId });

        // StripeService valida firma y devuelve el evento interpretado.
        stripeMock.constructWebhookEvent.mockReturnValue(event);

        // Act
        await service.handleWebhook(buildRawBody(event), 't=123,v1=signature');

        // Assert: implementación actual ignora este evento => no muta estado
        const updatedBooking = await bookingModel.findById(bookingId);
        expect(updatedBooking.paymentStatus).toBe('pending');
        expect(
          await paymentModel.countDocuments({ bookingId, provider: 'stripe' }),
        ).toBe(0);
      });
    });
  });

  describe('Security & Error Handling', () => {
    it('rejects invalid Stripe signature (UnauthorizedException) and does not touch DB', async () => {
      // Arrange
      const booking = await createBooking();
      const bookingId = String(booking._id);
      const event = checkoutSessionCompletedFixture({
        bookingId,
        amountTotalCents: toStripeAmountCents(booking.finalPricePreview),
      });

      stripeMock.constructWebhookEvent.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      // Act + Assert
      await expect(
        service.handleWebhook(buildRawBody(event), 'invalid-signature'),
      ).rejects.toThrow(UnauthorizedException);

      // Assert: DB intacta
      const updatedBooking = await bookingModel.findById(bookingId);
      expect(updatedBooking.paymentStatus).toBe('pending');
      expect(
        await paymentModel.countDocuments({ bookingId, provider: 'stripe' }),
      ).toBe(0);
    });

    it('rejects malformed Stripe payload (UnauthorizedException)', async () => {
      // Arrange
      stripeMock.constructWebhookEvent.mockReturnValue(123); // payload inválido

      // Act + Assert
      await expect(
        service.handleWebhook(Buffer.from('not-json'), 't=123,v1=signature'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('handles Mongo failure during payment upsert without corrupting booking', async () => {
      // Arrange
      const booking = await createBooking({ finalPricePreview: 100 });
      const bookingId = String(booking._id);
      const event = checkoutSessionCompletedFixture({
        bookingId,
        amountTotalCents: toStripeAmountCents(booking.finalPricePreview),
      });
      stripeMock.constructWebhookEvent.mockReturnValue(event);

      // Simulamos un fallo de escritura en Mongo justo al crear/actualizar Payment
      jest
        .spyOn(paymentModel, 'findOneAndUpdate')
        .mockRejectedValueOnce(new Error('mongo write failure'));

      // Act + Assert
      await expect(
        service.handleWebhook(buildRawBody(event), 't=123,v1=signature'),
      ).rejects.toThrow();

      // Assert: booking NO debe marcarse pagado si no se pudo persistir Payment
      const updatedBooking = await bookingModel.findById(bookingId);
      expect(updatedBooking.paymentStatus).toBe('pending');
    });
  });
});
