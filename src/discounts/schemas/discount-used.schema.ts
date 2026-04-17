import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DiscountUsedDocument = DiscountUsed & Document;

@Schema({ timestamps: true })
export class DiscountUsed {
  @Prop({ required: true })
  email: string;

  @Prop({ required: false, unique: true, sparse: true })
  normalizedAddress?: string;

  @Prop()
  bookingId: string;

  @Prop()
  usedAt: Date;
}

export const DiscountUsedSchema = SchemaFactory.createForClass(DiscountUsed);
