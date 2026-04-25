import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DiscountUsedDocument = DiscountUsed & Document;

@Schema({ timestamps: true })
export class DiscountUsed {
  @Prop({ required: false, lowercase: true, trim: true })
  email?: string;

  @Prop({ required: false, unique: true, sparse: true })
  normalizedAddress?: string;

  @Prop()
  bookingId: string;

  @Prop()
  usedAt: Date;
}

export const DiscountUsedSchema = SchemaFactory.createForClass(DiscountUsed);

DiscountUsedSchema.index({ email: 1 }, { unique: true, sparse: true });
DiscountUsedSchema.index({ bookingId: 1 });
