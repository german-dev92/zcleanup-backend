declare module 'nodemailer' {
  export type SendMailOptions = Record<string, unknown>;

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  export function createTransport(
    options: Record<string, unknown>,
  ): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}
