import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { BOOKING_STATUSES, type BookingStatus } from '../types/booking-status';

export type BookingDocument = Booking & Document;

type AssignedBookingEmployee = {
  employeeId: Types.ObjectId;
  name: string;
  role: string;
};

type AssignedBookingSupervisor = {
  employeeId: Types.ObjectId;
  name: string;
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

  /** Tipo de limpieza seleccionada (slug) */
  @Prop({ required: true })
  cleaningType: string;

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

  /** Indica si el cliente prefiere usar sus propios productos de limpieza */
  @Prop({ default: false })
  useOwnProducts?: boolean;

  /** Indica si se debe aplicar el descuento por primera reserva */
  @Prop({ default: false })
  applyFirstDiscount?: boolean;

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

  // 🔵 DINÁMICO (CLAVE DEL SISTEMA)
  /** Campos adicionales dinámicos que varían según el tipo de servicio */
  @Prop({ type: Object, required: false })
  dynamicFields?: Record<string, any>;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

BookingSchema.index({ status: 1, createdAt: -1 });
BookingSchema.index({ email: 1, createdAt: -1 });
BookingSchema.index({ createdAt: -1 });
