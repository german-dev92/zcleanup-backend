import { Body, Controller, Post } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { DiscountsService } from './discounts.service';

class CheckDiscountDto {
  @IsEmail()
  email: string;
}

@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Post('check')
  async checkDiscount(@Body() body: CheckDiscountDto) {
    const canUse = await this.discountsService.hasUsedDiscount(body.email);

    return {
      email: body.email,
      canUseDiscount: !canUse,
    };
  }
}
