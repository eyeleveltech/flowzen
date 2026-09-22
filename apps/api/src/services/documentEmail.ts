/**
 * CR-02 §10 — "downloadable as PDF, and emailable".
 *
 * One send path for both documents, for the same reason there is one template:
 * a proforma and a tax invoice go to the same person, saying the same things,
 * with a different word at the top.
 *
 * What it deliberately does NOT do is compose the message for you and send it.
 * The subject and body are defaults the sender can rewrite, because the note
 * that accompanies an invoice is a piece of client correspondence, and a system
 * that sends one without letting anybody read it first is a system people stop
 * trusting with their clients.
 */

import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../utils/mailer.js';
import { generateDocumentPdf } from './documentPdf.js';
import { loadRenderableDocument, type DocumentKind } from './documentModel.js';

export const documentEmailSchema = z.object({
  to: z.string().email('That does not look like an email address'),
  /** People who should see it without being asked to act on it. */
  cc: z.array(z.string().email()).max(5).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  /** Plain text as typed; newlines become paragraph breaks in the HTML. */
  message: z.string().trim().max(4000).optional(),
});

export type DocumentEmailInput = z.infer<typeof documentEmailSchema>;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const formatINR = (amount: number): string =>
  '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (d: Date): string =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * The default note, which the sender sees and can replace.
 *
 * It states the two things a client actually needs from the covering email —
 * what the document is for and what it comes to — so the attachment is not the
 * only place either figure appears.
 */
export function defaultEmailBody(doc: Awaited<ReturnType<typeof loadRenderableDocument>>): string {
  const what = doc.kind === 'PROFORMA' ? 'proforma invoice' : 'tax invoice';
  const dated = doc.validTill
    ? `It is valid until ${formatDate(doc.validTill)}.`
    : doc.dueAt
      ? `Payment is due by ${formatDate(doc.dueAt)}.`
      : '';
  return [
    'Hello,',
    '',
    `Please find attached ${doc.number}, our ${what} for ${formatINR(doc.totals.total)}. ${dated}`.trim(),
    '',
    'Bank details are on the document. Do let us know if anything needs changing.',
    '',
    'Thank you,',
    doc.seller.legalName,
  ].join('\n');
}

export function defaultEmailSubject(doc: Awaited<ReturnType<typeof loadRenderableDocument>>): string {
  const what = doc.kind === 'PROFORMA' ? 'Proforma invoice' : 'Tax invoice';
  return `${what} ${doc.number} from ${doc.seller.legalName}`;
}

/** What the form should open with — no send, just the defaults and the recipients we know of. */
export async function documentEmailDefaults(kind: DocumentKind, id: string, organizationId: string) {
  const doc = await loadRenderableDocument(kind, id, organizationId);

  const companyId =
    kind === 'PROFORMA'
      ? (await prisma.proforma.findFirst({ where: { id, organizationId }, select: { companyId: true } }))?.companyId
      : (await prisma.invoice.findFirst({ where: { id, organizationId }, select: { companyId: true } }))?.companyId;

  // Whoever pays, then whoever approves, then anybody else on file: the order
  // an accounts person would try them in.
  const people = companyId
    ? await prisma.person.findMany({
        where: { companyId, active: true, email: { not: null } },
        select: { name: true, email: true, role: true },
      })
    : [];
  const rank = { PAYER: 0, APPROVER: 1, CONTACT: 2 } as const;
  people.sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3));

  return {
    number: doc.number,
    subject: defaultEmailSubject(doc),
    message: defaultEmailBody(doc),
    recipients: people.map((p) => ({ name: p.name, email: p.email!, role: p.role })),
    to: people[0]?.email ?? null,
  };
}

export async function sendDocumentEmail(
  kind: DocumentKind,
  id: string,
  organizationId: string,
  actorId: string,
  input: DocumentEmailInput,
): Promise<{ sent: true; to: string }> {
  const doc = await loadRenderableDocument(kind, id, organizationId);
  const pdf = await generateDocumentPdf(kind, id, organizationId);

  const subject = input.subject?.trim() || defaultEmailSubject(doc);
  const body = input.message?.trim() || defaultEmailBody(doc);

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e4034">${body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('')}</div>`;

  await sendMail(organizationId, {
    to: input.to,
    cc: input.cc,
    subject,
    html,
    text: body,
    replyTo: doc.seller.contactEmail,
    attachments: [
      {
        // Slashes are routine in both series, and a filename is not a path.
        filename: `${doc.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      },
    ],
  });

  await prisma.activity.create({
    data: {
      organizationId,
      actorId,
      entityType: kind === 'PROFORMA' ? 'Proforma' : 'Invoice',
      entityId: id,
      verb: 'document_emailed',
      // No body: what was said to a client belongs in the mailbox that sent it,
      // not copied into an audit row that half the team can read.
      payload: { number: doc.number, to: input.to, cc: input.cc ?? [], subject },
    },
  });

  return { sent: true, to: input.to };
}
