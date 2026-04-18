import { Injectable } from '@nestjs/common';
import * as fs from 'fs';

import { buildBookingCancelledTemplate } from './templates/booking-cancelled.template.js';
import { buildBookingConfirmedTemplate } from './templates/booking-confirmed.template.js';
import { buildBookingCreatedTemplate } from './templates/booking-created.template.js';

export type BookingEventType =
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.cancelled';

export type BookingEmailPayload = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  cleaningType?: string;
  desiredDate?: string;
  desiredTime?: string;
  frequency?: string;
  petsAtHome?: boolean;
  useOwnProducts?: boolean;
  applyFirstDiscount?: boolean;
  extras?: unknown[];
  estimatedPrice?: number;
  finalPricePreview?: number;
  paymentUrl?: string;
  trackingUrl?: string;
  dynamicFields?: Record<string, unknown>;
  status?: string;
};

export type EmailAttachment = {
  filename: string;
  path?: string;
  content?: Buffer;
  contentType?: string;
};

export type ContractAttachmentOption = {
  enabled: boolean;
  filePath?: string;
};

export type BookingEmailTemplateViewModel = {
  heading: string;
  preheader: string;
  statusLabel: string;
  statusColor: string;
  statusBackground: string;
  ctaLabel: string;
  ctaUrl: string;
  paymentUrl: string;
  trackingUrl: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  cleaningType: string;
  desiredDate: string;
  desiredTime: string;
  frequency: string;
  extras: string;
  estimatedPrice: string;
  finalPrice: string;
};

export type BuildBookingEmailParams = {
  eventType: BookingEventType;
  booking: BookingEmailPayload;
  attachments?: EmailAttachment[];
  contractAttachment?: ContractAttachmentOption;
};

export type BuiltEmail = {
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  to: string;
};

@Injectable()
export class EmailBuilder {
  buildBookingEmail(params: BuildBookingEmailParams): BuiltEmail {
    const viewModel = this.toViewModel(params.booking, params.eventType);

    const subject = this.buildSubject(params.eventType, viewModel.cleaningType);
    const html = this.buildHtml(params.eventType, viewModel);
    const attachments = this.buildAttachments(params);

    const to = this.resolveRecipient(params);

    return {
      subject: this.sanitizeHeaderValue(subject),
      html,
      attachments,
      to,
    };
  }

  // 🎯 DESTINATARIO CORRECTO (CRÍTICO)
  private resolveRecipient(params: BuildBookingEmailParams): string {
    const customerEmail = params.booking.email || process.env.EMAIL_USER!;

    switch (params.eventType) {
      case 'booking.created':
        // 📩 empresa recibe nuevo booking
        return process.env.EMAIL_USER!;

      case 'booking.confirmed':
      case 'booking.cancelled':
        // 📩 cliente recibe updates
        return customerEmail;

      default:
        return process.env.EMAIL_USER!;
    }
  }

  private buildHtml(
    eventType: BookingEventType,
    viewModel: BookingEmailTemplateViewModel,
  ): string {
    switch (eventType) {
      case 'booking.confirmed':
        return buildBookingConfirmedTemplate(viewModel);
      case 'booking.cancelled':
        return buildBookingCancelledTemplate(viewModel);
      case 'booking.created':
      default:
        return buildBookingCreatedTemplate(viewModel);
    }
  }

  private buildSubject(
    eventType: BookingEventType,
    cleaningType: string,
  ): string {
    if (eventType === 'booking.confirmed') {
      return `Booking confirmed - ${cleaningType}`;
    }
    if (eventType === 'booking.cancelled') {
      return `Booking cancelled - ${cleaningType}`;
    }
    return `New booking received - ${cleaningType}`;
  }

  private buildAttachments(
    params: BuildBookingEmailParams,
  ): EmailAttachment[] | undefined {
    const attachments: EmailAttachment[] = [...(params.attachments ?? [])];

    // 📎 SOLO SI EXISTE Y ES SEGURO
    if (
      params.eventType === 'booking.confirmed' &&
      params.contractAttachment?.enabled &&
      params.contractAttachment.filePath &&
      fs.existsSync(params.contractAttachment.filePath)
    ) {
      attachments.push({
        filename: 'booking-contract.pdf',
        path: params.contractAttachment.filePath,
        contentType: 'application/pdf',
      });
    }

    return attachments.length > 0 ? attachments : undefined;
  }

  private toViewModel(
    booking: BookingEmailPayload,
    eventType: BookingEventType,
  ): BookingEmailTemplateViewModel {
    const cleaningType = this.escapeHtml(
      booking.cleaningType || 'General Cleaning',
    );

    const paymentUrl = this.escapeHtml(this.sanitizeUrl(booking.paymentUrl));
    const trackingUrl = this.escapeHtml(this.sanitizeUrl(booking.trackingUrl));

    const base = {
      paymentUrl,
      trackingUrl,
      customerName: this.escapeHtml(booking.name || 'Customer'),
      customerEmail: this.escapeHtml(booking.email || 'N/A'),
      customerPhone: this.escapeHtml(booking.phone || 'N/A'),
      address: this.escapeHtml(booking.address || 'N/A'),
      cleaningType,
      desiredDate: this.escapeHtml(booking.desiredDate || 'N/A'),
      desiredTime: this.escapeHtml(booking.desiredTime || 'N/A'),
      frequency: this.escapeHtml(booking.frequency || 'One-time'),
      extras: this.formatExtras(booking.extras),
      estimatedPrice: this.escapeHtml(booking.estimatedPrice ?? 0),
      finalPrice: this.escapeHtml(booking.finalPricePreview ?? 0),
    };

    if (eventType === 'booking.confirmed') {
      return {
        heading: 'Your Booking Is Confirmed',
        preheader: 'Great news, your service has been confirmed.',
        statusLabel: 'CONFIRMED',
        statusColor: '#166534',
        statusBackground: '#dcfce7',
        ctaLabel: 'Manage Booking',
        ctaUrl: '#',
        ...base,
      };
    }

    if (eventType === 'booking.cancelled') {
      return {
        heading: 'Booking Cancelled',
        preheader: 'Your booking has been marked as cancelled.',
        statusLabel: 'CANCELLED',
        statusColor: '#991b1b',
        statusBackground: '#fee2e2',
        ctaLabel: 'View Booking',
        ctaUrl: '#',
        ...base,
      };
    }

    return {
      heading: 'New Booking Received',
      preheader: 'A new booking has been submitted successfully.',
      statusLabel: 'PENDING',
      statusColor: '#92400e',
      statusBackground: '#fef3c7',
      ctaLabel: 'View Booking',
      ctaUrl: '#',
      ...base,
    };
  }

  private formatExtras(extras: unknown[] | undefined): string {
    if (!Array.isArray(extras) || extras.length === 0) {
      return 'None';
    }

    return extras.map((item) => this.escapeHtml(item)).join(', ');
  }

  private toSafeString(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return '[Unknown]';
  }

  private escapeHtml(value: unknown): string {
    const str = this.toSafeString(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private sanitizeUrl(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return '';
      }
      return url.toString();
    } catch {
      return '';
    }
  }

  private sanitizeHeaderValue(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
  }
}
