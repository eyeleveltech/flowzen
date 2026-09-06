import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { decryptSecret } from './crypto.js';

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  via: 'ORG_SMTP' | 'ENV_SMTP';
};

/**
 * An organisation's own SMTP settings, when set, override the deployment's
 * shared account — `via` tells the caller (and, through GET /config/mail,
 * the Settings screen) which one is actually live, since an empty form
 * reading "On" would otherwise be unexplained.
 */
export async function resolveMailConfig(organizationId: string): Promise<MailConfig | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return null;

  if (org.smtpHost && org.smtpPort && org.smtpUser && org.smtpPasswordEncrypted) {
    return {
      host: org.smtpHost,
      port: org.smtpPort,
      user: org.smtpUser,
      pass: decryptSecret(org.smtpPasswordEncrypted),
      from: `${org.mailFromName || org.name} <${org.mailFromEmail || org.smtpUser}>`,
      via: 'ORG_SMTP',
    };
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    return {
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT, 10),
      user: SMTP_USER,
      pass: SMTP_PASS,
      from: `${org.mailFromName || org.name} <${org.mailFromEmail || SMTP_FROM || SMTP_USER}>`,
      via: 'ENV_SMTP',
    };
  }

  return null;
}

export async function sendMail(
  organizationId: string,
  message: { to: string; subject: string; html: string; text?: string; replyTo?: string | null },
): Promise<{ sent: true }> {
  const config = await resolveMailConfig(organizationId);
  if (!config) {
    throw new Error('No mail server is configured for this organisation.');
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  await transport.sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    replyTo: message.replyTo || undefined,
  });

  return { sent: true };
}
