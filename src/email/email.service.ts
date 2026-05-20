import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { EmailBuilder } from './email.builder';
import type {
  BookingEmailPayload,
  BookingEventType,
  ContractAttachmentOption,
  EmailAttachment,
} from './email.builder';

/**
 * @class EmailService
 * @description Servicio para el envío de correos electrónicos.
 * Utiliza Nodemailer con Gmail y un constructor de plantillas dinámico.
 */
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

  /**
   * Envía un correo electrónico de creación de reserva.
   * @param booking Datos de la reserva para incluir en la plantilla.
   * @returns Promesa con el resultado del envío.
   */
  async sendBookingEmail(booking: BookingEmailPayload): Promise<unknown> {
    return this.sendBookingEventEmail({
      eventType: 'booking.created',
      booking,
    });
  }

  /**
   * Despachador principal para correos relacionados con eventos de reserva.
   * Construye el correo usando el EmailBuilder y lo envía mediante el transportador configurado.
   * @param params Parámetros del evento, datos de la reserva y adjuntos opcionales.
   * @returns Promesa con el resultado del envío de Nodemailer.
   * @throws Error si falta el email del destinatario en los datos de la reserva.
   */
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
