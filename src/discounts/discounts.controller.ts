import { Body, Controller, Post } from '@nestjs/common';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { DiscountsService } from './discounts.service';

class CheckDiscountDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @ValidateIf((o: CheckDiscountDto) => !o.email)
  @IsString()
  @IsNotEmpty()
  address?: string;
}

@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Post('check')
  async checkDiscount(@Body() body: CheckDiscountDto) {
    const canUse =
      typeof body.address === 'string' && body.address.trim()
        ? await this.discountsService.hasUsedDiscountForAddress(body.address)
        : await this.discountsService.hasUsedDiscount(body.email ?? '');

    return {
      email: body.email,
      address: body.address,
      canUseDiscount: !canUse,
    };
  }
}
