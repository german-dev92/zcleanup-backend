import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole } from '../../auth/roles.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    unique: true,
  })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({
    type: String,
    required: true,
    enum: [UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.EMPLOYEE],
    default: UserRole.EMPLOYEE,
  })
  role: UserRole;

  @Prop({ type: Boolean, default: true })
  active: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
