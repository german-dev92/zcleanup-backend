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

      this.logger.log(`[EMAIL] Processing ${eventType} → ${booking.email}`);

      const contractAttachment = this.getContractAttachment(eventType);

      await this.emailService.sendBookingEventEmail({
        eventType,
        booking,
        contractAttachment,
      });

      this.logger.log(`[EMAIL] Sent successfully → ${eventType}`);
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
