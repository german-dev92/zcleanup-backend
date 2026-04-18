import { Body, Controller, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { PaymentsService } from './payments.service';

class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout-session')
  async createCheckoutSession(@Body() body: CreateCheckoutSessionDto) {
    const url = await this.paymentsService.createCheckoutSessionUrl(
      body.bookingId,
    );

    return { url };
  }
}
