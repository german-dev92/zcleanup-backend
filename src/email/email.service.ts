import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { EmailBuilder } from './email.builder.js';
import type {
  BookingEmailPayload,
  BookingEventType,
  ContractAttachmentOption,
  EmailAttachment,
} from './email.builder.js';

@Injectable()
export class EmailService {
  private transporter: Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly emailBuilder: EmailBuilder) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  // -----------------------------
  // ENTRY POINT
  // -----------------------------
  async sendBookingEmail(booking: BookingEmailPayload): Promise<unknown> {
    return this.sendBookingEventEmail({
      eventType: 'booking.created',
      booking,
    });
  }

  // -----------------------------
  // MAIN DISPATCHER
  // -----------------------------
  async sendBookingEventEmail(params: {
    eventType: BookingEventType;
    booking: BookingEmailPayload;
    attachments?: EmailAttachment[];
    contractAttachment?: ContractAttachmentOption;
  }): Promise<unknown> {
    const { eventType, booking } = params;

    const builtEmail = this.emailBuilder.buildBookingEmail(params);

    if (!booking?.email) {
      throw new Error('[EMAIL] Missing booking.email in payload');
    }

    // 🚨 CRÍTICO: usar EMAIL BUILDER como SOURCE OF TRUTH
    const toEmail = builtEmail.to;

    const result = await this.transporter.sendMail({
      from: `"Your ZCLEANUP Team" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: builtEmail.subject,
      html: builtEmail.html,
      attachments: builtEmail.attachments,
    });

    const messageId =
      typeof result === 'object' && result !== null && 'messageId' in result
        ? (result as { messageId?: unknown }).messageId
        : undefined;

    this.logger.log(
      JSON.stringify({ event: 'email.sent', eventType, messageId }),
    );

    return result;
  }
}
