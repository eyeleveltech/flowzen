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
    // Default to Gmail settings if using a normal email address
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
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
  sendVerificationEmail: async (to: string, token: string) => {
    try {
      const mailer = await getTransporter();
      const verifyUrl = `${APP_URL}/verify-email?token=${token}`;

      const info = await mailer.sendMail({
        from: '"Flowzen" <noreply@flowzen.app>',
        to,
        subject: 'Verify your email address - Flowzen',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Welcome to Flowzen!</h2>
            <p>Please verify your email address by clicking the link below:</p>
            <a href="${verifyUrl}" style="display: inline-block; padding: 10px 20px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 5px;">Verify Email</a>
            <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">If you did not create this account, please ignore this email.</p>
          </div>
        `,
      });

      logger.info(`Verification email sent to ${to}`);
      // If we are using ethereal, log the preview URL
      if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
        logger.info(`[ETHEREAL MAIL URL]: ${nodemailer.getTestMessageUrl(info)}`);
      }
    } catch (error) {
      logger.error('Failed to send verification email', { error });
    }
  },

  sendPasswordResetEmail: async (to: string, token: string) => {
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
    } catch (error) {
      logger.error('Failed to send password reset email', { error });
    }
  }
};
