import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsNumber,
  IsInt,
  Min,
  IsObject,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

function MaxRecordValueLength(
  max: number,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxRecordValueLength',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value == null) {
            return true;
          }
          if (typeof value !== 'object') {
            return false;
          }

          const [maxLen] = args.constraints as [number];
          const record = value as Record<string, unknown>;

          for (const recordValue of Object.values(record)) {
            let stringValue: string;
            if (recordValue == null) {
              stringValue = '';
            } else if (typeof recordValue === 'string') {
              stringValue = recordValue;
            } else {
              try {
                stringValue = JSON.stringify(recordValue);
              } catch {
                return false;
              }
            }

            if (stringValue.length > maxLen) {
              return false;
            }
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const [maxLen] = args.constraints as [number];
          return `${args.property} values must be at most ${maxLen} characters`;
        },
      },
    });
  };
}

function IsExtrasArray(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isExtrasArray',
      target: object.constructor,
      propertyName,
      constraints: [],
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value == null) {
            return true;
          }
          if (!Array.isArray(value)) {
            return false;
          }

          for (const item of value) {
            if (typeof item === 'string') {
              continue;
            }

            if (typeof item === 'object' && item !== null) {
              const typeValue = (item as { type?: unknown }).type;
              const quantityValue = (item as { quantity?: unknown }).quantity;
              if (typeof typeValue !== 'string' || !typeValue.trim()) {
                return false;
              }

              if (quantityValue == null) {
                continue;
              }

              const quantity =
                typeof quantityValue === 'number'
                  ? quantityValue
                  : typeof quantityValue === 'string'
                    ? Number(quantityValue)
                    : NaN;
              if (!Number.isFinite(quantity) || Math.trunc(quantity) <= 0) {
                return false;
              }

              continue;
            }

            return false;
          }

          return true;
        },
        defaultMessage() {
          return `${propertyName} must be an array of strings or { type, quantity } objects`;
        },
      },
    });
  };
}

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

  @IsOptional()
  @IsString()
  serviceType?: string;

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
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  additionalBedrooms?: number;

  @IsOptional()
  @IsBoolean()
  distanceSurcharge?: boolean;

  @IsOptional()
  @IsString()
  moveMode?: string;

  @IsOptional()
  @IsObject()
  @MaxRecordValueLength(500)
  postConstruction?: Record<string, any>;

  @IsOptional()
  @IsObject()
  @MaxRecordValueLength(500)
  windowCleaning?: Record<string, any>;

  @IsOptional()
  @IsObject()
  @MaxRecordValueLength(500)
  dynamicFields?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsExtrasArray()
  extras?: any[];

  // ======================
  // 🔹 PRICING SNAPSHOT
  // ======================

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  finalPricePreview?: number;
}
