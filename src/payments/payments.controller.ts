import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';

class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty()
  bookingId: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard)
  async createCheckoutSession(
    @Body() body: CreateCheckoutSessionDto,
    @Req() req: { user?: AuthUser },
  ) {
    const url = await this.paymentsService.createCheckoutSessionUrl(
      body.bookingId,
      req.user,
    );

    return { url };
  }
}
