import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { BookingController } from '../src/booking/booking.controller';
import { BookingService } from '../src/booking/booking.service';

describe('Booking (e2e)', () => {
  let app: INestApplication;
  const bookingServiceMock = {
    createBooking: jest.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [
        {
          provide: BookingService,
          useValue: bookingServiceMock,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('/booking (POST)', () => {
    const server = app.getHttpServer() as App;

    return request(server)
      .post('/booking')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        cleaningType: 'standard',
        desiredDate: '2026-04-17',
        desiredTime: '10:00',
      })
      .expect(201)
      .expect({ success: true });
  });

  afterEach(async () => {
    await app.close();
  });
});
