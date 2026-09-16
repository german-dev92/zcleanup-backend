import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  IsDateString,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsNumber,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import {
  CustomQuoteDto,
  CUSTOM_QUOTE_REQUEST_TYPES,
} from './dto/custom-quote.dto';
import { validateOrReject } from 'class-validator';
import { plainToInstance } from 'class-transformer';

type MulterUploadedFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
  fieldname?: string;
};
import { BOOKING_STATUSES, type BookingStatus } from './types/booking-status';
import { BOOKING_COMMERCIAL_STATUSES, ADMIN_QUOTE_DISCOUNT_TYPES } from './schemas/booking.schema';
import type { AdminQuoteDiscountType } from './schemas/booking.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../auth/roles.enum';
import type { AuthUser } from '../auth/auth.types';

class AppliedDiscountDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  percent: number;

  @ApiProperty()
  amount: number;
}

class PricePreviewItemDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  amount: number;
}

class PricePreviewBreakdownDto {
  @ApiProperty()
  estimatedBase: number;

  @ApiProperty()
  baseServicePrice: number;

  @ApiProperty()
  additionalBedroomsFee: number;

  @ApiProperty()
  discountedEstimatedPrice: number;

  @ApiProperty()
  extrasTotal: number;

  @ApiProperty()
  petsFee: number;

  @ApiProperty()
  distanceFee: number;

  @ApiProperty()
  discountPercent: number;

  @ApiProperty()
  discountAmount: number;

  @ApiProperty()
  finalPrice: number;

  @ApiProperty({ type: () => [PricePreviewItemDto] })
  items: PricePreviewItemDto[];
}

class PricePreviewFeesDto {
  @ApiProperty()
  petsFee: number;

  @ApiProperty()
  distanceFee: number;
}

class PricePreviewResponseDto {
  @ApiProperty()
  estimatedPrice: number;

  @ApiProperty()
  finalPricePreview: number;

  @ApiProperty()
  finalPrice: number;

  @ApiProperty()
  baseServicePrice: number;

  @ApiProperty()
  additionalBedroomsFee: number;

  @ApiProperty()
  discountedEstimatedPrice: number;

  @ApiProperty()
  discountPercent: number;

  @ApiProperty()
  discountAmount: number;

  @ApiProperty()
  extrasTotal: number;

  @ApiProperty()
  petsFee: number;

  @ApiProperty()
  distanceFee: number;

  @ApiProperty()
  distanceSurcharge: boolean;

  @ApiProperty({ type: () => PricePreviewFeesDto })
  fees: PricePreviewFeesDto;

  @ApiProperty({ type: () => [AppliedDiscountDto] })
  appliedDiscounts: AppliedDiscountDto[];

  @ApiProperty({ type: () => PricePreviewBreakdownDto })
  breakdown: PricePreviewBreakdownDto;

  @ApiProperty()
  isBorderline: boolean;

  @ApiProperty({ nullable: true })
  assignedZone: string | null;

  @ApiProperty({ enum: ['inside', 'borderline', 'outside'] })
  coverageStatus: 'inside' | 'borderline' | 'outside';

  @ApiProperty({ nullable: true })
  assignedDistanceKm: number | null;

  @ApiProperty()
  coverageResolved: boolean;

  @ApiProperty({ nullable: true })
  coverageMessage: string | null;

  @ApiProperty()
  discountRequested: boolean;

  @ApiProperty()
  discountEligible: boolean;

  @ApiProperty()
  discountApplied: boolean;
}

class BookingPricingSummaryDto {
  @ApiProperty()
  estimatedPrice: number;

  @ApiProperty()
  discountApplied: boolean;

  @ApiProperty()
  finalPrice: number;
}

class BookingSummaryDto {
  @ApiProperty()
  _id: string;

  @ApiProperty({
    enum: [
      'pending',
      'confirmed',
      'assigned',
      'in_progress',
      'completed',
      'paid',
      'cancelled',
    ],
  })
  status:
    | 'pending'
    | 'confirmed'
    | 'assigned'
    | 'in_progress'
    | 'completed'
    | 'paid'
    | 'cancelled';

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  address?: string;

  @ApiPropertyOptional()
  cleaningType?: string;

  @ApiPropertyOptional()
  desiredDate?: string;

  @ApiPropertyOptional()
  desiredTime?: string;

  @ApiPropertyOptional()
  frequency?: string;

  @ApiPropertyOptional()
  petsAtHome?: boolean;

  @ApiPropertyOptional()
  useOwnProducts?: boolean;

  @ApiPropertyOptional()
  applyFirstDiscount?: boolean;

  @ApiPropertyOptional({ type: () => [Object] })
  extras?: unknown[];

  @ApiPropertyOptional()
  estimatedPrice?: number;

  @ApiPropertyOptional()
  finalPricePreview?: number;

  @ApiPropertyOptional()
  paymentUrl?: string;

  @ApiPropertyOptional()
  assignedEmployeeId?: string;

  @ApiPropertyOptional()
  assignedEmployeeEmail?: string;

  @ApiPropertyOptional()
  assignedAt?: string;

  @ApiPropertyOptional()
  startedAt?: string;

  @ApiPropertyOptional()
  completedAt?: string;

  @ApiPropertyOptional()
  assignedZone?: string;

  @ApiPropertyOptional()
  isBorderline?: boolean;

  @ApiPropertyOptional()
  distanceSurcharge?: boolean;

  @ApiPropertyOptional()
  distanceKm?: number;

  @ApiPropertyOptional()
  lat?: number;

  @ApiPropertyOptional()
  lng?: number;
}

class CreateBookingResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty({ type: () => BookingSummaryDto })
  data: BookingSummaryDto;

  @ApiProperty()
  discountApplied: boolean;

  @ApiProperty({ type: () => BookingPricingSummaryDto })
  pricing: BookingPricingSummaryDto;
}

class QuoteRequestSummaryDto {
  @ApiProperty()
  _id: string;

  @ApiProperty({ enum: ['pending'] })
  status: 'pending';

  @ApiProperty({
    enum: BOOKING_COMMERCIAL_STATUSES,
  })
  commercialStatus: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  address?: string;

  @ApiPropertyOptional()
  cleaningType?: string;

  @ApiPropertyOptional()
  desiredDate?: string;

  @ApiPropertyOptional()
  desiredTime?: string;

  @ApiPropertyOptional()
  frequency?: string;

  @ApiPropertyOptional()
  petsAtHome?: boolean;

  @ApiPropertyOptional()
  useOwnProducts?: boolean;

  @ApiPropertyOptional()
  applyFirstDiscount?: boolean;

  @ApiPropertyOptional({ type: () => [Object] })
  extras?: unknown[];

  @ApiPropertyOptional()
  createdAt?: string;

  @ApiPropertyOptional()
  updatedAt?: string;
}

class CreateQuoteRequestResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty({ type: () => QuoteRequestSummaryDto })
  data: QuoteRequestSummaryDto;
}

class QuoteManualAdjustmentDto {
  @ApiProperty({ enum: ['fixed', 'percent'] })
  @IsString()
  @IsIn(['fixed', 'percent'])
  type: 'fixed' | 'percent';

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  label: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class UpdateQuoteDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseCalculatedPrice?: number;

  @ApiPropertyOptional({
    description:
      'DEPRECATED & OVERRIDDEN server-side. Final quoted price is ALWAYS computed server-side from the authoritative V2 pricing engine and the Admin-selected authorized discountType. Any frontend-supplied value here will be ignored and recalculated.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  finalQuotedPrice?: number;

  @ApiPropertyOptional({
    description:
      'DEPRECATED for new-style fixed-discount drafts. Any manual adjustments that are NOT the single authorized discount will be replaced/overridden server-side by the computed discount adjustment.',
    type: () => [QuoteManualAdjustmentDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => QuoteManualAdjustmentDto)
  manualAdjustments?: QuoteManualAdjustmentDto[];

  @ApiPropertyOptional({
    enum: ADMIN_QUOTE_DISCOUNT_TYPES as unknown as string[],
    description:
      'Authoritative Admin-selected discount type. Backend resolves the percentage from this identifier using the SINGLE SOURCE OF TRUTH table: none=0%, regular_client=10%, first_time_customer=15%, loyalty_customer=20%. Frontend MUST NOT send a percentage; backend always maps the identifier to its fixed percent.',
  })
  @IsOptional()
  @IsString({ message: 'discountType must be a string identifier' })
  @IsIn(ADMIN_QUOTE_DISCOUNT_TYPES as unknown as string[], {
    message: `discountType must be one of: ${ADMIN_QUOTE_DISCOUNT_TYPES.join(', ')}`,
  })
  discountType?: AdminQuoteDiscountType;

  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Optional internal Admin note/reason for selecting the current discount type. Never shown to the customer. Stored at quote.discountReason; also mirrored into manualAdjustments[0].reason for legacy audit trails. This field does NOT affect price calculation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  discountReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  internalNotes?: string;
}

class RejectQuoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  internalNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

class BookingMutationResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty({ type: () => BookingSummaryDto })
  data: BookingSummaryDto;
}

/**
 * Workflow response wrapper for quote lifecycle mutations (send, reject, reopen,
 * revise, expire, draft-save, start-review).
 *
 * Semantically identical to {@link BookingMutationResponseDto} — kept as a distinct
 * subclass (rather than a type-alias) so that:
 * - class-validator / class-transformer decorator inheritance continues to work;
 * - Swagger/OpenAPI reflection still produces a named schema entry for quote endpoints;
 * - instanceof checks remain backward-compatible for tests written against this class.
 */
class QuoteWorkflowResponseDto extends BookingMutationResponseDto {}

function IsExtrasArray(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isExtrasArray',
      target: object.constructor,
      propertyName,
      constraints: [],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          void args;
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
      },
    });
  };
}

class UpdateBookingStatusDto {
  @IsDefined({ message: 'status is required' })
  @IsString({ message: 'status must be a string' })
  @IsIn(BOOKING_STATUSES, {
    message: `status must be one of: ${BOOKING_STATUSES.join(', ')}`,
  })
  status: BookingStatus;
}

class GetBookingsQueryDto {
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;
}

class AssignBookingDto {
  @IsOptional()
  @IsString({ message: 'supervisorId must be a string' })
  supervisorId?: string;

  @IsOptional()
  @IsArray({ message: 'employeeIds must be an array' })
  @IsString({ each: true, message: 'employeeIds must be strings' })
  employeeIds?: string[];

  @IsOptional()
  @IsString({ message: 'employeeId must be a string' })
  employeeId?: string;
}

class CancelBookingAdminDto {
  @IsOptional()
  @IsString({ message: 'internalNotes must be a string' })
  @MaxLength(1000)
  internalNotes?: string;

  @IsOptional()
  @IsString({ message: 'cancellationReason must be a string' })
  @MaxLength(500)
  cancellationReason?: string;
}

class DeleteBookingAdminReAuthDto {
  @IsDefined({ message: 'reAuth.email is required' })
  @IsString({ message: 'reAuth.email must be a string' })
  @IsEmail({}, { message: 'reAuth.email must be a valid email address' })
  @MaxLength(200)
  email: string;

  @IsDefined({ message: 'reAuth.password is required' })
  @IsString({ message: 'reAuth.password must be a string' })
  @MaxLength(200)
  password: string;
}

class DeleteBookingAdminDto {
  @IsDefined({ message: 'reAuth object is required' })
  @IsObject({ message: 'reAuth must be an object' })
  @Type(() => DeleteBookingAdminReAuthDto)
  reAuth: DeleteBookingAdminReAuthDto;
}

export class PricePreviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  cleaningType?: string;

  @IsOptional()
  @IsString()
  serviceType?: string;

  @IsOptional()
  @IsString()
  service?: string;

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
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsExtrasArray()
  extras?: any[];

  @IsOptional()
  @IsObject()
  dynamicFields?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  petsAtHome?: boolean;

  @IsOptional()
  @IsBoolean()
  distanceSurcharge?: boolean;

  @IsOptional()
  @IsBoolean()
  applyFirstDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  useOwnProducts?: boolean;

  @IsOptional()
  @IsBoolean()
  usesOwnCleaningProducts?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  petSafetyNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  cleaningProductNotes?: string;

  @IsOptional()
  @IsBoolean()
  firstServiceDiscountRequested?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  pricingModelVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  specialServiceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  regularCleaningPackageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  moveMode?: string;

  @IsOptional()
  @IsObject()
  postConstruction?: Record<string, any>;

  @IsOptional()
  @IsObject()
  windowCleaning?: Record<string, any>;
}

/**
 * @controller BookingController
 * @description Controlador para la gestión de reservas de limpieza.
 * Expone endpoints para crear, consultar, previsualizar precios y gestionar el ciclo de vida de una reserva.
 */
@Controller('booking')
@ApiTags('booking')
export class BookingController {
  private readonly logger = new Logger(BookingController.name);

  constructor(private readonly bookingService: BookingService) {}

  /**
   * Obtiene la lista de reservas filtradas opcionalmente por estado.
   * Requiere rol de Administrador o Supervisor.
   * @param query Objeto de consulta que incluye el estado de la reserva.
   * @returns Lista de resúmenes de reservas.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @ApiQuery({
    name: 'status',
    required: false,
    enum: BOOKING_STATUSES,
  })
  @ApiOkResponse({ type: BookingSummaryDto, isArray: true })
  getBookings(@Query() query: GetBookingsQueryDto) {
    return this.bookingService.getBookings(query.status);
  }

  /**
   * Obtiene las reservas asignadas al empleado autenticado.
   * @param req Solicitud HTTP que contiene el usuario autenticado.
   * @returns Lista de reservas asignadas al empleado.
   */
  @Get('assigned')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE)
  @ApiOkResponse({ type: BookingSummaryDto, isArray: true })
  getAssignedBookings(@Req() req: { user?: AuthUser }) {
    return this.bookingService.getAssignedBookings(req.user);
  }

  /**
   * Obtiene una reserva específica por su ID.
   * Requiere rol de Administrador o Supervisor.
   * @param id ID de la reserva.
   * @returns Resumen de la reserva encontrada.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @ApiOkResponse({ type: BookingSummaryDto })
  getById(@Param('id') id: string) {
    return this.bookingService.getById(id);
  }

  /**
   * Calcula una previsualización del precio sin crear la reserva.
   * Útil para el formulario de reserva dinámico en el frontend.
   * @param body Datos necesarios para el cálculo del precio.
   * @returns Desglose detallado del precio estimado.
   */
  @Post('price-preview')
  @ApiBody({ type: PricePreviewDto })
  @ApiOkResponse({ type: PricePreviewResponseDto })
  pricePreview(@Body() body: PricePreviewDto) {
    return this.bookingService.previewPricing(
      body as unknown as CreateBookingDto,
    );
  }

  /**
   * Crea una nueva reserva.
   * @param body Datos de la reserva a crear.
   * @returns Resultado de la creación y snapshot del precio.
   */
  @Post()
  @ApiBody({ type: CreateBookingDto })
  @ApiCreatedResponse({ type: CreateBookingResponseDto })
  createBooking(@Body() body: CreateBookingDto) {
    return this.bookingService.createBooking(body);
  }

  /**
   * Crea una solicitud de cotizacion sin iniciar el flujo de cobro inmediato.
   *
   * DIFERENCIA CON POST /booking:
   * - reutiliza las validaciones actuales del formulario
   * - crea el Booking en estado operativo `pending`
   * - marca el estado comercial como `quote_requested`
   * - no genera `paymentUrl`
   * - no inicializa Stripe
   */
  @Post('quote-request')
  @ApiBody({ type: CreateBookingDto })
  @ApiCreatedResponse({ type: CreateQuoteRequestResponseDto })
  createQuoteRequest(@Body() body: CreateBookingDto) {
    return this.bookingService.createQuoteRequest(body);
  }

  /**
   * Inicia la revision administrativa de una solicitud de cotizacion.
   * Solo muta `commercialStatus`; no toca el `status` operativo legacy.
   */
  @Patch(':id/review/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: QuoteWorkflowResponseDto })
  async startQuoteReview(
    @Param('id') id: string,
    @Req() req: { user?: AuthUser },
  ) {
    const booking = await this.bookingService.startQuoteReview(id, req.user);
    return {
      success: true,
      message: 'Quote review started',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  /**
   * Guarda o actualiza el borrador de cotizacion.
   * Mantiene el flujo comercial desacoplado del flujo de pagos.
   */
  @Patch(':id/quote/draft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBody({ type: UpdateQuoteDraftDto })
  @ApiOkResponse({ type: QuoteWorkflowResponseDto })
  async saveQuoteDraft(
    @Param('id') id: string,
    @Body() body: UpdateQuoteDraftDto,
    @Req() req: { user?: AuthUser },
  ) {
    const booking = await this.bookingService.saveQuoteDraft(
      id,
      body,
      req.user,
    );
    return {
      success: true,
      message: 'Quote draft saved',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  /**
   * Marca la cotizacion como enviada al cliente.
   * No genera paymentUrl ni inicia Stripe.
   */
  @Patch(':id/quote/send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: QuoteWorkflowResponseDto })
  async sendQuote(@Param('id') id: string, @Req() req: { user?: AuthUser }) {
    const booking = await this.bookingService.sendQuote(id, req.user);
    return {
      success: true,
      message: 'Quote sent',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  /**
   * Rechaza administrativamente la cotizacion o cierra el caso sin continuar.
   */
  @Patch(':id/quote/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBody({ type: RejectQuoteDto })
  @ApiOkResponse({ type: QuoteWorkflowResponseDto })
  async rejectQuote(
    @Param('id') id: string,
    @Body() body: RejectQuoteDto,
    @Req() req: { user?: AuthUser },
  ) {
    const booking = await this.bookingService.rejectQuote(id, body, req.user);
    return {
      success: true,
      message: 'Quote rejected',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  /**
   * Reabre una cotizacion previamente rechazada. Solo Administrador.
   * Devuelve el booking a estado editable (under_review) sin tocar Stripe ni
   * enviar correos al cliente, y sin borrar informacion historica.
   */
  @Patch(':id/quote/reopen')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: QuoteWorkflowResponseDto })
  async reopenQuote(
    @Param('id') id: string,
    @Req() req: { user?: AuthUser },
  ) {
    const booking = await this.bookingService.reopenQuote(id, req.user);
    return {
      success: true,
      message: 'Quote reopened',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  /**
   * Revisar / corregir cotizacion YA ENVIADA (quote_sent → under_review).
   * Solo Administrador.
   * No crea Stripe session ni envia email solo por revisar; el Admin debe
   * ejecutar Send Quote nuevamente para enviar la version corregida.
   */
  @Patch(':id/quote/revise')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: QuoteWorkflowResponseDto })
  async reviseQuote(
    @Param('id') id: string,
    @Req() req: { user?: AuthUser },
  ) {
    const booking = await this.bookingService.reviseQuote(id, req.user);
    return {
      success: true,
      message: 'Quote revision started',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  /**
   * Expira una cotizacion enviada.
   * Se usa cuando la validez comercial termina sin respuesta del cliente.
   */
  @Patch(':id/quote/expire')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: QuoteWorkflowResponseDto })
  async expireQuote(@Param('id') id: string, @Req() req: { user?: AuthUser }) {
    const booking = await this.bookingService.expireQuote(id, req.user);
    return {
      success: true,
      message: 'Quote expired',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  /**
   * Actualiza el estado de una reserva (ej. de pending a confirmed).
   * Requiere rol de Administrador.
   * @param id ID de la reserva.
   * @param body Nuevo estado deseado.
   * @returns Respuesta con la reserva actualizada.
   */
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: BookingMutationResponseDto })
  async updateBookingStatus(
    @Param('id') id: string,
    @Body() body: UpdateBookingStatusDto,
  ) {
    this.logger.log(
      JSON.stringify({
        event: 'booking.status_update',
        bookingId: id,
        status: body.status,
      }),
    );

    const booking = await this.bookingService.updateStatus(id, body.status);
    return {
      success: true,
      message: 'Booking status updated',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Patch(':id/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  @ApiOkResponse({ type: BookingMutationResponseDto })
  async assignBooking(@Param('id') id: string, @Body() body: AssignBookingDto) {
    const employeeIds = Array.isArray(body.employeeIds)
      ? body.employeeIds
      : typeof body.employeeId === 'string' && body.employeeId.trim()
        ? [body.employeeId]
        : [];

    const booking = await this.bookingService.assignBooking(id, {
      supervisorId: body.supervisorId,
      employeeIds,
    });
    return {
      success: true,
      message: 'Booking assigned',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Patch(':id/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.SUPERVISOR)
  @ApiOkResponse({ type: BookingMutationResponseDto })
  async startBooking(@Param('id') id: string, @Req() req: { user?: AuthUser }) {
    const booking = await this.bookingService.startBooking(id, req.user);
    return {
      success: true,
      message: 'Job started',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE, UserRole.SUPERVISOR)
  @ApiOkResponse({ type: BookingMutationResponseDto })
  async completeBooking(
    @Param('id') id: string,
    @Req() req: { user?: AuthUser },
  ) {
    const booking = await this.bookingService.completeBooking(id, req.user);
    return {
      success: true,
      message: 'Job completed',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Patch(':id/apply-first-service-discount')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({
    description:
      'Admin-only: Manually applies the 15% first-service discount to a booking. Customer must have requested the discount via the "Is this your first time with us?" checkbox during booking.',
  })
  async applyFirstServiceDiscount(
    @Param('id') id: string,
    @Req() req: { user?: AuthUser },
  ) {
    if (!req.user) {
      throw new BadRequestException('Authenticated user context is missing');
    }
    const result = await this.bookingService.applyAdminFirstServiceDiscount(
      id,
      req.user,
    );
    return {
      success: true,
      message: 'First-service discount applied successfully',
      data: result.booking,
      discount: result.discount,
    };
  }

  @Patch(':id/confirm-and-send-payment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({
    description:
      'Admin-only: Locks the final admin-approved price, creates a Stripe checkout session for the final amount, saves the payment link on the booking, transitions the booking to confirmed/payment_pending, and sends the customer a final quote email with the payment link. Idempotent: repeated calls return the existing payment link without creating new Stripe sessions or sending duplicate emails.',
  })
  async confirmAndSendPayment(
    @Param('id') id: string,
    @Req() req: { user?: AuthUser },
  ) {
    if (!req.user) {
      throw new BadRequestException('Authenticated user context is missing');
    }
    const result = await this.bookingService.confirmAndSendPayment(
      id,
      req.user,
    );
    return {
      success: true,
      message: result.wasAlreadyIssued
        ? 'Payment link already issued — returning existing link (no duplicate email or Stripe session created).'
        : 'Booking confirmed. Final price locked, Stripe checkout link generated, and payment request email sent to customer.',
      data: result.booking,
      wasAlreadyIssued: result.wasAlreadyIssued,
      stripeSessionId: result.stripeSessionId ?? null,
      customerEmailSent: result.customerEmailSent,
    };
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: BookingMutationResponseDto })
  async cancelBookingByAdmin(
    @Param('id') id: string,
    @Body() cancelDto: CancelBookingAdminDto,
    @Req() req: { user?: AuthUser },
  ) {
    if (!req.user) {
      throw new BadRequestException('Authenticated user context is missing');
    }
    const booking = await this.bookingService.cancelByAdmin(
      id,
      req.user,
      cancelDto,
    );
    return {
      success: true,
      message: 'Booking cancelled. Record preserved for audit.',
      data: this.bookingService.formatBookingForDisplay(booking),
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({
    description:
      'Admin-only destructive delete. Requires explicit re-authentication (email + password) verified server-side against the bcrypt-hashed admin user collection. Both the JWT-authenticated caller AND the re-authenticated credentials must be ADMIN role. Permanently removes the booking document and associated payment records from MongoDB.',
  })
  async deleteBookingPermanent(
    @Param('id') id: string,
    @Body() deleteDto: DeleteBookingAdminDto,
    @Req() req: { user?: AuthUser },
  ) {
    if (!req.user) {
      throw new BadRequestException('Authenticated user context is missing');
    }
    const result = await this.bookingService.deleteAdminPermanent(
      id,
      deleteDto.reAuth,
      req.user,
    );
    return {
      success: true,
      message: `Booking ${result.deletedId} permanently deleted from database.`,
      deletedId: result.deletedId,
      deletedPayments: result.deletedPayments,
      verifiedBy: result.verifiedBy,
    };
  }

  // ========================================================================
  // CUSTOM QUOTE (FASE 4D) — Aislado del flujo normal de booking.
  // Endpoint PÚBLICO (sin JWT). NO persiste en MongoDB.
  // Solo valida campos + envía email con attachments a la empresa + confirmación al cliente.
  // ========================================================================

  /**
   * Envía una solicitud de Custom Quote por email.
   *
   * Características:
   * - Público (no requiere autenticación)
   * - Acepta multipart/form-data con fotos adjuntas (jpg/png/webp)
   * - NO crea ningún registro en MongoDB
   * - Envía (1) email a la empresa con attachments + replyTo = cliente
   * - Envía (2) email de confirmación al cliente (sin attachments)
   *
   * @param reqBody Campos del formulario (parsed como string desde multipart)
   * @param files Array de fotos adjuntas (multer)
   * @returns Resultado del envío con éxito
   */
  @Post('custom-quote-email')
  @UseInterceptors(
    FilesInterceptor('photos', 10, {
      limits: {
        fileSize: 2 * 1024 * 1024,
        files: 10,
      },
      fileFilter: (
        _req: unknown,
        file: MulterUploadedFile,
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const allowed = /^image\/(png|jpe?g|webp)$/i;
        if (allowed.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Invalid file type "${file.mimetype}". Only PNG, JPG, JPEG, WEBP images are allowed.`,
            ),
            false,
          );
        }
      },
    }),
  )
  @ApiCreatedResponse({
    description: 'Custom Quote email sent successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Custom Quote request sent successfully.',
        },
        sentTo: { type: 'array', items: { type: 'string' } },
        messageId: { type: 'string', nullable: true },
      },
    },
  })
  async sendCustomQuoteEmail(
    @Req() req: { body: Record<string, unknown> },
    @UploadedFiles() files: MulterUploadedFile[] = [],
  ) {
    const body = req.body ?? {};

    const plainPayload = {
      name: typeof body.name === 'string' ? body.name : '',
      email: typeof body.email === 'string' ? body.email : '',
      address: typeof body.address === 'string' ? body.address : '',
      requestType: typeof body.requestType === 'string' ? body.requestType : '',
      description: typeof body.description === 'string' ? body.description : '',
    };

    const dto = plainToInstance(CustomQuoteDto, plainPayload);

    try {
      await validateOrReject(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    } catch (validationErrors) {
      const messages: string[] = [];
      if (Array.isArray(validationErrors)) {
        for (const err of validationErrors) {
          if (err && 'constraints' in err && err.constraints) {
            for (const key of Object.keys(
              err.constraints as Record<string, string>,
            )) {
              messages.push(
                `${err.property}: ${(err.constraints as Record<string, string>)[key]}`,
              );
            }
          }
        }
      }
      throw new BadRequestException({
        message: 'Validation failed for Custom Quote.',
        errors: messages.length > 0 ? messages : undefined,
      });
    }

    if (!Array.isArray(files)) {
      throw new BadRequestException('Invalid files payload.');
    }
    const totalSize = files.reduce((sum, f) => sum + (f?.size ?? 0), 0);
    if (totalSize > 20 * 1024 * 1024) {
      throw new BadRequestException(
        `Total photos size exceeds the 20 MB limit. Current size: ${Math.round(totalSize / 1024 / 1024)} MB.`,
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'custom_quote.endpoint_hit',
        requestType: dto.requestType,
        filesCount: files.length,
        totalSizeKB: Math.round(totalSize / 1024),
      }),
    );

    const result = await this.bookingService.sendCustomQuoteEmail(
      {
        name: dto.name,
        email: dto.email,
        address: dto.address,
        requestType: dto.requestType,
        description: dto.description,
      },
      files.map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        buffer: f.buffer,
        size: f.size,
      })),
    );

    return {
      success: true,
      message: 'Custom Quote request sent successfully.',
      sentTo: result.sentTo,
      messageId: result.messageId,
    };
  }
}
