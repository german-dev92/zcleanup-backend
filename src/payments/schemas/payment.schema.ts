import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PaymentDocument = Payment & Document;

export type PaymentProvider = 'stripe' | 'square';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

@Schema({ timestamps: true })
export class Payment {
  @Prop({ required: true })
  bookingId: string;

  @Prop({ required: true, enum: ['stripe', 'square'] })
  provider: PaymentProvider;

  @Prop({ required: true, enum: ['pending', 'paid', 'failed', 'refunded'] })
  status: PaymentStatus;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  currency: string;

  @Prop({ required: false })
  checkoutSessionId?: string;

  @Prop({ required: false })
  paymentIntentId?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ bookingId: 1, provider: 1 }, { unique: true });
