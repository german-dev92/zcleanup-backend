import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

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
 * Utiliza Resend HTTPS API y un constructor de plantillas dinámico.
 */
@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly emailBuilder: EmailBuilder) {
    this.resend = new Resend(process.env.RESEND_API_KEY ?? '');
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

    const fromAddress = (process.env.RESEND_FROM_ADDRESS ?? process.env.EMAIL_USER) as string;
    const result = await this.resend.emails.send({
      from: `"Your ZCLEANUP Team" <${fromAddress}>`,
      to: toEmail,
      subject: builtEmail.subject,
      html: builtEmail.html,
      attachments: builtEmail.attachments as any,
    });

    if (
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      (result as { error?: unknown }).error != null
    ) {
      const err = (result as { error: { name?: unknown; message?: unknown } }).error;
      const errName = typeof err.name === 'string' ? err.name : 'unknown_error';
      const errMessage = typeof err.message === 'string' ? err.message : 'No error message provided';
      const errorPayload = {
        event: 'email.failed',
        eventType,
        error: `${errName}: ${errMessage}`,
        errorName: errName,
        errorMessage: errMessage,
      };
      this.logger.error(JSON.stringify(errorPayload));
      throw new Error(`[EMAIL] ${errName}: ${errMessage}`);
    }

    let messageId: unknown = undefined;
    if (
      typeof result === 'object' &&
      result !== null &&
      'data' in result
    ) {
      const dataObj = (result as { data?: { id?: unknown } | null }).data;
      if (
        typeof dataObj === 'object' &&
        dataObj !== null &&
        'id' in dataObj
      ) {
        messageId = (dataObj as { id: unknown }).id;
      }
    }
    if (
      messageId === undefined &&
      typeof result === 'object' &&
      result !== null &&
      'messageId' in result
    ) {
      messageId = (result as { messageId?: unknown }).messageId;
    }

    this.logger.log(
      JSON.stringify({ event: 'email.sent', eventType, messageId }),
    );

    return result;
  }

  async sendRawEmail(params: {
    to?: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: EmailAttachment[];
    replyTo?: string;
  }): Promise<unknown> {
    const toEmail = params.to ?? (process.env.EMAIL_USER as string);
    const fromAddress = (process.env.RESEND_FROM_ADDRESS ?? process.env.EMAIL_USER) as string;
    const emailParams: Record<string, unknown> = {
      from: `"Your ZCLEANUP Team" <${fromAddress}>`,
      to: toEmail,
      subject: params.subject,
    };
    if (typeof params.replyTo === 'string' && params.replyTo.length > 0) {
      emailParams.replyTo = params.replyTo;
    }
    if (typeof params.text === 'string' && params.text.length > 0) {
      emailParams.text = params.text;
    }
    if (typeof params.html === 'string' && params.html.length > 0) {
      emailParams.html = params.html;
    }
    if (Array.isArray(params.attachments) && params.attachments.length > 0) {
      emailParams.attachments = params.attachments;
    }
    const result = await this.resend.emails.send(
      emailParams as unknown as Parameters<Resend['emails']['send']>[0],
    );

    if (
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      (result as { error?: unknown }).error != null
    ) {
      const err = (result as { error: { name?: unknown; message?: unknown } }).error;
      const errName = typeof err.name === 'string' ? err.name : 'unknown_error';
      const errMessage = typeof err.message === 'string' ? err.message : 'No error message provided';
      const errorPayload = {
        event: 'email.raw.failed',
        subject: params.subject,
        error: `${errName}: ${errMessage}`,
        errorName: errName,
        errorMessage: errMessage,
      };
      this.logger.error(JSON.stringify(errorPayload));
      throw new Error(`[EMAIL RAW] ${errName}: ${errMessage}`);
    }

    let messageId: unknown = undefined;
    if (
      typeof result === 'object' &&
      result !== null &&
      'data' in result
    ) {
      const dataObj = (result as { data?: { id?: unknown } | null }).data;
      if (
        typeof dataObj === 'object' &&
        dataObj !== null &&
        'id' in dataObj
      ) {
        messageId = (dataObj as { id: unknown }).id;
      }
    }
    if (
      messageId === undefined &&
      typeof result === 'object' &&
      result !== null &&
      'messageId' in result
    ) {
      messageId = (result as { messageId?: unknown }).messageId;
    }
    this.logger.log(
      JSON.stringify({
        event: 'email.raw.sent',
        subject: params.subject,
        messageId,
      }),
    );
    return result;
  }
}
