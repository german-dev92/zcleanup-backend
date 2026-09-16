import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { EmailService } from '../email/email.service';
import { ContactMessageDto } from './dto/contact-message.dto';
import { EmailBuilder } from '../email/email.builder';

const VALID_PAYLOAD: ContactMessageDto = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  subject: 'General Inquiry',
  message: 'I would like more information about your cleaning services.',
};

type SendRawEmailArgs = Parameters<EmailService['sendRawEmail']>[0];

describe('ContactService', () => {
  let contactService: ContactService;
  let emailService: EmailService;
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
      return { messageId: firstCall ? '<internal-msg-id>' : '<customer-msg-id>' } as unknown as ReturnType<
        EmailService['sendRawEmail']
      >;
    }),
  });

  beforeEach(async () => {
    sendRawEmailCalls = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        {
          provide: EmailService,
          useFactory: () => makeEmailServiceMock(),
        },
      ],
    }).compile();

    contactService = module.get<ContactService>(ContactService);
    emailService = module.get<EmailService>(EmailService);
  });

  it('is defined', () => {
    expect(contactService).toBeDefined();
  });

  describe('Valid submission', () => {
    beforeEach(async () => {
      await contactService.sendContactMessage(VALID_PAYLOAD);
    });

    it('sends exactly two emails (internal notification + customer confirmation)', () => {
      expect(emailService.sendRawEmail).toHaveBeenCalledTimes(2);
    });

    it('sends the internal notification FIRST with replyTo = customer email and default team inbox recipient', () => {
      const internalCall = sendRawEmailCalls[0];
      expect(internalCall).toBeDefined();
      expect(internalCall.to).toBeUndefined();
      expect(internalCall.replyTo).toBe('jane@example.com');
    });

    it('internal email subject matches format [CONTACT US] subject — name', () => {
      expect(sendRawEmailCalls[0].subject).toBe('[CONTACT US] General Inquiry — Jane Doe');
    });

    it('internal email contains name, email, subject, message in HTML body and plaintext', () => {
      const internal = sendRawEmailCalls[0];
      [internal.html, internal.text].forEach((body) => {
        expect(body).toContain('Jane Doe');
        expect(body).toContain('jane@example.com');
        expect(body).toContain('General Inquiry');
        expect(body).toContain(
          'I would like more information about your cleaning services.',
        );
      });
    });

    it('customer confirmation sent second to the customer address', () => {
      const customerCall = sendRawEmailCalls[1];
      expect(customerCall).toBeDefined();
      expect(customerCall.to).toBe('jane@example.com');
      expect(customerCall.subject).toBe('[ZCLEANUP] We received your message');
      expect(customerCall.replyTo).toBeUndefined();
    });

    it('customer confirmation contains 1-2 business days SLA language', () => {
      const confirm = sendRawEmailCalls[1];
      [confirm.html, confirm.text].forEach((body) => {
        expect(body).toContain('1–2 business days');
      });
    });
  });

  describe('Email failure gating', () => {
    it('throws InternalServerErrorException if internal email fails; customer confirmation NOT sent', async () => {
      const failModule: TestingModule = await Test.createTestingModule({
        providers: [
          ContactService,
          {
            provide: EmailService,
            useFactory: () => makeEmailServiceMock(true, false),
          },
        ],
      }).compile();
      const svc = failModule.get<ContactService>(ContactService);

      await expect(svc.sendContactMessage(VALID_PAYLOAD)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(sendRawEmailCalls.length).toBe(1);
      expect(sendRawEmailCalls[0].to).toBeUndefined();
    });

    it('customer confirmation failure logs but does NOT throw (internal already succeeded)', async () => {
      const failModule: TestingModule = await Test.createTestingModule({
        providers: [
          ContactService,
          {
            provide: EmailService,
            useFactory: () => makeEmailServiceMock(false, true),
          },
        ],
      }).compile();
      const svc = failModule.get<ContactService>(ContactService);

      await expect(svc.sendContactMessage(VALID_PAYLOAD)).resolves.not.toThrow();
      expect(sendRawEmailCalls.length).toBe(2);
    });
  });
});

describe('ContactController + DTO Validation', () => {
  let controller: ContactController;
  let service: ContactService;
  let successCount = 0;

  beforeEach(async () => {
    successCount = 0;
    const emailSvcStub: Partial<EmailService> = {
      sendRawEmail: jest.fn(async () => {
        return { messageId: `<id-${successCount++}>` } as unknown as ReturnType<
          EmailService['sendRawEmail']
        >;
      }),
    };
    const emailBuilderStub: Partial<EmailBuilder> = {} as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactController],
      providers: [
        ContactService,
        { provide: EmailService, useValue: emailSvcStub },
        { provide: EmailBuilder, useValue: emailBuilderStub },
      ],
    }).compile();

    controller = module.get<ContactController>(ContactController);
    service = module.get<ContactService>(ContactService);
    jest.clearAllMocks();
  });

  const validate = async (o: Record<string, unknown>): Promise<ContactMessageDto> => {
    const dto = plainToInstance(ContactMessageDto, o);
    try {
      await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
      return dto as ContactMessageDto;
    } catch (errs) {
      throw new BadRequestException({ message: 'Validation failed', errors: errs });
    }
  };

  it('returns { message: "Message sent successfully" } for a valid submission', async () => {
    const res = await controller.submitContactMessage(VALID_PAYLOAD);
    expect(res).toEqual({ message: 'Message sent successfully' });
  });

  it('rejects invalid email format via DTO validation', async () => {
    await expect(validate({ ...VALID_PAYLOAD, email: 'not-an-email' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects missing name', async () => {
    const bad = { ...VALID_PAYLOAD } as unknown as Record<string, unknown>;
    delete bad.name;
    await expect(validate(bad)).rejects.toThrow(BadRequestException);
  });

  it('rejects missing subject', async () => {
    const bad = { ...VALID_PAYLOAD } as unknown as Record<string, unknown>;
    delete bad.subject;
    await expect(validate(bad)).rejects.toThrow(BadRequestException);
  });

  it('rejects missing message', async () => {
    const bad = { ...VALID_PAYLOAD } as unknown as Record<string, unknown>;
    delete bad.message;
    await expect(validate(bad)).rejects.toThrow(BadRequestException);
  });

  it('rejects unsupported subject not in allowed list of 4', async () => {
    await expect(
      validate({ ...VALID_PAYLOAD, subject: 'Unsupported Subject' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts all 4 allowed subjects exactly as frontend', async () => {
    for (const allowed of [
      'General Inquiry',
      'Custom Quote',
      'Feedback',
      'Support',
    ] as const) {
      const validated = await validate({ ...VALID_PAYLOAD, subject: allowed });
      expect(validated.subject).toBe(allowed);
    }
  });

  it('rejects name too short (less than 3 chars)', async () => {
    await expect(validate({ ...VALID_PAYLOAD, name: 'Al' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects message too short (less than 20 chars)', async () => {
    await expect(validate({ ...VALID_PAYLOAD, message: 'Hello there' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('Controller-level ValidationPipe enforcement (integration)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('rejects extra/unknown fields (forbidNonWhitelisted)', async () => {
    const bad = { ...VALID_PAYLOAD, extraField: 'hack' } as Parameters<
      typeof pipe.transform
    >[0];
    await expect(
      pipe.transform(bad, { type: 'body', metatype: ContactMessageDto }),
    ).rejects.toThrow(BadRequestException);
  });
});
