import { Test, TestingModule } from '@nestjs/testing';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

describe('BookingController', () => {
  let controller: BookingController;
  const bookingServiceMock = {
    createBooking: jest.fn(),
    createQuoteRequest: jest.fn(),
    startQuoteReview: jest.fn(),
    saveQuoteDraft: jest.fn(),
    sendQuote: jest.fn(),
    rejectQuote: jest.fn(),
    expireQuote: jest.fn(),
    formatBookingForDisplay: jest.fn((value) => value),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [
        {
          provide: BookingService,
          useValue: bookingServiceMock,
        },
      ],
    }).compile();

    controller = module.get<BookingController>(BookingController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates POST /booking/quote-request to BookingService.createQuoteRequest', async () => {
    const dto = {
      name: 'Test User',
      email: 'test@example.com',
      cleaningType: 'standard-cleaning',
      desiredDate: '2099-01-01',
      desiredTime: '10:00',
    };

    await controller.createQuoteRequest(dto as any);

    expect(bookingServiceMock.createQuoteRequest).toHaveBeenCalledTimes(1);
    expect(bookingServiceMock.createQuoteRequest).toHaveBeenCalledWith(dto);
  });

  it('delegates PATCH /booking/:id/review/start to BookingService.startQuoteReview', async () => {
    const user = { sub: 'admin_1', email: 'admin@test.com' };
    bookingServiceMock.startQuoteReview.mockResolvedValueOnce({ _id: 'b1' });

    await controller.startQuoteReview('b1', { user } as any);

    expect(bookingServiceMock.startQuoteReview).toHaveBeenCalledWith(
      'b1',
      user,
    );
  });
});
