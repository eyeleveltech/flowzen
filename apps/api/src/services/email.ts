import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

let transporter: nodemailer.Transporter | null = null;

/**
 * Initializes the Nodemailer transporter.
 * If EMAIL_USER and EMAIL_PASS are provided in .env, it uses them (e.g., for Gmail).
 * Otherwise, it automatically creates a temporary Ethereal account for local development.
 */
async function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  if (user && pass) {
    logger.info('Using real SMTP credentials for email service.');
    // Honor an explicit SMTP_HOST (SendGrid/SES/etc.); fall back to Gmail only when
    // no host is configured, so password-reset/setup mail isn't forced through Gmail.
    if (process.env.SMTP_HOST) {
      const smtpPort = parseInt(process.env.SMTP_PORT || '465');
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user, pass },
      });
    } else {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      });
    }
  } else {
    logger.info('No EMAIL_USER/EMAIL_PASS found in .env. Creating temporary Ethereal account for testing...');
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }
  return transporter;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export const EmailService = {

  // Returns true when the message was handed to the SMTP transport, false on any failure.
  // Callers use this to surface a "couldn't email the invite" warning and offer a resend,
  // rather than reporting success when the mail silently never left (FZ-043).
  sendPasswordResetEmail: async (to: string, token: string): Promise<boolean> => {
    try {
      const mailer = await getTransporter();
      const resetUrl = `${APP_URL}/reset-password?token=${token}`;

      const info = await mailer.sendMail({
        from: '"Flowzen" <noreply@flowzen.app>',
        to,
        subject: 'Reset your password - Flowzen',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Reset Your Password</h2>
            <p>You requested to reset your password. Click the link below to set a new one:</p>
            <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 5px;">Reset Password</a>
            <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">This link will expire in 1 hour. If you did not request this, please ignore this email.</p>
          </div>
        `,
      });

      logger.info(`Password reset email sent to ${to}`);
      if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
        logger.info(`[ETHEREAL MAIL URL]: ${nodemailer.getTestMessageUrl(info)}`);
      }
      return true;
    } catch (error) {
      logger.error('Failed to send password reset email', { error });
      return false;
    }
  },

  sendSetupPasswordEmail: async (to: string, token: string): Promise<boolean> => {
    try {
      const mailer = await getTransporter();
      const setupUrl = `${APP_URL}/setup-password?token=${token}`;

      const info = await mailer.sendMail({
        from: '"Flowzen" <noreply@flowzen.app>',
        to,
        subject: 'Welcome to Flowzen! Set Up Your Account',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Welcome to Flowzen!</h2>
            <p>An administrator has invited you to join their team.</p>
            <p>Please click the link below to set up your password and access your account:</p>
            <a href="${setupUrl}" style="display: inline-block; padding: 10px 20px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 5px; margin-top: 10px;">Set Up Account</a>
            <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">This link will expire in 24 hours. If you believe this email was sent in error, please ignore it.</p>
          </div>
        `,
      });

      logger.info(`Setup password email sent to ${to}`);
      if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
        logger.info(`[ETHEREAL MAIL URL]: ${nodemailer.getTestMessageUrl(info)}`);
      }
      return true;
    } catch (error) {
      logger.error('Failed to send setup password email', { error });
      return false;
    }
  },

  /**
   * Send a quotation or proforma invoice to the client, with the PDF attached.
   *
   * Until this existed, marking a quote SENT changed a status field and nothing left the
   * building — the PDF had to be downloaded and attached to Gmail by hand on every single deal,
   * and "SENT" in Flowzen meant "someone intended to send this".
   *
   * The PDF is attached rather than linked: the download route is session-authenticated and
   * org-scoped (see routes/uploads.ts), so a link would be useless to the one person who most
   * needs to open it. It is read from disk here, so a missing file fails loudly instead of
   * mailing an empty envelope.
   */
  sendQuoteEmail: async (opts: {
    to: string;
    documentNumber: string;
    documentType: 'QUOTATION' | 'PROFORMA_INVOICE' | string;
    clientName: string;
    contactPerson?: string | null;
    orgName: string;
    grandTotal: string;
    expirationDate?: Date | string | null;
    pdfPath: string;
    pdfFilename: string;
    message?: string | null;
    replyTo?: string | null;
  }): Promise<boolean> => {
    try {
      const mailer = await getTransporter();
      const isQuote = opts.documentType === 'QUOTATION';
      const label = isQuote ? 'Quotation' : 'Proforma Invoice';
      const greeting = opts.contactPerson ? `Hi ${opts.contactPerson},` : 'Hello,';
      const validity = opts.expirationDate
        ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;">This ${label.toLowerCase()} is valid until ${new Date(opts.expirationDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>`
        : '';

      const info = await mailer.sendMail({
        from: `"${opts.orgName}" <noreply@flowzen.app>`,
        to: opts.to,
        // Replies belong to the person who sent it, not to a noreply mailbox nobody reads.
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
        subject: `${label} ${opts.documentNumber} from ${opts.orgName}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color:#111827;">
            <p>${greeting}</p>
            <p>Please find attached ${isQuote ? 'our quotation' : 'the proforma invoice'} <strong>${opts.documentNumber}</strong> for ${opts.clientName}.</p>
            ${opts.message ? `<p style="white-space:pre-wrap;">${opts.message}</p>` : ''}
            <table style="margin:20px 0;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 16px 8px 0;font-size:13px;color:#6b7280;">Document</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600;">${opts.documentNumber}</td>
              </tr>
              <tr>
                <td style="padding:8px 16px 8px 0;font-size:13px;color:#6b7280;">Total</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600;">${opts.grandTotal}</td>
              </tr>
            </table>
            ${validity}
            <p style="margin-top:20px;">Thanks,<br/>${opts.orgName}</p>
          </div>
        `,
        attachments: [{ filename: opts.pdfFilename, path: opts.pdfPath, contentType: 'application/pdf' }],
      });

      logger.info(`Quote ${opts.documentNumber} emailed to ${opts.to}`);
      if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
        logger.info(`[ETHEREAL MAIL URL]: ${nodemailer.getTestMessageUrl(info)}`);
      }
      return true;
    } catch (error) {
      logger.error('Failed to send quotation email', { error });
      return false;
    }
  }
};
