/**
 * What the mail actually says.
 *
 * Separate from `mail.ts` because delivery and wording change for different
 * reasons and at different times: one is plumbing, the other is the agency's
 * voice reaching a client.
 *
 * Written as inline-styled tables. Not a style choice — mail clients strip
 * <style> blocks, ignore most of flexbox and grid, and Outlook renders through
 * Word. A layout that survives everywhere is worth more here than a pretty one
 * that collapses in the client your biggest customer happens to use.
 *
 * Every value that reaches the HTML goes through `esc`. A client called
 * "Smith & Sons <Chennai>" is ordinary, and unescaped it breaks the document.
 */

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** HTML-escape. Applied to every interpolated value without exception. */
export const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

/**
 * The shell every message shares.
 *
 * `preheader` is the grey line a mail client shows next to the subject. Left
 * unset it shows whatever the first words of the body happen to be, which is
 * usually "Hi there," repeated down the inbox.
 */
const layout = (opts: {
  orgName: string;
  preheader: string;
  body: string;
  footer?: string;
}): string => `
<div style="background:#f9fafb;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:12px;">
    <tr>
      <td style="padding:28px 32px 8px;">
        <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.02em;color:${MUTED};text-transform:uppercase;">${esc(opts.orgName)}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 32px 28px;color:${INK};font-size:15px;line-height:1.6;">
        ${opts.body}
      </td>
    </tr>
  </table>
  <p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">
    ${opts.footer ?? `Sent by ${esc(opts.orgName)} through Flowzen.`}
  </p>
</div>`;

/** The one call to action. One per message — two is none. */
const button = (href: string, label: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr>
      <td style="background:${INK};border-radius:10px;">
        <a href="${esc(href)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
    If the button does not work, paste this into your browser:<br/>
    <span style="word-break:break-all;color:${MUTED};">${esc(href)}</span>
  </p>`;

// ──────────────────────────────────────────────────────────────────────────────

export const inviteEmail = (opts: {
  orgName: string;
  inviterName: string;
  recipientName: string;
  role: string;
  token: string;
}): { subject: string; html: string } => {
  const url = `${APP_URL}/accept-invite?token=${encodeURIComponent(opts.token)}`;
  const role = opts.role.replace('_', ' ').toLowerCase();

  return {
    subject: `${opts.inviterName} has invited you to ${opts.orgName} on Flowzen`,
    html: layout({
      orgName: opts.orgName,
      preheader: `Set a password and you are in. The link works for seven days.`,
      body: `
        <p style="margin:0 0 12px;">Hello ${esc(opts.recipientName)},</p>
        <p style="margin:0 0 12px;">
          ${esc(opts.inviterName)} has invited you to join <strong>${esc(opts.orgName)}</strong>
          on Flowzen as ${esc(role)}.
        </p>
        <p style="margin:0;">Set a password and you are in.</p>
        ${button(url, 'Accept the invitation')}
        <p style="margin:16px 0 0;font-size:12px;color:${MUTED};">
          This link works for seven days. If you were not expecting it, ignore this message — nothing happens until you use it.
        </p>`,
    }),
  };
};

export const passwordResetEmail = (opts: {
  orgName: string;
  recipientName: string;
  token: string;
  /** Set when an admin issued it, so the person knows it was not a stranger. */
  issuedBy?: string | null;
}): { subject: string; html: string } => {
  const url = `${APP_URL}/reset-password?token=${encodeURIComponent(opts.token)}`;

  return {
    subject: `Reset your Flowzen password`,
    html: layout({
      orgName: opts.orgName,
      preheader: 'The link works for one hour.',
      body: `
        <p style="margin:0 0 12px;">Hello ${esc(opts.recipientName)},</p>
        <p style="margin:0 0 12px;">
          ${
            opts.issuedBy
              ? `${esc(opts.issuedBy)} has started a password reset for your account.`
              : 'A password reset was requested for your account.'
          }
        </p>
        ${button(url, 'Set a new password')}
        <p style="margin:16px 0 0;font-size:12px;color:${MUTED};">
          The link works for one hour, and once for one password. If you did not expect this,
          ignore it — your current password keeps working and nobody can see it.
        </p>`,
    }),
  };
};

/**
 * A quotation, sent to the client.
 *
 * The figures are in the BODY rather than only in an attachment. PDFs are not
 * built yet (backlog item 3), and more to the point a client reading on a phone
 * should be able to see the number without downloading anything. When the PDF
 * arrives it attaches alongside this, it does not replace it.
 */
export const quotationEmail = (opts: {
  orgName: string;
  clientName: string;
  contactName?: string | null;
  number: string;
  lines: { description: string; quantity: string; rate: string; amount: string }[];
  subtotal: string;
  taxRows: { label: string; amount: string }[];
  total: string;
  validUntil?: string | null;
  senderName: string;
  note?: string | null;
}): { subject: string; html: string } => {
  const cell = `padding:8px 0;border-bottom:1px solid ${LINE};font-size:13px;vertical-align:top;`;

  const rows = opts.lines
    .map(
      (l) => `
      <tr>
        <td style="${cell}">${esc(l.description)}<br/>
          <span style="color:${MUTED};font-size:12px;">${esc(l.quantity)} × ${esc(l.rate)}</span>
        </td>
        <td style="${cell}text-align:right;white-space:nowrap;">${esc(l.amount)}</td>
      </tr>`,
    )
    .join('');

  const taxes = opts.taxRows
    .map(
      (t) => `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:${MUTED};">${esc(t.label)}</td>
        <td style="padding:4px 0;font-size:13px;text-align:right;">${esc(t.amount)}</td>
      </tr>`,
    )
    .join('');

  return {
    subject: `Quotation ${opts.number} from ${opts.orgName}`,
    html: layout({
      orgName: opts.orgName,
      preheader: `${opts.number} — ${opts.total}`,
      body: `
        <p style="margin:0 0 12px;">${opts.contactName ? `Hello ${esc(opts.contactName)},` : 'Hello,'}</p>
        <p style="margin:0 0 4px;">
          Here is our quotation <strong>${esc(opts.number)}</strong> for ${esc(opts.clientName)}.
        </p>
        ${opts.note ? `<p style="margin:12px 0;white-space:pre-wrap;">${esc(opts.note)}</p>` : ''}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;border-collapse:collapse;">
          ${rows}
          <tr>
            <td style="padding:10px 0 4px;font-size:13px;color:${MUTED};">Subtotal</td>
            <td style="padding:10px 0 4px;font-size:13px;text-align:right;">${esc(opts.subtotal)}</td>
          </tr>
          ${taxes}
          <tr>
            <td style="padding:10px 0 0;border-top:2px solid ${INK};font-size:15px;font-weight:700;">Total</td>
            <td style="padding:10px 0 0;border-top:2px solid ${INK};font-size:15px;font-weight:700;text-align:right;">${esc(opts.total)}</td>
          </tr>
        </table>

        ${
          opts.validUntil
            ? `<p style="margin:20px 0 0;font-size:12px;color:${MUTED};">This quotation is valid until ${esc(opts.validUntil)}.</p>`
            : ''
        }
        <p style="margin:20px 0 0;">Reply to this email to accept, or with any questions.</p>
        <p style="margin:16px 0 0;">${esc(opts.senderName)}<br/><span style="color:${MUTED};">${esc(opts.orgName)}</span></p>`,
      footer: `Sent by ${esc(opts.orgName)}.`,
    }),
  };
};

/** Proves the settings work, and says so in a way that is obvious in an inbox. */
export const testEmail = (opts: {
  orgName: string;
  recipientName: string;
}): { subject: string; html: string } => ({
  subject: `Flowzen can send email for ${opts.orgName}`,
  html: layout({
    orgName: opts.orgName,
    preheader: 'Sending is working.',
    body: `
      <p style="margin:0 0 12px;">Hello ${esc(opts.recipientName)},</p>
      <p style="margin:0 0 12px;">
        If you are reading this, ${esc(opts.orgName)} can send email through Flowzen.
        Invitations, password resets and quotations will go out on their own from now on.
      </p>
      <p style="margin:0;color:${MUTED};font-size:13px;">Nothing else was sent — this is only a test.</p>`,
  }),
});
