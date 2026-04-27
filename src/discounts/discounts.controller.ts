import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { DiscountsService } from './discounts.service';

class CheckDiscountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: CheckDiscountDto) => !o.email)
  @IsString()
  @IsNotEmpty()
  address?: string;
}

class CheckDiscountResponseDto {
  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  address?: string;

  @ApiProperty()
  canUseDiscount: boolean;
}

@Controller('discounts')
@ApiTags('discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Post('check')
  @ApiBody({ type: CheckDiscountDto })
  @ApiOkResponse({ type: CheckDiscountResponseDto })
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
