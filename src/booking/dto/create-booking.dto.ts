import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsNumber,
  IsObject,
} from 'class-validator';

export class CreateBookingDto {
  // ======================
  // 🔹 CONTACT INFO
  // ======================

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // ======================
  // 🔹 SERVICE INFO
  // ======================

  @IsNotEmpty()
  @IsString()
  cleaningType: string;

  @IsNotEmpty()
  @IsString()
  desiredDate: string;

  @IsNotEmpty()
  @IsString()
  desiredTime: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  // ======================
  // 🔹 FLAGS
  // ======================

  @IsOptional()
  @IsBoolean()
  petsAtHome?: boolean;

  @IsOptional()
  @IsBoolean()
  useOwnProducts?: boolean;

  @IsOptional()
  @IsBoolean()
  applyFirstDiscount?: boolean;

  // ======================
  // 🔹 SERVICE STRUCTURE
  // ======================

  @IsOptional()
  @IsObject()
  dynamicFields?: Record<string, any>;

  @IsOptional()
  @IsArray()
  extras?: string[];

  // ======================
  // 🔹 PRICING SNAPSHOT
  // ======================

  @IsOptional()
  @IsNumber()
  estimatedPrice?: number;

  @IsOptional()
  @IsNumber()
  finalPricePreview?: number;
}