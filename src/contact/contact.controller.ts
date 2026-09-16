import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContactMessageDto } from './dto/contact-message.dto';
import { ContactService } from './contact.service';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a Contact Us message',
    description:
      'Public endpoint. Validates the message, sends an internal notification to the ZCLEANUP team inbox with Reply-To set to the customer email, then sends a confirmation receipt email to the customer.',
  })
  @ApiBody({ type: ContactMessageDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Message accepted and queued for delivery',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Message sent successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed (invalid email, missing subject, subject not in allowed list, etc.)',
  })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async submitContactMessage(@Body() dto: ContactMessageDto): Promise<{ message: string }> {
    await this.contactService.sendContactMessage(dto);
    return { message: 'Message sent successfully' };
  }
}
