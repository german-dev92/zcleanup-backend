import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { BOOKING_STATUSES, type BookingStatus } from '../types/booking-status';

export type BookingDocument = Booking & Document;

/**
 * Estados comerciales para el nuevo flujo de cotizaciones.
 *
 * Importante:
 * - Son aditivos y opcionales.
 * - No reemplazan el `status` operativo legacy.
 * - Permiten convivir ambos flujos mientras la migracion este en curso.
 */
export const BOOKING_COMMERCIAL_STATUSES = [
  'quote_requested',
  'under_review',
  'quoted_draft',
  'quote_sent',
  'quote_accepted',
  'quote_rejected',
  'quote_expired',
  'closed_without_sale',
  'legacy_direct_booking',
] as const;

export type BookingCommercialStatus =
  (typeof BOOKING_COMMERCIAL_STATUSES)[number];

/**
 * Ciclo financiero ampliado para el flujo con cotizacion.
 *
 * Importante:
 * - Coexiste con `paymentStatus` durante la migracion.
 * - Permite modelar readiness de invoice/checkout sin romper el flujo actual.
 */
export const BOOKING_PAYMENT_LIFECYCLE_STATUSES = [
  'not_ready',
  'invoice_ready',
  'checkout_created',
  'payment_pending',
  'paid',
  'payment_failed',
  'refunded',
  'voided',
] as const;

export type BookingPaymentLifecycleStatus =
  (typeof BOOKING_PAYMENT_LIFECYCLE_STATUSES)[number];

type AssignedBookingEmployee = {
  employeeId: Types.ObjectId;
  name: string;
  role: string;
};

type AssignedBookingSupervisor = {
  employeeId: Types.ObjectId;
  name: string;
};

type BookingQuoteManualAdjustment = {
  type?: 'fixed' | 'percent';
  label?: string;
  amount?: number;
  reason?: string;
};

export const ADMIN_QUOTE_DISCOUNT_TYPES = [
  'none',
  'regular_client',
  'first_time_customer',
  'loyalty_customer',
] as const;
export type AdminQuoteDiscountType =
  (typeof ADMIN_QUOTE_DISCOUNT_TYPES)[number];

type BookingQuote = {
  version?: number;
  status?: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  baseCalculatedPrice?: number;
  finalQuotedPrice?: number;
  manualAdjustments?: BookingQuoteManualAdjustment[];
  discountType?: AdminQuoteDiscountType;
  discountPercent?: number;
  discountAmount?: number;
  discountReason?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  sentAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  revisedAt?: Date;
  revisedBy?: string;
  reopenedAt?: Date;
  reopenedBy?: string;
  expiresAt?: Date;
  customerMessage?: string;
  internalNotes?: string;
};

/**
 * @schema Booking
 * @description Esquema de base de datos para las reservas de limpieza.
 * Define la estructura de datos persistida en MongoDB, incluyendo información del cliente,
 * detalles del servicio, asignación de personal, precios y estado del pago.
 */
@Schema({ timestamps: true })
export class Booking {
  // 🟢 PRINCIPALES
  /** Nombre completo del cliente */
  @Prop({ required: true })
  name: string;

  /** Correo electrónico de contacto */
  @Prop({ required: true })
  email: string;

  /** Teléfono de contacto opcional */
  @Prop({ required: false })
  phone?: string;

  /** Dirección completa donde se realizará el servicio */
  @Prop({ required: false })
  address?: string;

  /** Latitud geográfica para geolocalización */
  @Prop({ type: Number, required: false })
  lat?: number;

  /** Longitud geográfica para geolocalización */
  @Prop({ type: Number, required: false })
  lng?: number;

  /** Tipo de limpieza seleccionado (slug) */
  @Prop({ required: true })
  cleaningType: string;

  /** Cantidad de habitaciones (bedrooms) seleccionadas para el paquete base de limpieza */
  @Prop({ type: Number, required: false })
  bedrooms?: number;

  /** Cantidad de baños (bathrooms) seleccionados para el paquete base */
  @Prop({ type: Number, required: false })
  bathrooms?: number;

  /** Habitaciones adicionales agregadas (extra bedrooms beyond base package). Multiplicador V2. */
  @Prop({ type: Number, required: false, default: 0 })
  additionalBedrooms?: number;

  /** Fecha deseada para el servicio (formato string ISO o local) */
  @Prop({ required: true })
  desiredDate: string;

  /** Hora deseada para el servicio */
  @Prop({ required: true })
  desiredTime: string;

  // 🟡 FLAGS
  /** Indica si hay mascotas en el domicilio */
  @Prop({ default: false })
  petsAtHome?: boolean;

  /** Notas opcionales del cliente sobre precauciones seguridad para mascotas */
  @Prop({ required: false, maxlength: 1200 })
  petSafetyNotes?: string;

  /** Indica si el cliente prefiere usar sus propios productos de limpieza */
  @Prop({ default: false })
  useOwnProducts?: boolean;

  /** Alias EN: Customer's own cleaning products flag (redundante alias por claridad FE) */
  @Prop({ default: false })
  usesOwnCleaningProducts?: boolean;

  /** Notas opcionales del cliente: productos que usar y áreas/superficies asignadas a cada producto */
  @Prop({ required: false, maxlength: 1200 })
  cleaningProductNotes?: string;

  /** Solicitud DESDE cliente de revisar elegibilidad descuento 15% primera vez. NO es aprobación. Aprobación por Admin Panel = discountApplied. */
  @Prop({ default: false })
  firstServiceDiscountRequested?: boolean;

  /** Indica si se debe aplicar el descuento por primera reserva (LEGACY, reemplazado por firstServiceDiscountRequested lado cliente y discountApplied lado admin). Mantener por backwards compat solo. */
  @Prop({ default: false })
  applyFirstDiscount?: boolean;

  /** 🔴 SIDE ADMIN ONLY. Indica si un Administrador aplicó DESPUÉS la aprobación manual del 15% first-service discount. Default=false (sin descuento a menos que Admin apruebe). */
  @Prop({ default: false })
  discountApplied?: boolean;

  /** Snapshot en dólares del monto de descuento 15% calculado por Admin apply (se guarda solo cuando discountApplied=true). */
  @Prop({ type: Number, required: false })
  discountAmount?: number;

  /** Snapshot del porcentaje (15) cuando Admin aplicó discount (default=null/undefined; 15 si se aplicó). */
  @Prop({ type: Number, required: false })
  discountPercent?: number;

  /** (Audit) Email/ID del usuario Admin que aprobó/aplicó el first-service discount. Referencia AuthUser email/id. */
  @Prop({ required: false })
  discountAppliedBy?: string;

  /** (Audit) Fecha-hora de la aprobación del discount por Admin. */
  @Prop({ type: Date, required: false })
  discountAppliedAt?: Date;

  /** Indica si se aplica un recargo por distancia */
  @Prop({ default: false })
  distanceSurcharge?: boolean;

  /** Zona de servicio asignada por el motor de GeoPricing */
  @Prop({ required: false })
  assignedZone?: string;

  /** Indica si la dirección está en el límite de la zona de cobertura */
  @Prop({ default: false })
  isBorderline?: boolean;

  /** Distancia calculada en KM desde el centro de servicio */
  @Prop({ type: Number, required: false })
  distanceKm?: number;

  /** Estado actual de la reserva (pending, confirmed, assigned, etc.) */
  @Prop({ type: String, enum: BOOKING_STATUSES, default: 'pending' })
  status: BookingStatus;

  /**
   * Estado comercial del caso para el flujo de solicitud de cotizacion.
   * Se mantiene opcional para no romper documentos legacy ya persistidos.
   */
  @Prop({
    type: String,
    enum: BOOKING_COMMERCIAL_STATUSES,
    required: false,
  })
  commercialStatus?: BookingCommercialStatus;

  /**
   * Estado ampliado del ciclo de cobro/invoice/checkout.
   * No reemplaza `paymentStatus` todavia; convive con el flujo legacy.
   */
  @Prop({
    type: String,
    enum: BOOKING_PAYMENT_LIFECYCLE_STATUSES,
    required: false,
  })
  paymentLifecycleStatus?: BookingPaymentLifecycleStatus;

  /** ID del empleado principal asignado (legacy) */
  @Prop({ type: Types.ObjectId, ref: 'Employee', required: false })
  assignedEmployeeId?: Types.ObjectId;

  /** Email del empleado asignado */
  @Prop({ required: false, lowercase: true, trim: true })
  assignedEmployeeEmail?: string;

  /** Nombre del empleado asignado */
  @Prop({ required: false, trim: true })
  assignedEmployeeName?: string;

  /** Lista de empleados asignados a la reserva */
  @Prop({
    type: [
      {
        employeeId: { type: Types.ObjectId, ref: 'Employee', required: true },
        name: { type: String, default: '' },
        role: { type: String, default: '' },
      },
    ],
    default: [],
    required: false,
  })
  assignedEmployees?: AssignedBookingEmployee[];

  /** Supervisor asignado para auditar el servicio */
  @Prop({
    type: {
      employeeId: { type: Types.ObjectId, ref: 'Employee', required: true },
      name: { type: String, default: '' },
    },
    required: false,
  })
  assignedSupervisor?: AssignedBookingSupervisor;

  /** Fecha y hora de asignación del personal */
  @Prop({ type: Date, required: false })
  assignedAt?: Date;

  /** Fecha y hora real de inicio del servicio */
  @Prop({ type: Date, required: false })
  startedAt?: Date;

  /** Fecha y hora real de finalización del servicio */
  @Prop({ type: Date, required: false })
  completedAt?: Date;

  // 🟡 NEGOCIO
  /** Frecuencia del servicio (ej. once, weekly) */
  @Prop({ required: false })
  frequency?: string;

  /** Servicios extra seleccionados (array de objetos mixtos) */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  extras?: unknown[];

  // 💰 PRICING SNAPSHOT
  /** Precio base estimado guardado al momento de la creación */
  @Prop({ type: Number, required: false })
  estimatedPrice?: number;

  /** Precio final calculado (incluyendo descuentos y recargos) */
  @Prop({ type: Number, required: false })
  finalPricePreview?: number;

  /** URL de pago generada por Stripe para esta reserva */
  @Prop({ required: false })
  paymentUrl?: string;

  /** Estado del pago de la reserva */
  @Prop({ type: String, enum: ['pending', 'paid'], default: 'pending' })
  paymentStatus: 'pending' | 'paid';

  /** Fecha y hora en que se confirmó el pago */
  @Prop({ type: Date, required: false })
  paidAt?: Date;

  /**
   * Subdocumento opcional de cotizacion.
   *
   * Diseno:
   * - Vive dentro de Booking para minimizar riesgo de migracion.
   * - No fuerza backfill de documentos antiguos.
   * - Permite introducir versionado y decision comercial sin tocar el flujo actual.
   */
  @Prop({
    type: {
      version: { type: Number, required: false },
      status: {
        type: String,
        enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
        required: false,
      },
      baseCalculatedPrice: { type: Number, required: false },
      finalQuotedPrice: { type: Number, required: false },
      manualAdjustments: {
        type: [
          {
            type: {
              type: String,
              enum: ['fixed', 'percent'],
              required: false,
            },
            label: { type: String, required: false },
            amount: { type: Number, required: false },
            reason: { type: String, required: false },
          },
        ],
        required: false,
        default: undefined,
      },
      discountType: {
        type: String,
        enum: ADMIN_QUOTE_DISCOUNT_TYPES as unknown as string[],
        required: false,
      },
      discountPercent: { type: Number, required: false },
      discountAmount: { type: Number, required: false },
      discountReason: { type: String, required: false, maxlength: 500 },
      reviewedBy: { type: String, required: false },
      reviewedAt: { type: Date, required: false },
      sentAt: { type: Date, required: false },
      acceptedAt: { type: Date, required: false },
      rejectedAt: { type: Date, required: false },
      rejectionReason: { type: String, required: false, maxlength: 1000 },
      revisedAt: { type: Date, required: false },
      revisedBy: { type: String, required: false },
      reopenedAt: { type: Date, required: false },
      reopenedBy: { type: String, required: false },
      expiresAt: { type: Date, required: false },
      customerMessage: { type: String, required: false },
      internalNotes: { type: String, required: false },
    },
    required: false,
  })
  quote?: BookingQuote;

  // 🟣 V2 NEW MODEL – Campos nuevos (todos opcionales para compatibilidad histórica)

  /**
   * Versión del motor de pricing utilizado para calcular el precio.
   * - V1: modelo legacy (6 cleaningType alternativos, tarifas Standard/Deep/
   *       Apartment/Move/Post-Const/Window separadas, Pets=$10, Borderline=$20,
   *       threshold 3km inside)
   * - V2: nuevo Regular Cleaning base obligatorio + Special Service suplemento
   *       + Extras catalogo nuevo + matrix compatibilidad + Pets=$0 +
   *       Borderline $25 threshold 1km outside
   * Default = undefined en docs antiguos => se interpreta como V1 para
   * preservar render histórico.
   */
  @Prop({ required: false, type: String, enum: ['V1', 'V2'] })
  pricingModelVersion?: 'V1' | 'V2';

  /** ID de Regular Cleaning Package (V2). Ej '3-2'. */
  @Prop({ required: false })
  regularCleaningPackageId?: string;

  /** ID de Special Service seleccionado (V2). Max 1. */
  @Prop({ required: false })
  specialServiceId?: string;

  /** Fee V2 por estar en zona BORDERLINE. */
  @Prop({ type: Number, required: false })
  borderlineFee?: number;

  /** Clasificación V2 INSIDE / BORDERLINE / OUTSIDE */
  @Prop({ required: false })
  coverageClassification?: string;

  /** 🔴 SIDE ADMIN ONLY — Final price that drives Stripe/payment after any 15% discount and manual Admin adjustments.
   * Populated ONLY by BookingService.confirmAndSendPayment() during authoritative confirm.
   * `undefined` until Admin confirms the quote.
   */
  @Prop({ type: Number, required: false })
  finalAdminApprovedPrice?: number;

  /** SIDE ADMIN ONLY — Signed delta applied (USD):
   * positive = added on top of (calculatedPrice - discount); negative = discount/deduction.
   * Calculated: finalAdminApprovedPrice - (calculatedPriceAfterDiscount).
   * 0 when no adjustment applied by Admin.
   */
  @Prop({ type: Number, required: false })
  adminAdjustedAmountUsd?: number;

  /** SIDE ADMIN ONLY — Freeform reason why Admin adjusted the price (from manualAdjustments[last].reason or Admin input). */
  @Prop({ required: false, maxlength: 500 })
  priceAdjustmentReason?: string;

  // 🔵 DINÁMICO (CLAVE DEL SISTEMA)
  /** Campos adicionales dinámicos que varían según el tipo de servicio */
  @Prop({ type: Object, required: false })
  dynamicFields?: Record<string, any>;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

BookingSchema.index({ status: 1, createdAt: -1 });
BookingSchema.index({ email: 1, createdAt: -1 });
BookingSchema.index({ createdAt: -1 });

/**
 * Indices aditivos para el nuevo flujo comercial.
 *
 * Se agregan como indices opcionales sobre campos nuevos para:
 * - listar solicitudes de cotizacion por estado comercial
 * - soportar futuras bandejas administrativas de revision
 *
 * No afectan documentos legacy, porque los campos son opcionales.
 */
BookingSchema.index({ commercialStatus: 1, createdAt: -1 });
BookingSchema.index({ paymentLifecycleStatus: 1, createdAt: -1 });
