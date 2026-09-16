import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingService } from './booking.service';
import { Booking } from './schemas/booking.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { DiscountsService } from '../discounts/discounts.service';
import { StripeService } from '../payments/stripe.service';
import { BookingStateService } from './booking-state.service';
import { EmployeesService } from '../employees/employees.service';
import { GeoPricingService } from './geo-pricing.service';
import { EmailService } from '../email/email.service';
import { AuthService } from '../auth/auth.service';
import {
  CUSTOM_QUOTE_REQUEST_TYPES,
  CustomQuoteDto,
} from './dto/custom-quote.dto';

type SendRawEmailArgs = Parameters<EmailService['sendRawEmail']>[0];

const VALID_CUSTOM_QUOTE = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  address: '123 Palm Ave, Tampa, FL 33602',
  requestType: 'other' as const,
  description:
    'Partial post-construction cleaning in the kitchen area only. Also need help organizing the living room shelves.',
};

const VALID_PHOTOS = [
  {
    originalname: 'kitchen-before.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('fake-photo-bytes-A'),
    size: 1024 * 140,
  },
  {
    originalname: 'living-room.png',
    mimetype: 'image/png',
    buffer: Buffer.from('fake-photo-bytes-B'),
    size: 1024 * 320,
  },
];

describe('BookingService – sendCustomQuoteEmail (simplified flow)', () => {
  let service: BookingService;
  let sendRawEmailCalls: SendRawEmailArgs[] = [];

  const makeEmailServiceMock = (
    failInternal = false,
    failCustomer = false,
  ): Partial<EmailService> => ({
    sendRawEmail: jest.fn(async (params: SendRawEmailArgs) => {
      sendRawEmailCalls.push(params);
      const firstCall = sendRawEmailCalls.length === 1;
      if (firstCall && failInternal) throw new Error('SMTP AUTH failure');
      if (!firstCall && failCustomer) throw new Error('Customer SMTP timeout');
      return {
        messageId: firstCall ? '<internal-quote-msg-id>' : '<customer-confirm-msg-id>',
      } as unknown as ReturnType<EmailService['sendRawEmail']>;
    }),
  });

  const makeModelMock = () => ({
    create: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
  });

  beforeEach(async () => {
    sendRawEmailCalls = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        {
          provide: EmailService,
          useFactory: () => makeEmailServiceMock(),
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn(), on: jest.fn() } },
        { provide: DiscountsService, useValue: {} as any },
        { provide: StripeService, useValue: {} as any },
        { provide: BookingStateService, useValue: {} as any },
        { provide: EmployeesService, useValue: {} as any },
        { provide: GeoPricingService, useValue: {} as any },
        { provide: AuthService, useValue: {} as any },
        { provide: getModelToken(Booking.name), useFactory: makeModelMock },
        { provide: getModelToken(Payment.name), useFactory: makeModelMock },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
    jest.clearAllMocks();
  });

  describe('Test 1 – Successful request (internal email + customer confirmation)', () => {
    let result: { success: true; messageId?: string; sentTo: string[] };

    beforeEach(async () => {
      result = await service.sendCustomQuoteEmail(VALID_CUSTOM_QUOTE, VALID_PHOTOS);
    });

    it('calls sendRawEmail exactly twice', () => {
      expect(sendRawEmailCalls.length).toBe(2);
    });

    it('First call = internal team notification: replyTo = customer email, NO explicit to (EmailService default team inbox)', () => {
      const first = sendRawEmailCalls[0];
      expect(first.to).toBeUndefined();
      expect(first.replyTo).toBe(VALID_CUSTOM_QUOTE.email);
    });

    it('First call contains photo attachments with filename / contentType / buffer', () => {
      const first = sendRawEmailCalls[0];
      expect(Array.isArray(first.attachments)).toBe(true);
      expect(first.attachments?.length).toBe(VALID_PHOTOS.length);
      expect(first.attachments?.[0].filename).toBe('kitchen-before.jpg');
      expect(first.attachments?.[0].contentType).toBe('image/jpeg');
      expect(first.attachments?.[1].filename).toBe('living-room.png');
      expect((first.attachments?.[0] as any).content).toBeInstanceOf(Buffer);
      expect((first.attachments?.[1] as any).content).toBeInstanceOf(Buffer);
    });

    it('First call subject = [CUSTOM QUOTE] label — customer name', () => {
      expect(sendRawEmailCalls[0].subject).toBe(
        `[CUSTOM QUOTE] Other / Special Request — ${VALID_CUSTOM_QUOTE.name}`,
      );
    });

    it('First call HTML + plaintext include name, email, address, type label, description, Submitted At', () => {
      const internal = sendRawEmailCalls[0];
      for (const body of [internal.html, internal.text]) {
        expect(body).toContain(VALID_CUSTOM_QUOTE.name);
        expect(body).toContain(VALID_CUSTOM_QUOTE.email);
        expect(body).toContain(VALID_CUSTOM_QUOTE.address);
        expect(body).toContain('Other / Special Request');
        expect(body).toContain(VALID_CUSTOM_QUOTE.description);
        expect(body).toContain('Submitted');
      }
    });

    it('Second call = customer confirmation addressed explicitly to the customer email', () => {
      const second = sendRawEmailCalls[1];
      expect(second.to).toBe(VALID_CUSTOM_QUOTE.email);
      expect(second.replyTo).toBeUndefined();
    });

    it('Second call customer confirmation has NO photo attachments', () => {
      expect(sendRawEmailCalls[1].attachments).toBeUndefined();
    });

    it('Second call subject uses [ZCLEANUP] Custom Quote received prefix', () => {
      expect(sendRawEmailCalls[1].subject).toMatch(
        /^\[ZCLEANUP\] Custom Quote received — /,
      );
    });

    it('Second call body greets customer and promises 1–2 business day reply', () => {
      const confirm = sendRawEmailCalls[1];
      for (const body of [confirm.html, confirm.text]) {
        expect(body).toContain(VALID_CUSTOM_QUOTE.name);
        expect(body).toContain('1–2 business days');
      }
    });

    it('Return value success=true + sentTo contains team inbox env and customer email', () => {
      expect(result.success).toBe(true);
      expect(result.sentTo).toContain(VALID_CUSTOM_QUOTE.email);
      if (process.env.EMAIL_USER) {
        expect(result.sentTo).toContain(process.env.EMAIL_USER);
      }
    });

    it('Internal email never includes legacy bedrooms or bathrooms rows', () => {
      const internal = sendRawEmailCalls[0];
      expect(internal.text).not.toMatch(/^Bedrooms:/m);
      expect(internal.text).not.toMatch(/^Bathrooms:/m);
      expect(internal.html).not.toContain('>Bedrooms<');
      expect(internal.html).not.toContain('>Bathrooms<');
    });
  });

  describe('Test 2 – Internal email failure (fail-fast gating)', () => {
    let failSvc: BookingService;

    beforeEach(async () => {
      sendRawEmailCalls = [];
      const failModule: TestingModule = await Test.createTestingModule({
        providers: [
          BookingService,
          {
            provide: EmailService,
            useFactory: () => makeEmailServiceMock(true, false),
          },
          { provide: EventEmitter2, useValue: { emit: jest.fn(), on: jest.fn() } },
          { provide: DiscountsService, useValue: {} as any },
          { provide: StripeService, useValue: {} as any },
          { provide: BookingStateService, useValue: {} as any },
          { provide: EmployeesService, useValue: {} as any },
          { provide: GeoPricingService, useValue: {} as any },
          { provide: AuthService, useValue: {} as any },
          { provide: getModelToken(Booking.name), useFactory: makeModelMock },
          { provide: getModelToken(Payment.name), useFactory: makeModelMock },
        ],
      }).compile();
      failSvc = failModule.get<BookingService>(BookingService);
      jest.clearAllMocks();
    });

    it('service rejects if internal team notification sendRawEmail throws', async () => {
      await expect(
        failSvc.sendCustomQuoteEmail(VALID_CUSTOM_QUOTE, VALID_PHOTOS),
      ).rejects.toThrow();
    });

    it('customer confirmation NOT sent after internal failure (only 1 sendRawEmail call total)', async () => {
      try {
        await failSvc.sendCustomQuoteEmail(VALID_CUSTOM_QUOTE, VALID_PHOTOS);
      } catch {
        /* expected */
      }
      expect(sendRawEmailCalls.length).toBe(1);
    });
  });

  describe('Test 3 – Customer confirmation failure (logged/swallowed, overall success)', () => {
    let partialFailSvc: BookingService;

    beforeEach(async () => {
      sendRawEmailCalls = [];
      const failModule: TestingModule = await Test.createTestingModule({
        providers: [
          BookingService,
          {
            provide: EmailService,
            useFactory: () => makeEmailServiceMock(false, true),
          },
          { provide: EventEmitter2, useValue: { emit: jest.fn(), on: jest.fn() } },
          { provide: DiscountsService, useValue: {} as any },
          { provide: StripeService, useValue: {} as any },
          { provide: BookingStateService, useValue: {} as any },
          { provide: EmployeesService, useValue: {} as any },
          { provide: GeoPricingService, useValue: {} as any },
          { provide: AuthService, useValue: {} as any },
          { provide: getModelToken(Booking.name), useFactory: makeModelMock },
          { provide: getModelToken(Payment.name), useFactory: makeModelMock },
        ],
      }).compile();
      partialFailSvc = failModule.get<BookingService>(BookingService);
      jest.clearAllMocks();
    });

    it('service does NOT throw overall if only the confirmation send fails', async () => {
      await expect(
        partialFailSvc.sendCustomQuoteEmail(VALID_CUSTOM_QUOTE, []),
      ).resolves.not.toThrow();
    });

    it('internal notification was still sent (call #1 exists, replyTo and default team recipient pattern correct)', async () => {
      try {
        await partialFailSvc.sendCustomQuoteEmail(VALID_CUSTOM_QUOTE, []);
      } catch {
        /* ignore */
      }
      expect(sendRawEmailCalls.length).toBeGreaterThanOrEqual(1);
      expect(sendRawEmailCalls[0].to).toBeUndefined();
      expect(sendRawEmailCalls[0].replyTo).toBe(VALID_CUSTOM_QUOTE.email);
    });
  });
});

describe('CustomQuoteDto validation (simplified DTO)', () => {
  const validate = async (o: Record<string, unknown>): Promise<CustomQuoteDto> => {
    const dto = plainToInstance(CustomQuoteDto, o);
    try {
      await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
      return dto as CustomQuoteDto;
    } catch (errs) {
      throw new BadRequestException({ message: 'Validation failed', errors: errs });
    }
  };

  it('rejects missing or empty name', async () => {
    await expect(
      validate({ ...VALID_CUSTOM_QUOTE, name: '' }),
    ).rejects.toThrow(BadRequestException);
    const withoutName = (() => {
      const v = { ...VALID_CUSTOM_QUOTE } as Record<string, unknown>;
      delete v.name;
      return v;
    })();
    await expect(validate(withoutName)).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid email format', async () => {
    await expect(
      validate({ ...VALID_CUSTOM_QUOTE, email: 'not-an-email' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects short address ("12345" length 5 < required 8)', async () => {
    await expect(
      validate({ ...VALID_CUSTOM_QUOTE, address: '12345' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects short description (less than 20 chars)', async () => {
    await expect(
      validate({ ...VALID_CUSTOM_QUOTE, description: 'Short desc' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate({ ...VALID_CUSTOM_QUOTE, description: 'Just a quick help' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown requestType outside the allowed 5-value @IsIn list', async () => {
    await expect(
      validate({ ...VALID_CUSTOM_QUOTE, requestType: 'residential_standard' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts all 5 allowed requestType enum values', async () => {
    for (const allowed of CUSTOM_QUOTE_REQUEST_TYPES) {
      const validated = await validate({ ...VALID_CUSTOM_QUOTE, requestType: allowed });
      expect(validated.requestType).toBe(allowed);
    }
  });

  it('accepts a fully valid 5-field payload', async () => {
    const v = await validate(VALID_CUSTOM_QUOTE);
    expect(v.name).toBe(VALID_CUSTOM_QUOTE.name);
    expect(v.email).toBe(VALID_CUSTOM_QUOTE.email);
    expect(v.address).toBe(VALID_CUSTOM_QUOTE.address);
    expect(v.requestType).toBe(VALID_CUSTOM_QUOTE.requestType);
    expect(v.description).toBe(VALID_CUSTOM_QUOTE.description);
  });

  it('does not accept legacy bedrooms or bathrooms fields (forbidNonWhitelisted rejects extra)', async () => {
    const withLegacy = {
      ...VALID_CUSTOM_QUOTE,
      bedrooms: 3,
      bathrooms: 2,
    };
    await expect(validate(withLegacy)).rejects.toThrow(BadRequestException);
  });
});

describe('ValidationPipe forbidNonWhitelisted for CustomQuoteDto (integration)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('rejects extra unknown fields', async () => {
    const bad = {
      ...VALID_CUSTOM_QUOTE,
      someUnknownField: 'injection',
    } as Parameters<typeof pipe.transform>[0];
    await expect(
      pipe.transform(bad, { type: 'body', metatype: CustomQuoteDto }),
    ).rejects.toThrow(BadRequestException);
  });
});
