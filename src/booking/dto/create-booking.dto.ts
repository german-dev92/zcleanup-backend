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
  IsObject,
  MaxLength,
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
  @MaxRecordValueLength(500)
  dynamicFields?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  extras?: string[];

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
