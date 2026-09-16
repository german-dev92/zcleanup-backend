import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { ContactMessageDto } from './dto/contact-message.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly emailService: EmailService) {}

  private escapeHtml(value: string | number | undefined | null): string {
    const s = value == null ? '' : String(value);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async sendContactMessage(dto: ContactMessageDto): Promise<void> {
    const submittedAt = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const internalSubject = `[CONTACT US] ${dto.subject} — ${dto.name}`;

    const rows: Array<[string, string]> = [
      ['Full Name', dto.name],
      ['Email', dto.email],
      ['Subject', dto.subject],
      ['Submitted At', submittedAt],
    ];

    const tableHtml = rows
      .map(
        ([k, v]) =>
          `<tr><td style="font-weight:600;padding:8px 12px;border-bottom:1px solid #eee;vertical-align:top;min-width:160px">${this.escapeHtml(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:pre-wrap">${this.escapeHtml(v)}</td></tr>`,
      )
      .join('');

    const internalHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:#222">
        <div style="background:#2c7fb8;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
          <h1 style="margin:0;font-size:22px">ZCLEANUP — Contact Us Message</h1>
          <p style="margin:6px 0 0;opacity:0.9;font-size:14px">${this.escapeHtml(dto.subject)} — ${this.escapeHtml(submittedAt)}</p>
        </div>
        <div style="border:1px solid #e5e5e5;border-top:0;border-radius:0 0 8px 8px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse">
            ${tableHtml}
          </table>
          <div style="padding:18px 24px;border-top:1px solid #eee">
            <h2 style="margin:0 0 10px;font-size:16px;color:#2c7fb8">Message</h2>
            <p style="margin:0;white-space:pre-wrap;line-height:1.55">${this.escapeHtml(dto.message)}</p>
          </div>
          <div style="padding:16px 24px;background:#fafafa;color:#555;font-size:12px;border-top:1px solid #eee">
            This email was sent from the ZCLEANUP Contact Us form. Reply directly to respond to the customer.
          </div>
        </div>
      </div>
    `;

    const internalText = [
      'ZCLEANUP — CONTACT US MESSAGE',
      '==============================',
      '',
      `Submitted: ${submittedAt}`,
      `Name: ${dto.name}`,
      `Email: ${dto.email}`,
      `Subject: ${dto.subject}`,
      '',
      'MESSAGE:',
      dto.message,
    ].join('\n');

    this.logger.log(
      JSON.stringify({
        event: 'contact.send_start',
        subject: dto.subject,
        nameLen: dto.name.length,
        messageLen: dto.message.length,
      }),
    );

    let internalMessageId: unknown = undefined;
    try {
      const internalResult = await this.emailService.sendRawEmail({
        subject: internalSubject,
        html: internalHtml,
        text: internalText,
        replyTo: dto.email,
      });
      internalMessageId =
        typeof internalResult === 'object' &&
        internalResult !== null &&
        'messageId' in internalResult
          ? (internalResult as { messageId?: unknown }).messageId
          : undefined;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'contact.internal_send_failed',
          subject: dto.subject,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new InternalServerErrorException(
        'Failed to send your message. Please try again later.',
      );
    }

    const customerSubject = '[ZCLEANUP] We received your message';
    const customerHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#222">
        <div style="background:#2c7fb8;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">Thank you for contacting ZCLEANUP</h2>
        </div>
        <div style="border:1px solid #e5e5e5;border-top:0;border-radius:0 0 8px 8px;padding:20px;line-height:1.55">
          <p style="margin:0 0 12px">Hi <strong>${this.escapeHtml(dto.name)}</strong>,</p>
          <p style="margin:0 0 12px">We received your message regarding <strong>${this.escapeHtml(dto.subject)}</strong>.</p>
          <p style="margin:0 0 12px">A member of our team will review your message and get back to you within 1–2 business days.</p>
          <p style="margin:0">If you have any additional questions, feel free to reply to this email.</p>
          <div style="margin-top:24px;padding-top:14px;border-top:1px solid #eee;color:#555;font-size:12px">
            — The ZCLEANUP Team
          </div>
        </div>
      </div>
    `;
    const customerText = [
      `Hi ${dto.name},`,
      '',
      `Thank you for contacting ZCLEANUP about: ${dto.subject}.`,
      '',
      'We received your message.',
      'Our team will review it and get back to you within 1–2 business days.',
      '',
      'If you have any additional questions, feel free to reply to this email.',
      '',
      '— The ZCLEANUP Team',
    ].join('\n');

    try {
      const customerResult = await this.emailService.sendRawEmail({
        to: dto.email,
        subject: customerSubject,
        html: customerHtml,
        text: customerText,
      });
      const customerMessageId =
        typeof customerResult === 'object' &&
        customerResult !== null &&
        'messageId' in customerResult
          ? (customerResult as { messageId?: unknown }).messageId
          : undefined;
      this.logger.log(
        JSON.stringify({
          event: 'contact.sent',
          internalMessageId,
          customerMessageId,
        }),
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'contact.customer_confirm_send_failed',
          internalMessageId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
