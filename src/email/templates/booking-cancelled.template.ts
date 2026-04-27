import { type BookingEmailTemplateViewModel } from '../email.builder';

export function buildBookingCancelledTemplate(
  model: BookingEmailTemplateViewModel,
): string {
  const supportEmail = process.env.EMAIL_USER ?? 'support@zcleanup.com';
  const logoUrl =
    'https://res.cloudinary.com/dbjmebbfw/image/upload/q_auto/f_auto/v1776476300/ZcleanUP_qc0dn3.png';

  const paymentButton = model.paymentUrl
    ? `
      <tr>
        <td align="center" style="padding: 12px 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="#3498db" style="border-radius: 6px;">
                <a href="${model.paymentUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 6px;">
                  Complete Payment
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
    : '';

  const trackingButton = model.trackingUrl
    ? `
      <tr>
        <td align="center" style="padding: 12px 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="#3498db" style="border-radius: 6px;">
                <a href="${model.trackingUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 6px;">
                  Track Booking
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
    : '';

  const actionSection =
    paymentButton || trackingButton
      ? `
        <tr>
          <td style="padding: 0 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #e5e7eb;">
              <tr>
                <td style="padding: 16px 0 22px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${paymentButton}
                    ${trackingButton}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
      : '';

  const buildKeyValueRows = (rows: Array<{ label: string; value: string }>) =>
    rows
      .map(
        (row) => `
          <tr>
            <td width="40%" style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #6b7280;">${row.label}</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111827; font-weight: 700;">${row.value}</td>
          </tr>
        `,
      )
      .join('');

  const bookingSummaryRows = buildKeyValueRows([
    { label: 'Customer', value: model.customerName },
    { label: 'Email', value: model.customerEmail },
    { label: 'Phone', value: model.customerPhone },
    { label: 'Address', value: model.address },
    { label: 'Service', value: model.cleaningType },
    { label: 'Date', value: model.desiredDate },
    { label: 'Time', value: model.desiredTime },
    { label: 'Frequency', value: model.frequency },
  ]);

  const propertyRows = model.propertyRows?.length
    ? buildKeyValueRows(model.propertyRows)
    : buildKeyValueRows([{ label: 'Property', value: 'N/A' }]);

  const extrasList = Array.isArray(model.extrasList) ? model.extrasList : [];
  const extrasHtml =
    extrasList.length > 0
      ? `<ul style="margin: 8px 0 0; padding: 0 0 0 18px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111827;">
          ${extrasList.map((x) => `<li style="margin: 4px 0;">${x}</li>`).join('')}
        </ul>`
      : `<div style="margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #6b7280;">None</div>`;

  const conditionsList = Array.isArray(model.specialConditions)
    ? model.specialConditions
    : [];
  const conditionsHtml =
    conditionsList.length > 0
      ? `<ul style="margin: 8px 0 0; padding: 0 0 0 18px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111827;">
          ${conditionsList.map((x) => `<li style="margin: 4px 0;">${x}</li>`).join('')}
        </ul>`
      : `<div style="margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #6b7280;">None</div>`;

  const notesText =
    typeof model.customerNotes === 'string' ? model.customerNotes : '';
  const customerNotesHtml =
    notesText.trim().length > 0
      ? `<div style="margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111827; white-space: pre-wrap; line-height: 1.5;">${notesText}</div>`
      : `<div style="margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #6b7280;">None</div>`;

  const pricingRows = Array.isArray(model.pricingRows) ? model.pricingRows : [];
  const pricingRowsHtml =
    pricingRows.length > 0
      ? pricingRows
          .map((row) => {
            const border = row.isTotal ? '0' : '1px solid #eef2f7';
            const color = row.isTotal ? '#111827' : '#334155';
            const weight = row.isTotal ? '900' : '700';
            const size = row.isTotal ? '16px' : '13px';
            const padTop = row.isTotal ? '12px' : '10px';
            return `
              <tr>
                <td style="padding: ${padTop} 0; border-top: ${border}; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748b;">${row.label}</td>
                <td align="right" style="padding: ${padTop} 0; border-top: ${border}; font-family: Arial, Helvetica, sans-serif; font-size: ${size}; font-weight: ${weight}; color: ${color};">${row.value}</td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td style="padding: 10px 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748b;">Total</td>
          <td align="right" style="padding: 10px 0; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 900; color: #111827;">-</td>
        </tr>
      `;

  return `
  <html lang="en">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${model.heading}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8f9fa;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa;">
        <tr>
          <td align="center" style="padding: 24px 12px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width: 600px; max-width: 600px;">
              <tr>
                <td align="center" style="padding: 28px 24px; background: #2c3e50; border-radius: 12px 12px 0 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 10px;">
                    <tr>
                      <td style="padding: 10px 14px;">
                        <img src="${logoUrl}" style="display:block;margin:0 auto;max-width:140px;height:auto;" alt="ZCleanUp"/>
                      </td>
                    </tr>
                  </table>
                  <div style="font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: 1.2px;">
                    ZCLEANUP
                  </div>
                  <div style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: rgba(255,255,255,0.75); margin-top: 6px;">
                    Professional Cleaning Services
                  </div>
                </td>
              </tr>

              <tr>
                <td style="background-color: #ffffff; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 12px 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="padding: 24px 24px 10px;">
                        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 26px; font-weight: 800; color: #2c3e50; line-height: 1.2;">
                          Booking Cancelled
                        </div>
                        <div style="width: 40px; height: 3px; background: #e67e22; border-radius: 3px; margin-top: 10px;"></div>
                        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #6b7280; line-height: 1.5; margin-top: 6px;">
                          ${model.preheader}
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 24px 18px;">
                        <span style="display: inline-block; padding: 6px 12px; border-radius: 999px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; background: ${model.statusBackground}; color: ${model.statusColor};">
                          ${model.statusLabel}
                        </span>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 0 24px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #e5e7eb;">
                          <tr>
                            <td style="padding: 18px 0 0;">
                              <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #111827;">
                                Booking Summary
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 10px 0 2px;">
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                ${bookingSummaryRows}
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 0 24px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #e5e7eb;">
                          <tr>
                            <td style="padding: 18px 0 8px;">
                              <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #111827;">
                                Property Details
                              </div>
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 8px;">
                                ${propertyRows}
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 0 24px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #e5e7eb;">
                          <tr>
                            <td style="padding: 18px 0 8px;">
                              <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #111827;">
                                Selected Extras
                              </div>
                              ${extrasHtml}
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 0 24px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #e5e7eb;">
                          <tr>
                            <td style="padding: 18px 0 8px;">
                              <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #111827;">
                                Customer Notes
                              </div>
                              ${customerNotesHtml}
                              <div style="margin-top: 14px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #111827;">
                                Special Conditions
                              </div>
                              ${conditionsHtml}
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 0 24px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #e5e7eb;">
                          <tr>
                            <td style="padding: 16px 0 22px;">
                              <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: #111827;">
                                Pricing Breakdown
                              </div>
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f8fafc; border-radius: 8px; margin-top: 10px;">
                                <tr>
                                  <td style="padding: 14px 16px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                      ${pricingRowsHtml}
                                    </table>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    ${actionSection}

                    <tr>
                      <td style="padding: 18px 24px; border-top: 1px solid #e5e7eb; background: #f8f9fa;">
                        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #2c3e50; font-weight: 800;">
                          Thank you for choosing ZCLEANUP
                        </div>
                        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #6b7280; margin-top: 6px;">
                          Need help? Contact us at <span style="color: #2c3e50;">${supportEmail}</span>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td align="center" style="padding: 14px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #9ca3af;">
                  ZCLEANUP • Automated message
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
}
