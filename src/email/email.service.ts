import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

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
  dynamicFields?: Record<string, unknown>;
};

@Injectable()
export class EmailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  private toSafeString(value: unknown): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'symbol') {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[Unserializable]';
      }
    }
    if (typeof value === 'function') {
      return '[Function]';
    }

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

  private sanitizeHeaderValue(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
  }

  private formatDynamicFields(df: unknown): string {
    if (!df || typeof df !== 'object') {
      return 'None';
    }

    const entries = Object.entries(df as Record<string, unknown>);
    if (entries.length === 0) {
      return 'None';
    }

    return entries
      .map(([key, value]) => {
        const label = this.toSafeString(key)
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase());

        const valueString = this.toSafeString(value);

        return `• <b>${this.escapeHtml(label)}:</b> ${this.escapeHtml(
          valueString,
        )}`;
      })
      .join('<br/>');
  }

  async sendBookingEmail(booking: BookingEmailPayload) {
    const name = this.escapeHtml(booking.name || 'N/A');
    const email = this.escapeHtml(booking.email || 'N/A');
    const phone = this.escapeHtml(booking.phone || 'N/A');
    const address = this.escapeHtml(booking.address || 'N/A');

    const cleaningTypeRaw = this.toSafeString(booking.cleaningType || 'N/A');
    const cleaningType = this.escapeHtml(cleaningTypeRaw);
    const desiredDate = this.escapeHtml(booking.desiredDate || 'N/A');
    const desiredTime = this.escapeHtml(booking.desiredTime || 'N/A');
    const frequency = this.escapeHtml(booking.frequency || 'one-time');

    const extras =
      Array.isArray(booking.extras) && booking.extras.length
        ? booking.extras.map((item) => this.escapeHtml(item)).join(', ')
        : 'None';

    await this.transporter.sendMail({
      from: `"ZCLEANUP SYSTEM" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: this.sanitizeHeaderValue(`🧼 New Booking - ${cleaningTypeRaw}`),

      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          
          <h2>🧼 New Booking Received</h2>

          <hr/>

          <h3>👤 Customer Info</h3>
          <p><b>Name:</b> ${name}</p>
          <p><b>Email:</b> ${email}</p>
          <p><b>Phone:</b> ${phone}</p>
          <p><b>Address:</b> ${address}</p>

          <hr/>

          <h3>🧹 Service Info</h3>
          <p><b>Service:</b> ${cleaningType}</p>
          <p><b>Date:</b> ${desiredDate}</p>
          <p><b>Time:</b> ${desiredTime}</p>
          <p><b>Frequency:</b> ${frequency}</p>

          <hr/>

          <h3>⚙️ Service Notes</h3>
          <p><b>Pets at Home:</b> ${booking.petsAtHome === true ? 'Yes' : 'No'}</p>
          <p><b>Use Own Products:</b> ${booking.useOwnProducts === true ? 'Yes' : 'No'}</p>
          <p><b>Discount Applied:</b> ${booking.applyFirstDiscount === true ? 'Yes' : 'No'}</p>

          <hr/>

          <h3>🧩 Extras</h3>
          <p>${extras}</p>

          <hr/>

          <h3>📦 Pricing</h3>
          <p><b>Estimated Price:</b> $${booking.estimatedPrice ?? 0}</p>
          <p><b>Final Price:</b> $${booking.finalPricePreview ?? 0}</p>

          <hr/>

          <h3>🔧 Service Details</h3>
          <p>${this.formatDynamicFields(booking.dynamicFields)}</p>

          <br/>
          <small>ZCLEANUP Automated System</small>
        </div>
      `,
    });
  }
}
