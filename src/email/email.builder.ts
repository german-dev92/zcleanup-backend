import { Injectable } from '@nestjs/common';
import * as fs from 'fs';

import { buildBookingCancelledTemplate } from './templates/booking-cancelled.template';
import { buildBookingConfirmedTemplate } from './templates/booking-confirmed.template';
import { buildBookingCreatedTemplate } from './templates/booking-created.template';

export type BookingEventType =
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.cancelled';

export type BookingEmailPayload = {
  bookingId?: string;
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
  display?: unknown;
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
  propertyRows: Array<{ label: string; value: string }>;
  extrasList: string[];
  customerNotes: string;
  specialConditions: string[];
  pricingRows: Array<{ label: string; value: string; isTotal?: boolean }>;
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
  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

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
    const display = this.isRecord(booking.display) ? booking.display : null;

    const displayService =
      display && this.isRecord(display.service) ? display.service : null;

    const serviceLabelRaw =
      (displayService && typeof displayService.label === 'string'
        ? displayService.label
        : booking.cleaningType) || 'General Cleaning';
    const cleaningType = this.escapeHtml(serviceLabelRaw);

    const paymentUrl = this.escapeHtml(this.sanitizeUrl(booking.paymentUrl));
    const trackingUrl = this.escapeHtml(this.sanitizeUrl(booking.trackingUrl));

    const schedule =
      display && this.isRecord(display.schedule) ? display.schedule : null;
    const displayFrequency =
      schedule && this.isRecord(schedule.frequency) ? schedule.frequency : null;
    const frequencyRaw =
      displayFrequency && typeof displayFrequency.label === 'string'
        ? displayFrequency.label
        : booking.frequency || 'One-time';

    const propertyRows = this.buildPropertyRows(booking, display);
    const extrasList = this.buildExtrasList(booking, display);
    const customerNotes = this.buildCustomerNotes(booking, display);
    const specialConditions = this.buildSpecialConditions(booking, display);
    const pricingRows = this.buildPricingRows(booking, display);

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
      frequency: this.escapeHtml(frequencyRaw),
      propertyRows,
      extrasList,
      customerNotes,
      specialConditions,
      pricingRows,
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

  private buildPropertyRows(
    booking: BookingEmailPayload,
    display: Record<string, unknown> | null,
  ): Array<{ label: string; value: string }> {
    const rows: Array<{ label: string; value: string }> = [];

    const property =
      display && this.isRecord(display.property) ? display.property : null;

    const details =
      property && Array.isArray(property.details)
        ? (property.details as unknown[])
        : null;

    if (details) {
      for (const row of details) {
        const safe = this.isRecord(row) ? row : null;
        const label = safe && typeof safe.label === 'string' ? safe.label : '';
        const value = safe && typeof safe.value === 'string' ? safe.value : '';
        if (!label || !value) continue;
        rows.push({
          label: this.escapeHtml(label),
          value: this.escapeHtml(value),
        });
      }
    }

    if (rows.length) {
      return rows;
    }

    const dyn =
      booking.dynamicFields && typeof booking.dynamicFields === 'object'
        ? booking.dynamicFields
        : {};

    const bedrooms =
      typeof dyn['bedrooms'] === 'number' ? dyn['bedrooms'] : null;
    const bathrooms =
      typeof dyn['bathrooms'] === 'number' ? dyn['bathrooms'] : null;
    const additionalBedrooms =
      typeof dyn['additionalBedrooms'] === 'number'
        ? dyn['additionalBedrooms']
        : null;

    if (bedrooms != null)
      rows.push({
        label: 'Bedrooms',
        value: this.escapeHtml(String(bedrooms)),
      });
    if (bathrooms != null)
      rows.push({
        label: 'Bathrooms',
        value: this.escapeHtml(String(bathrooms)),
      });
    if (additionalBedrooms != null)
      rows.push({
        label: 'Additional Bedrooms',
        value: this.escapeHtml(String(additionalBedrooms)),
      });

    return rows;
  }

  private buildExtrasList(
    booking: BookingEmailPayload,
    display: Record<string, unknown> | null,
  ): string[] {
    const extras =
      display && this.isRecord(display.extras) ? display.extras : null;

    const items =
      extras && Array.isArray(extras.items)
        ? (extras.items as unknown[])
        : null;

    if (items) {
      const list = items
        .map((item) => {
          const safe = this.isRecord(item) ? item : null;
          const label =
            safe && typeof safe.label === 'string' ? safe.label : '';
          const qty =
            safe && typeof safe.quantity === 'number' ? safe.quantity : null;
          if (!label) return '';
          if (qty && qty > 1) return `${label} × ${qty}`;
          return label;
        })
        .filter(Boolean);
      if (list.length) return list.map((x) => this.escapeHtml(x));
    }

    const raw = Array.isArray(booking.extras) ? booking.extras : [];
    if (raw.length === 0) return [];
    return raw
      .map((item) => this.escapeHtml(item))
      .filter((x) => typeof x === 'string' && x.trim().length > 0);
  }

  private buildSpecialConditions(
    booking: BookingEmailPayload,
    display: Record<string, unknown> | null,
  ): string[] {
    const conditions =
      display &&
      'specialConditions' in display &&
      Array.isArray(display.specialConditions)
        ? (display.specialConditions as unknown[])
        : null;

    if (conditions) {
      return conditions
        .map((x) => (typeof x === 'string' ? x : ''))
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => this.escapeHtml(x));
    }

    const list: string[] = [];
    if (booking.petsAtHome === true) list.push('Pets at home');
    if (booking.useOwnProducts === true)
      list.push('Use customer-provided products');
    return list.map((x) => this.escapeHtml(x));
  }

  private buildCustomerNotes(
    booking: BookingEmailPayload,
    display: Record<string, unknown> | null,
  ): string {
    const notesFromDisplay =
      display && typeof display.notes === 'string' ? display.notes.trim() : '';
    if (notesFromDisplay) return this.escapeHtml(notesFromDisplay);

    const dyn =
      booking.dynamicFields && typeof booking.dynamicFields === 'object'
        ? booking.dynamicFields
        : {};

    const candidates = [
      dyn['notes'],
      dyn['customerNotes'],
      dyn['specialInstructions'],
      dyn['instructions'],
      dyn['comments'],
      dyn['comment'],
    ];

    for (const value of candidates) {
      if (typeof value !== 'string') continue;
      const cleaned = value.trim();
      if (!cleaned) continue;
      return this.escapeHtml(cleaned);
    }

    return '';
  }

  private buildPricingRows(
    booking: BookingEmailPayload,
    display: Record<string, unknown> | null,
  ): Array<{ label: string; value: string; isTotal?: boolean }> {
    const pricing =
      display && this.isRecord(display.pricing) ? display.pricing : null;

    const items =
      pricing && Array.isArray(pricing.items)
        ? (pricing.items as unknown[])
        : null;

    const currency = 'USD';

    const formatMoney = (amount: unknown): string => {
      const num =
        typeof amount === 'number'
          ? amount
          : typeof amount === 'string'
            ? Number(amount)
            : NaN;
      if (!Number.isFinite(num)) return this.escapeHtml('-');
      return this.escapeHtml(this.formatMoney(num, currency));
    };

    const rows: Array<{ label: string; value: string; isTotal?: boolean }> = [];

    if (items) {
      for (const item of items) {
        const safe = this.isRecord(item) ? item : null;
        const label = safe && typeof safe.label === 'string' ? safe.label : '';
        const amount = safe ? safe.amount : undefined;
        if (!label) continue;
        rows.push({
          label: this.escapeHtml(label),
          value: formatMoney(amount),
        });
      }
    }

    const total =
      pricing && typeof pricing.total === 'number'
        ? pricing.total
        : booking.finalPricePreview;

    rows.push({
      label: this.escapeHtml('Total'),
      value: formatMoney(total),
      isTotal: true,
    });

    return rows;
  }

  private formatMoney(amount: number, currency: string): string {
    void currency;
    const safe = Number.isFinite(amount) ? amount : 0;
    const sign = safe < 0 ? '-' : '';
    const abs = Math.abs(safe);
    return `${sign}$${abs.toFixed(2)}`;
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
