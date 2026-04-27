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

@Schema({ timestamps: true })
export class Booking {
  // 🟢 PRINCIPALES
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: false })
  phone?: string;

  @Prop({ required: false })
  address?: string;

  @Prop({ type: Number, required: false })
  lat?: number;

  @Prop({ type: Number, required: false })
  lng?: number;

  @Prop({ required: true })
  cleaningType: string;

  @Prop({ required: true })
  desiredDate: string;

  @Prop({ required: true })
  desiredTime: string;

  // 🟡 FLAGS
  @Prop({ default: false })
  petsAtHome?: boolean;

  @Prop({ default: false })
  useOwnProducts?: boolean;

  @Prop({ default: false })
  applyFirstDiscount?: boolean;

  @Prop({ default: false })
  distanceSurcharge?: boolean;

  @Prop({ required: false })
  assignedZone?: string;

  @Prop({ default: false })
  isBorderline?: boolean;

  @Prop({ type: Number, required: false })
  distanceKm?: number;

  @Prop({ type: String, enum: BOOKING_STATUSES, default: 'pending' })
  status: BookingStatus;

  @Prop({ type: Types.ObjectId, ref: 'Employee', required: false })
  assignedEmployeeId?: Types.ObjectId;

  @Prop({ required: false, lowercase: true, trim: true })
  assignedEmployeeEmail?: string;

  @Prop({ required: false, trim: true })
  assignedEmployeeName?: string;

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

  @Prop({
    type: {
      employeeId: { type: Types.ObjectId, ref: 'Employee', required: true },
      name: { type: String, default: '' },
    },
    required: false,
  })
  assignedSupervisor?: AssignedBookingSupervisor;

  @Prop({ type: Date, required: false })
  assignedAt?: Date;

  @Prop({ type: Date, required: false })
  startedAt?: Date;

  @Prop({ type: Date, required: false })
  completedAt?: Date;

  // 🟡 NEGOCIO
  @Prop({ required: false })
  frequency?: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  extras?: unknown[];

  // 💰 PRICING SNAPSHOT
  @Prop({ type: Number, required: false })
  estimatedPrice?: number;

  @Prop({ type: Number, required: false })
  finalPricePreview?: number;

  @Prop({ required: false })
  paymentUrl?: string;

  @Prop({ type: String, enum: ['pending', 'paid'], default: 'pending' })
  paymentStatus: 'pending' | 'paid';

  @Prop({ type: Date, required: false })
  paidAt?: Date;

  // 🔵 DINÁMICO (CLAVE DEL SISTEMA)
  @Prop({ type: Object, required: false })
  dynamicFields?: Record<string, any>;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

BookingSchema.index({ status: 1, createdAt: -1 });
BookingSchema.index({ email: 1, createdAt: -1 });
BookingSchema.index({ createdAt: -1 });
