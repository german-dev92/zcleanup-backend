import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BookingDocument = Booking & Document;

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

  // 🟡 NEGOCIO
  @Prop({ required: false })
  frequency?: string;

  @Prop({ type: [String], default: [] })
  extras?: string[];

  // 💰 PRICING SNAPSHOT
  @Prop({ type: Number, required: false })
  estimatedPrice?: number;

  @Prop({ type: Number, required: false })
  finalPricePreview?: number;

  // 🔵 DINÁMICO (CLAVE DEL SISTEMA)
  @Prop({ type: Object, required: false })
  dynamicFields?: Record<string, any>;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);