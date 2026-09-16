import { Injectable } from '@nestjs/common';
import * as fs from 'fs';

import { buildBookingCancelledTemplate } from './templates/booking-cancelled.template';
import { buildBookingConfirmedTemplate } from './templates/booking-confirmed.template';
import { buildBookingCreatedTemplate } from './templates/booking-created.template';
import { buildBookingQuoteFlowTemplate } from './templates/booking-quote-flow.template';

export type BookingEventType =
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.cancelled'
  | 'booking.quote_requested'
  | 'booking.quote_sent'
  | 'booking.quote_accepted'
  | 'booking.quote_rejected'
  | 'booking.invoice_ready'
  | 'booking.payment_received';

export type BookingQuotePayload = {
  version?: number;
  status?: string;
  baseCalculatedPrice?: number;
  finalQuotedPrice?: number;
  manualAdjustments?: Array<{
    type?: string;
    label?: string;
    amount?: number;
    reason?: string;
  }>;
  reviewedBy?: string;
  reviewedAt?: string | Date;
  sentAt?: string | Date;
  acceptedAt?: string | Date;
  rejectedAt?: string | Date;
  expiresAt?: string | Date;
  customerMessage?: string;
  internalNotes?: string;
};

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
  petSafetyNotes?: string | null;
  useOwnProducts?: boolean;
  usesOwnCleaningProducts?: boolean;
  cleaningProductNotes?: string | null;
  applyFirstDiscount?: boolean;
  firstServiceDiscountRequested?: boolean;
  extras?: unknown[];
  estimatedPrice?: number;
  finalPricePreview?: number;
  paymentUrl?: string;
  trackingUrl?: string;
  dynamicFields?: Record<string, unknown>;
  status?: string;
  commercialStatus?: string;
  paymentLifecycleStatus?: string;
  quote?: BookingQuotePayload;
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
      case 'booking.quote_requested':
      case 'booking.quote_accepted':
        // 📩 empresa recibe nuevo booking
        return process.env.EMAIL_USER!;

      case 'booking.confirmed':
      case 'booking.cancelled':
      case 'booking.quote_sent':
      case 'booking.quote_rejected':
      case 'booking.invoice_ready':
      case 'booking.payment_received':
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
      case 'booking.quote_requested':
      case 'booking.quote_sent':
      case 'booking.quote_accepted':
      case 'booking.quote_rejected':
      case 'booking.invoice_ready':
      case 'booking.payment_received':
        return buildBookingQuoteFlowTemplate(viewModel);
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
    if (eventType === 'booking.quote_requested') {
      return `New quote request received - ${cleaningType}`;
    }
    if (eventType === 'booking.quote_sent') {
      return `Your quote is ready - ${cleaningType}`;
    }
    if (eventType === 'booking.quote_accepted') {
      return `Quote accepted - ${cleaningType}`;
    }
    if (eventType === 'booking.quote_rejected') {
      return `Quote update - ${cleaningType}`;
    }
    if (eventType === 'booking.invoice_ready') {
      return `Invoice ready - ${cleaningType}`;
    }
    if (eventType === 'booking.payment_received') {
      return `Payment received - ${cleaningType}`;
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

    if (eventType === 'booking.quote_requested') {
      return {
        heading: 'New Quote Request Received',
        preheader:
          'A customer submitted a new quote request for manual review.',
        statusLabel: 'QUOTE REQUESTED',
        statusColor: '#92400e',
        statusBackground: '#fef3c7',
        ctaLabel: 'Review Request',
        ctaUrl: trackingUrl,
        ...base,
      };
    }

    if (eventType === 'booking.quote_sent') {
      return {
        heading: 'Your Quote Is Ready',
        preheader:
          'We prepared your quote. Please review the pricing and next steps.',
        statusLabel: 'QUOTE SENT',
        statusColor: '#1d4ed8',
        statusBackground: '#dbeafe',
        ctaLabel: trackingUrl ? 'Review Quote' : '',
        ctaUrl: trackingUrl,
        ...base,
      };
    }

    if (eventType === 'booking.quote_accepted') {
      return {
        heading: 'Quote Accepted',
        preheader:
          'The quote was accepted and the booking can move to the invoicing stage.',
        statusLabel: 'QUOTE ACCEPTED',
        statusColor: '#166534',
        statusBackground: '#dcfce7',
        ctaLabel: trackingUrl ? 'View Booking' : '',
        ctaUrl: trackingUrl,
        ...base,
      };
    }

    if (eventType === 'booking.quote_rejected') {
      return {
        heading: 'Quote Update',
        preheader:
          'Your quote request has been closed or rejected. Contact us if you need a revised proposal.',
        statusLabel: 'QUOTE REJECTED',
        statusColor: '#991b1b',
        statusBackground: '#fee2e2',
        ctaLabel: trackingUrl ? 'View Details' : '',
        ctaUrl: trackingUrl,
        ...base,
      };
    }

    if (eventType === 'booking.invoice_ready') {
      return {
        heading: 'Your Invoice Is Ready',
        preheader:
          'Your quote has been approved and your invoice is ready for payment.',
        statusLabel: 'INVOICE READY',
        statusColor: '#7c3aed',
        statusBackground: '#ede9fe',
        ctaLabel: paymentUrl ? 'Complete Payment' : '',
        ctaUrl: paymentUrl,
        ...base,
      };
    }

    if (eventType === 'booking.payment_received') {
      return {
        heading: 'Payment Received',
        preheader:
          'We received your payment successfully. Your booking is now ready for the next operational steps.',
        statusLabel: 'PAID',
        statusColor: '#166534',
        statusBackground: '#dcfce7',
        ctaLabel: trackingUrl ? 'Track Booking' : '',
        ctaUrl: trackingUrl,
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
    const conditionsRaw =
      display &&
      'specialConditions' in display &&
      Array.isArray(display.specialConditions)
        ? [...(display.specialConditions as unknown[])]
        : null;

    const list: string[] = [];
    if (booking.petsAtHome === true) list.push('Pets at home');
    if (booking.useOwnProducts === true || (booking as any).usesOwnCleaningProducts === true)
      list.push('Use customer-provided products');

    const quote = this.isRecord(booking.quote) ? booking.quote : null;
    const quoteType =
      quote && typeof (quote as any).discountType === 'string'
        ? String((quote as any).discountType).trim()
        : '';
    const appliedViaLegacy = (booking as any).discountApplied === true;
    const appliedViaQuote =
      quoteType === 'first_time_customer' ||
      quoteType === 'regular_client' ||
      quoteType === 'loyalty_customer';

    if (appliedViaLegacy || appliedViaQuote) {
      const alreadyInDisplay =
        Array.isArray(conditionsRaw) &&
        conditionsRaw.some(
          (it) => typeof it === 'string' && it.trim() === 'First-Service Discount Applied',
        );
      if (!alreadyInDisplay) list.push('First-Service Discount Applied');
    } else if (
      (booking as any).firstServiceDiscountRequested === true ||
      booking.applyFirstDiscount === true
    ) {
      const alreadyInDisplay =
        Array.isArray(conditionsRaw) &&
        conditionsRaw.some(
          (it) =>
            typeof it === 'string' &&
            (it.trim() === 'First-Service Discount Requested' ||
              it.trim() === 'First-Service Discount Applied'),
        );
      if (!alreadyInDisplay) list.push('First-Service Discount Requested');
    }

    const conditions = conditionsRaw ?? [];
    // De-dup identical string conditions between the display-supplied list and the list we built (and preserve
    // display's existing order first — our new items are appended after, with duplicate strings skipped).
    const dedupedStrings: string[] = [];
    const seen: Set<string> = new Set();
    for (const raw of conditions) {
      const str = typeof raw === 'string' ? raw.trim() : '';
      if (!str) continue;
      const esc = this.escapeHtml(str);
      if (seen.has(esc)) continue;
      seen.add(esc);
      dedupedStrings.push(esc);
    }
    for (const it of list) {
      const esc = typeof it === 'string' ? this.escapeHtml(it.trim()) : '';
      if (!esc || seen.has(esc)) continue;
      // If display already contains the sibling (Requested vs Applied) strip it to avoid showing
      // an outdated "Requested" when the approved state now is "Applied".
      if (esc === this.escapeHtml('First-Service Discount Applied')) {
        const req = this.escapeHtml('First-Service Discount Requested');
        if (seen.has(req)) {
          const idx = dedupedStrings.indexOf(req);
          if (idx >= 0) dedupedStrings.splice(idx, 1);
          seen.delete(req);
        }
      }
      seen.add(esc);
      dedupedStrings.push(esc);
    }
    return dedupedStrings;
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
    const seenComponents: Array<{ label: string; amount: number }> = [];
    let componentsSum = 0;

    if (items) {
      for (const item of items) {
        const safe = this.isRecord(item) ? item : null;
        const label = safe && typeof safe.label === 'string' ? safe.label : '';
        const amountRaw = safe ? safe.amount : undefined;
        const amountNum =
          typeof amountRaw === 'number'
            ? amountRaw
            : typeof amountRaw === 'string'
              ? Number(amountRaw)
              : NaN;
        if (!label || !Number.isFinite(amountNum)) continue;
        // Never render a legacy "X package" row that includes additional bedrooms;
        // we rely on separate rows from buildDisplayPricing.
        const lowered = label.toLowerCase();
        if (
          lowered.includes('package') &&
          lowered.includes('add. bedroom')
        ) {
          continue;
        }
        if (amountNum === 0) continue;
        seenComponents.push({ label, amount: amountNum });
        componentsSum = this.roundMoney(componentsSum + amountNum);
      }
    }

    for (const row of seenComponents) {
      rows.push({
        label: this.escapeHtml(row.label),
        value: formatMoney(row.amount),
      });
    }

    const quote = this.isRecord(booking.quote) ? booking.quote : null;
    const quoteDiscountType =
      quote && typeof (quote as any).discountType === 'string'
        ? String((quote as any).discountType).trim()
        : '';
    const quoteDiscountAmountNum =
      quote && typeof (quote as any).discountAmount !== 'undefined' && (quote as any).discountAmount !== null
        ? Number((quote as any).discountAmount)
        : NaN;
    const isQuoteApprovedDiscount =
      quoteDiscountType.length > 0 &&
      quoteDiscountType !== 'none' &&
      Number.isFinite(quoteDiscountAmountNum) &&
      quoteDiscountAmountNum > 0;

    let finalQuotedTotal: number | null = null;
    if (quote && typeof quote.finalQuotedPrice !== 'undefined' && quote.finalQuotedPrice !== null) {
      const fq = Number(quote.finalQuotedPrice);
      if (Number.isFinite(fq)) finalQuotedTotal = fq;
    }

    // NOTE: do NOT independently push a second "Discount (XX%)" row from quote metadata.
    // buildDisplayPricing() is the single source of truth for pricing rows including the
    // applied-discount row. If it emitted a Discount row, we trust it. If not, we still
    // avoid duplicating here � the TOTAL resolution below prefers quote.finalQuotedPrice,
    // so the final total will still be correct for legacy/corner cases.

    // --------- TOTAL resolution (authoritative, no duplicate calc) ---------
    let total: number | null = null;
    if (isQuoteApprovedDiscount && finalQuotedTotal != null) {
      total = finalQuotedTotal;
    } else if (pricing && typeof pricing.total === 'number' && Number.isFinite(pricing.total)) {
      total = pricing.total;
    } else if (quote && typeof quote.finalQuotedPrice === 'number' && Number.isFinite(quote.finalQuotedPrice)) {
      // Legacy fallback, but NEVER trust a legacy final $20 if NEW components sum exists and is > 0.
      if (seenComponents.length === 0 || Math.abs(quote.finalQuotedPrice - componentsSum) < 0.5) {
        total = quote.finalQuotedPrice;
      }
    } else if (typeof booking.finalPricePreview === 'number' && Number.isFinite(booking.finalPricePreview)) {
      total = booking.finalPricePreview;
    }
    if (total == null || !Number.isFinite(total)) {
      total = seenComponents.length ? componentsSum : null;
    }
    if (total == null && typeof booking.estimatedPrice === 'number' && Number.isFinite(booking.estimatedPrice)) {
      total = booking.estimatedPrice;
    }

    rows.push({
      label: this.escapeHtml('Estimated Total'),
      value: formatMoney(total),
      isTotal: true,
    });

    return rows;
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
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
