/**
 * Sending mail.
 *
 * Until this, an invitation, a password reset and a quotation all ended the same
 * way: Flowzen handed back a LINK and somebody pasted it into Gmail. Everything
 * else about them worked; only delivery was manual (master plan §7.2).
 *
 * Three rules shape the whole file.
 *
 * ── 1. It never throws ──────────────────────────────────────────────────────
 *
 * `sendMail` returns a result. A mail server that is down, misconfigured or slow
 * is an ordinary condition, and it must not take the invitation down with it: the
 * account is created, the token is issued, and the caller is told the message did
 * not leave so it can offer the link instead. An exception here would roll back
 * work that genuinely succeeded.
 *
 * ── 2. Nothing is "sent" unless it left ─────────────────────────────────────
 *
 * A quotation marked SENT that never arrived is worse than one still marked
 * draft, because everybody stops chasing it (§3.12). Callers move a status only
 * on `delivered: true`.
 *
 * ── 3. No silent fallback transport ─────────────────────────────────────────
 *
 * The v1 service quietly opened a throwaway Ethereal mailbox whenever SMTP was
 * unconfigured. Mail then "sent" successfully to an inbox nobody owns, which is
 * the worst of the three outcomes — the screen says delivered, the client waits,
 * and there is nothing to find. Unconfigured now reports NOT_CONFIGURED and the
 * screens fall back to showing the link.
 *
 * Configuration is per ORGANISATION, read from its own settings, so two agencies
 * on one deployment send as themselves. Environment variables are the fallback
 * for a single-tenant install and for development.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

export type MailResult =
  | { delivered: true; messageId: string; via: 'ORG_SMTP' | 'ENV_SMTP' }
  | { delivered: false; reason: MailFailure; detail?: string };

export type MailFailure =
  /** No SMTP host anywhere — the organisation has not set one up. */
  | 'NOT_CONFIGURED'
  /** Configured, but there is nobody to send it to. */
  | 'NO_RECIPIENT'
  /** The server rejected it, or could not be reached. */
  | 'SEND_FAILED';

export type MailMessage = {
  to: string | null | undefined;
  subject: string;
  html: string;
  /** Falls back to a tag-stripped `html`, so no client ever gets an empty body. */
  text?: string;
  replyTo?: string | null;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

/** What an organisation sends as. */
type MailIdentity = {
  transporter: Transporter;
  from: string;
  replyTo: string | null;
  via: 'ORG_SMTP' | 'ENV_SMTP';
};

/**
 * Cached per organisation, and cleared explicitly when settings change.
 *
 * A transporter holds a connection pool; rebuilding it per message would open a
 * new TCP connection and re-authenticate for every invitation. A TTL is wrong
 * here for the same reason it is wrong for org config — a corrected password
 * would take however long the TTL was to start working, and nobody would connect
 * the two.
 */
const identities = new Map<string, MailIdentity | null>();

/** Call after any write to an organisation's mail settings. */
export const invalidateMailer = (organizationId: string): void => {
  identities.get(organizationId)?.transporter.close();
  identities.delete(organizationId);
};

/** For tests, and for a process that has just changed many organisations. */
export const clearMailerCache = (): void => {
  for (const identity of identities.values()) identity?.transporter.close();
  identities.clear();
};

/**
 * The deployment's own mail account.
 *
 * Used when an organisation has not set one up. That is right for a single-agency
 * install — the operator puts it in `.env` once and everything works — and it is
 * why the settings screen distinguishes the two: an admin looking at an empty
 * form that says "On" needs to be told WHOSE mailbox is sending.
 *
 * Both spellings of the last two are read because both exist in the wild and a
 * silently-ignored variable looks identical to a broken mail server.
 */
const envSmtp = () => ({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS,
  from: process.env.MAIL_FROM ?? process.env.SMTP_FROM,
});

/**
 * Build the transport for an organisation, or `null` if none is configured.
 *
 * `secure` is derived from the port rather than asked for: 465 is implicit TLS,
 * everything else negotiates with STARTTLS. Asking a person to tick a box they
 * have to look up is asking them to get it wrong.
 */
const identityFor = async (organizationId: string): Promise<MailIdentity | null> => {
  const cached = identities.get(organizationId);
  if (cached !== undefined) return cached;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      smtpPassword: true,
      mailFromName: true,
      mailFromEmail: true,
      mailReplyTo: true,
    },
  });

  if (!org) {
    identities.set(organizationId, null);
    return null;
  }

  const env = envSmtp();
  const host = org.smtpHost?.trim() || env.host;
  if (!host) {
    identities.set(organizationId, null);
    return null;
  }

  const usingOrg = Boolean(org.smtpHost?.trim());
  const port = (usingOrg ? org.smtpPort : env.port) ?? 587;
  const user = (usingOrg ? org.smtpUser : env.user) ?? undefined;
  const pass = (usingOrg ? org.smtpPassword : env.pass) ?? undefined;

  const address = org.mailFromEmail?.trim() || env.from || user;
  if (!address) {
    // A host with no from-address cannot produce a valid envelope. Treated as
    // unconfigured rather than half-configured, so the screens say the same
    // thing they would if no host were set at all.
    identities.set(organizationId, null);
    return null;
  }

  const identity: MailIdentity = {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
      pool: true,
      maxConnections: 2,
    }),
    from: `"${(org.mailFromName?.trim() || org.name).replace(/"/g, "'")}" <${address}>`,
    // Replies belong to a person, not to a noreply mailbox nobody reads.
    replyTo: org.mailReplyTo?.trim() || null,
    via: usingOrg ? 'ORG_SMTP' : 'ENV_SMTP',
  };

  identities.set(organizationId, identity);
  return identity;
};

/** Whether this organisation can send at all — for the settings screen. */
export const mailIsConfigured = async (organizationId: string): Promise<boolean> =>
  (await identityFor(organizationId)) !== null;

/**
 * How it is sending: its own account, the deployment's, or not at all.
 *
 * The middle case is the one worth naming. Without it an admin opens an empty
 * form marked "On" and has no way to find out which mailbox their invitations
 * are leaving from.
 */
export const mailStatus = async (
  organizationId: string,
): Promise<{ configured: boolean; via: 'ORG_SMTP' | 'ENV_SMTP' | null; from: string | null }> => {
  const identity = await identityFor(organizationId);
  return identity
    ? { configured: true, via: identity.via, from: identity.from }
    : { configured: false, via: null, from: null };
};

/**
 * Send one message. Never throws; always answers.
 *
 * The failure is a CODE rather than a sentence, because the sentence depends on
 * where you are standing — "we could not email the invitation, here is the link"
 * on the team screen, "set up sending in Settings" on the settings screen.
 */
export const sendMail = async (
  organizationId: string,
  message: MailMessage,
): Promise<MailResult> => {
  if (!message.to?.trim()) {
    return { delivered: false, reason: 'NO_RECIPIENT' };
  }

  const identity = await identityFor(organizationId);
  if (!identity) {
    return { delivered: false, reason: 'NOT_CONFIGURED' };
  }

  try {
    const info = await identity.transporter.sendMail({
      from: identity.from,
      to: message.to.trim(),
      replyTo: message.replyTo?.trim() || identity.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      // Some clients, and most spam filters, want a plain part.
      text: message.text ?? stripTags(message.html),
      attachments: message.attachments,
    });

    logger.info(`Mail sent: "${message.subject}" to ${message.to}`);
    return { delivered: true, messageId: info.messageId, via: identity.via };
  } catch (error) {
    // Logged with the subject, not the body — bodies carry invitation tokens and
    // reset links, and a log file is not the place for a live credential.
    logger.error(`Mail failed: "${message.subject}" to ${message.to}`, { error });
    return {
      delivered: false,
      reason: 'SEND_FAILED',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Prove the settings work, before anybody depends on them.
 *
 * `verify` opens a connection and authenticates without sending, so a wrong
 * password is reported as a wrong password rather than as a message that
 * disappeared.
 */
export const verifyMailSettings = async (
  organizationId: string,
): Promise<{ ok: true } | { ok: false; reason: MailFailure; detail?: string }> => {
  const identity = await identityFor(organizationId);
  if (!identity) return { ok: false, reason: 'NOT_CONFIGURED' };

  try {
    await identity.transporter.verify();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'SEND_FAILED',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * A readable sentence for a failure, for anywhere that has nothing better to say.
 *
 * Screens with their own context should write their own — this is the floor, not
 * the ceiling.
 */
export const explainMailFailure = (reason: MailFailure): string => {
  switch (reason) {
    case 'NOT_CONFIGURED':
      return 'Flowzen is not set up to send email yet — add a mail server in Settings → Email.';
    case 'NO_RECIPIENT':
      return 'There is no email address to send this to.';
    case 'SEND_FAILED':
      return 'The mail server would not accept the message. Check the settings in Settings → Email.';
  }
};

/** A plain-text part from the HTML one, so the two never drift apart. */
const stripTags = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
