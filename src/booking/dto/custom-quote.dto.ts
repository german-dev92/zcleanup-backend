import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const CUSTOM_QUOTE_REQUEST_TYPES = [
  'commercial_cleaning',
  'deep_cleaning_large',
  'hoarding',
  'post_construction_large',
  'other',
] as const;

export type CustomQuoteRequestType =
  (typeof CUSTOM_QUOTE_REQUEST_TYPES)[number];

export class CustomQuoteDto {
  @ApiProperty({
    description: 'Full name of the requester',
    example: 'John Doe',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description: 'Email address of the requester',
    example: 'john@example.com',
    maxLength: 254,
  })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    description: 'Full service address',
    example: '123 Main St, Tampa, FL 33602',
    minLength: 8,
    maxLength: 300,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(300)
  address!: string;

  @ApiProperty({
    description: 'Type of custom quote request',
    enum: CUSTOM_QUOTE_REQUEST_TYPES,
    example: 'post_construction_large',
  })
  @IsIn(CUSTOM_QUOTE_REQUEST_TYPES)
  @IsNotEmpty()
  requestType!: CustomQuoteRequestType;

  @ApiProperty({
    description: 'Detailed description of the request',
    example: 'Partial post-construction cleaning in kitchen area only',
    minLength: 20,
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(2000)
  description!: string;
}
