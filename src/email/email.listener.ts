import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService, type BookingEmailPayload } from './email.service';

@Injectable()
export class EmailListener {
  private readonly logger = new Logger(EmailListener.name);

  constructor(private emailService: EmailService) {}

  @OnEvent('booking.created')
  handleBookingCreatedEvent(payload: unknown) {
    setImmediate(() => {
      this.emailService
        .sendBookingEmail(payload as BookingEmailPayload)
        .catch((error) => {
          const maskedEmail = this.maskEmail(
            (payload as { email?: unknown })?.email,
          );
          const message = maskedEmail
            ? `Email event failed (email=${maskedEmail})`
            : 'Email event failed';

          this.logger.error(
            message,
            error instanceof Error ? error.stack : undefined,
          );
        });
    });
  }

  private maskEmail(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const email = value.trim();
    const atIndex = email.indexOf('@');
    if (atIndex <= 0 || atIndex === email.length - 1) {
      return null;
    }

    const local = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);

    const visibleLocal = local.slice(0, 2);
    return `${visibleLocal}***@${domain}`;
  }
}
