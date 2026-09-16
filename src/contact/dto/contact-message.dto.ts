import { IsEmail, IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const CONTACT_SUBJECTS = [
  'General Inquiry',
  'Custom Quote',
  'Feedback',
  'Support',
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

export class ContactMessageDto {
  @ApiProperty({
    description: 'Full name of the sender',
    example: 'Jane Doe',
    maxLength: 60,
    minLength: 3,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    description: 'Email address of the sender (used as Reply-To for the team)',
    example: 'jane@example.com',
    maxLength: 254,
  })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    description: 'Subject category selected in the Contact Us form',
    enum: CONTACT_SUBJECTS,
    example: 'General Inquiry',
  })
  @IsIn(CONTACT_SUBJECTS)
  @IsNotEmpty()
  subject!: ContactSubject;

  @ApiProperty({
    description: 'Message body from the customer',
    example: 'I would like more information about your cleaning services.',
    minLength: 20,
    maxLength: 1500,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(1500)
  message!: string;
}
