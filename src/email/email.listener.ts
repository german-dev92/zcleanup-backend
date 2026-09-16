import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from './email.service';

import { BookingEmailPayload, BookingEventType } from './email.builder';

@Injectable()
export class EmailListener {
  private readonly logger = new Logger(EmailListener.name);

  constructor(private readonly emailService: EmailService) {}

  // -------------------------
  // EVENTS
  // -------------------------

  @OnEvent('booking.created')
  async onBookingCreated(payload: unknown) {
    await this.handleEvent('booking.created', payload);
  }

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(payload: unknown) {
    await this.handleEvent('booking.confirmed', payload);
  }

  @OnEvent('booking.cancelled')
  async onBookingCancelled(payload: unknown) {
    await this.handleEvent('booking.cancelled', payload);
  }

  @OnEvent('booking.quote_requested')
  async onBookingQuoteRequested(payload: unknown) {
    await this.handleEvent('booking.quote_requested', payload);
  }

  @OnEvent('booking.payment_received')
  async onBookingPaymentReceived(payload: unknown) {
    await this.handleEvent('booking.payment_received', payload);
  }

  // -------------------------
  // INTERNAL EVENTS (NO EMAIL — per workflow: only Confirm Booking emails customer)
  //
  // The following are internal audit/commercial lifecycle events only. They
  // intentionally do NOT send a customer-visible transactional email because
  // the business workflow specifies:
  //   - Booking submission              → 1 booking-received email
  //   - Discount / quote changes        → NO customer email
  //   - Quote sent/revised/rejected etc → NO customer email
  //   - Confirm Booking                 → 1 official invoice/payment email
  //   - Payment completion              → existing payment confirmation flow
  // -------------------------
  @OnEvent('booking.quote_sent')
  onBookingQuoteSentInternalOnly(payload: unknown): void {
    const booking = (payload ?? {}) as Record<string, unknown>;
    const bookingId =
      typeof (booking as { bookingId?: unknown }).bookingId === 'string'
        ? String((booking as { bookingId: string }).bookingId)
        : 'unknown';
    this.logger.log(
      `[LIFECYCLE] booking.quote_sent (internal, no email) → ${bookingId}`,
    );
  }

  @OnEvent('booking.quote_accepted')
  onBookingQuoteAcceptedInternalOnly(payload: unknown): void {
    const booking = (payload ?? {}) as Record<string, unknown>;
    const bookingId =
      typeof (booking as { bookingId?: unknown }).bookingId === 'string'
        ? String((booking as { bookingId: string }).bookingId)
        : 'unknown';
    this.logger.log(
      `[LIFECYCLE] booking.quote_accepted (internal, no email) → ${bookingId}`,
    );
  }

  @OnEvent('booking.quote_rejected')
  onBookingQuoteRejectedInternalOnly(payload: unknown): void {
    const booking = (payload ?? {}) as Record<string, unknown>;
    const bookingId =
      typeof (booking as { bookingId?: unknown }).bookingId === 'string'
        ? String((booking as { bookingId: string }).bookingId)
        : 'unknown';
    this.logger.log(
      `[LIFECYCLE] booking.quote_rejected (internal, no email) → ${bookingId}`,
    );
  }

  @OnEvent('booking.invoice_ready')
  onBookingInvoiceReadyInternalOnly(payload: unknown): void {
    const booking = (payload ?? {}) as Record<string, unknown>;
    const bookingId =
      typeof (booking as { bookingId?: unknown }).bookingId === 'string'
        ? String((booking as { bookingId: string }).bookingId)
        : 'unknown';
    this.logger.log(
      `[LIFECYCLE] booking.invoice_ready (internal, no email) → ${bookingId}`,
    );
  }

  // -------------------------
  // CORE HANDLER
  // -------------------------

  private async handleEvent(eventType: BookingEventType, payload: unknown) {
    try {
      const booking = payload as BookingEmailPayload;

      if (!booking || !booking.email) {
        this.logger.error(
          `[EMAIL] Missing or invalid payload for ${eventType}`,
        );
        return;
      }

      const bookingId =
        typeof (booking as { bookingId?: unknown }).bookingId === 'string'
          ? String((booking as { bookingId?: unknown }).bookingId)
          : 'unknown';
      this.logger.log(`[EMAIL] Processing ${eventType} → ${bookingId}`);

      const contractAttachment = this.getContractAttachment(eventType);

      await this.emailService.sendBookingEventEmail({
        eventType,
        booking,
        contractAttachment,
      });

      this.logger.log(
        `[EMAIL] Sent successfully → ${eventType} → ${bookingId}`,
      );
    } catch (error) {
      this.logger.error(
        `[EMAIL] Failed event ${eventType}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // -------------------------
  // CONTRACT SAFE LOGIC
  // -------------------------

  private getContractAttachment(eventType: BookingEventType) {
    if (eventType !== 'booking.confirmed') {
      return { enabled: false };
    }

    const filePath = process.env.CONTRACT_PATH;

    if (!filePath) {
      this.logger.warn(
        '[EMAIL] CONTRACT_PATH not defined → sending without contract',
      );
      return { enabled: false };
    }

    return {
      enabled: true,
      filePath,
    };
  }
}
