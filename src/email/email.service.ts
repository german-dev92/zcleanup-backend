import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  // 🧠 FORMATEADOR (NUEVO)
  private formatDynamicFields(df: any): string {
    if (!df || Object.keys(df).length === 0) {
      return 'None';
    }

    return Object.entries(df)
      .map(([key, value]) => {
        const label = key
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase());

        return `• <b>${label}:</b> ${value}`;
      })
      .join('<br/>');
  }

  async sendBookingEmail(booking: any) {
    await this.transporter.sendMail({
      from: `"ZCLEANUP SYSTEM" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `🧼 New Booking - ${booking.cleaningType}`,

      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          
          <h2>🧼 New Booking Received</h2>

          <hr/>

          <h3>👤 Customer Info</h3>
          <p><b>Name:</b> ${booking.name || 'N/A'}</p>
          <p><b>Email:</b> ${booking.email || 'N/A'}</p>
          <p><b>Phone:</b> ${booking.phone || 'N/A'}</p>
          <p><b>Address:</b> ${booking.address || 'N/A'}</p>

          <hr/>

          <h3>🧹 Service Info</h3>
          <p><b>Service:</b> ${booking.cleaningType || 'N/A'}</p>
          <p><b>Date:</b> ${booking.desiredDate || 'N/A'}</p>
          <p><b>Time:</b> ${booking.desiredTime || 'N/A'}</p>
          <p><b>Frequency:</b> ${booking.frequency || 'one-time'}</p>

          <hr/>

          <h3>⚙️ Service Notes</h3>
          <p><b>Pets at Home:</b> ${booking.petsAtHome ? 'Yes' : 'No'}</p>
          <p><b>Use Own Products:</b> ${booking.useOwnProducts ? 'Yes' : 'No'}</p>
          <p><b>Discount Applied:</b> ${booking.applyFirstDiscount ? 'Yes' : 'No'}</p>

          <hr/>

          <h3>🧩 Extras</h3>
          <p>${booking.extras?.length ? booking.extras.join(', ') : 'None'}</p>

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