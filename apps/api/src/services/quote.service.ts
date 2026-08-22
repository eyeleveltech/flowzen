/**
 * Quotations.
 *
 * Flowzen sends the document; the client's ANSWER comes back outside it — by
 * email, phone or in a meeting — so the answer is recorded by hand. There is no
 * accept link and no portal (master plan §7.3).
 */

import { Prisma } from '@prisma/client';
import type { AcceptedVia, BillingFrequency, ContractType, SentVia } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { generateDocumentNumber } from '../utils/documentNumber.js';
import { computeTaxSplit } from '../utils/tax.js';
import { sendMail, type MailFailure } from './mail.js';
import { quotationEmail } from './mail-templates.js';

const D = Prisma.Decimal;

/**
 * A quotation rule was broken.
 *
 * Rules that the database also enforces still need one of these. The partial
 * unique index is the guarantee; this is the sentence somebody can act on. Left
 * to the index alone, a person recording an answer gets an opaque 500 for what is
 * really an ordinary "that has already happened".
 */
export class QuoteRuleError extends Error {
  readonly code = 'QUOTE_RULE_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'QuoteRuleError';
  }
}

export type LineInput = {
  description: string;
  quantity: number | string;
  rate: number | string;
  discountPercent?: number | string;
  serviceId?: string | null;
};

export type ComputedLine = {
  description: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  amount: string;
  serviceId: string | null;
};

export type QuoteTotals = {
  lines: ComputedLine[];
  subtotal: Prisma.Decimal;
  cgst: Prisma.Decimal;
  sgst: Prisma.Decimal;
  igst: Prisma.Decimal;
  total: Prisma.Decimal;
};

/**
 * Work out every figure on the document, on the server.
 *
 * A document must never bill an amount that arrived from a form (§4.6). The
 * browser may show a running total; only this decides what is charged.
 *
 * Rounding happens at the LINE, so the printed line column, the tax rows and the
 * grand total reconcile exactly. Rounding only at the end leaves a printed
 * invoice whose column does not add up to its own footer.
 */
export const computeQuoteTotals = (
  lines: LineInput[],
  taxRatePercent: number | string,
  sellerState: string | null,
  buyerState: string | null,
): QuoteTotals => {
  const computed: ComputedLine[] = [];
  let subtotal = new D(0);

  for (const line of lines) {
    const quantity = new D(line.quantity || 0);
    const rate = new D(line.rate || 0);
    const discountPercent = new D(line.discountPercent || 0);

    const gross = quantity.mul(rate);
    const discount = gross.mul(discountPercent).div(100);
    const amount = gross.sub(discount).toDecimalPlaces(2, D.ROUND_HALF_UP);

    subtotal = subtotal.add(amount);
    computed.push({
      description: line.description,
      quantity: quantity.toString(),
      rate: rate.toString(),
      discountPercent: discountPercent.toString(),
      amount: amount.toString(),
      serviceId: line.serviceId ?? null,
    });
  }

  const tax = computeTaxSplit(subtotal, taxRatePercent, sellerState, buyerState);

  return {
    lines: computed,
    subtotal: tax.taxable,
    cgst: tax.cgst,
    sgst: tax.sgst,
    igst: tax.igst,
    total: tax.total,
  };
};

export type CreateQuoteInput = {
  organizationId: string;
  dealId: string;
  engagementType: ContractType;
  billingFrequency: BillingFrequency;
  paymentTerms?: 'ADVANCE_100' | 'SPLIT_50_50' | 'MONTHLY' | 'MILESTONE' | null;
  lines: LineInput[];
  taxRatePercent?: number;
  validUntil?: Date | null;
};

/**
 * Create a quotation against a deal.
 *
 * The deal is the quote's only parent, and it is required — one parent removes
 * the re-pointing dance the old two-parent shape needed (§2).
 */
export const createQuote = async (input: CreateQuoteInput, userId: string) => {
  const deal = await prisma.deal.findFirstOrThrow({
    where: { id: input.dealId, organizationId: input.organizationId },
    include: { company: { select: { id: true, state: true } } },
  });

  const org = await getOrgConfig(input.organizationId);
  const totals = computeQuoteTotals(
    input.lines,
    input.taxRatePercent ?? 18,
    org.state,
    deal.company.state,
  );

  return prisma.$transaction(async (tx) => {
    const number = await generateDocumentNumber(input.organizationId, 'QT', tx);

    const quote = await tx.quote.create({
      data: {
        organizationId: input.organizationId,
        companyId: deal.companyId,
        dealId: deal.id,
        number,
        // The type and frequency are stated HERE. A total of 4,80,000 could be
        // 40,000 a month for a year or a one-off build, and the document cannot
        // say which without them (§3.12).
        engagementType: input.engagementType,
        billingFrequency: input.billingFrequency,
        paymentTerms: input.paymentTerms ?? null,
        lineItems: totals.lines as unknown as Prisma.InputJsonValue,
        subtotal: totals.subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        total: totals.total,
        currency: org.currency,
        validUntil: input.validUntil ?? null,
        status: 'DRAFT',
      },
    });

    // The deal's value follows the quote total. Typing the number twice is how
    // the two end up disagreeing (§4.6). For a retainer the deal carries the
    // PERIOD amount, not the annualised one — otherwise the forecast reads twelve
    // times the real monthly fee.
    await tx.deal.update({ where: { id: deal.id }, data: { value: totals.total } });

    await tx.activity.create({
      data: {
        organizationId: input.organizationId,
        type: 'SYSTEM',
        message: `Quotation ${number} created for ${totals.total.toString()}`,
        userId,
        dealId: deal.id,
        companyId: deal.companyId,
      },
    });

    return quote;
  });
};

/**
 * Mark a quotation as sent.
 *
 * `via` distinguishes a send Flowzen witnessed from one a person is asserting.
 * Both are legitimate — quotes also go out by WhatsApp or from someone's own
 * inbox — but the two must stay distinguishable (§3.12).
 */
export const markSent = async (
  quoteId: string,
  userId: string,
  via: SentVia,
  sentAt: Date = new Date(),
) => {
  const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
  if (quote.status !== 'DRAFT' && quote.status !== 'SENT') {
    throw new QuoteRuleError(`A ${quote.status.toLowerCase()} quotation cannot be marked as sent.`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.quote.update({
      where: { id: quoteId },
      data: { status: 'SENT', sentAt, sentVia: via, sentById: userId },
    });

    await tx.activity.create({
      data: {
        organizationId: quote.organizationId,
        type: 'QUOTE_SENT',
        message: `Quotation ${quote.number} sent`,
        userId,
        dealId: quote.dealId,
        companyId: quote.companyId,
        occurredAt: sentAt,
      },
    });

    return updated;
  });
};

/**
 * Email a quotation to the client, and mark it sent only if it left.
 *
 * The order is the whole point. `markSent` runs AFTER delivery succeeds, never
 * before and never regardless: a quotation showing SENT that never arrived is
 * worse than one still showing DRAFT, because everybody stops chasing it while
 * the client waits for something that does not exist (§3.12).
 *
 * The figures go in the body rather than only in an attachment. PDFs are not
 * built yet, and a client reading on a phone should see the number without
 * downloading anything — when the PDF arrives it attaches alongside this.
 */
export const emailQuote = async (
  quoteId: string,
  userId: string,
  input: { to?: string | null; note?: string | null } = {},
): Promise<
  | { delivered: true; quote: Awaited<ReturnType<typeof markSent>>; to: string }
  | { delivered: false; reason: MailFailure; detail?: string }
> => {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: {
      company: {
        select: {
          name: true,
          email: true,
          contacts: {
            where: { isPrimary: true },
            select: { name: true, email: true },
            take: 1,
          },
        },
      },
    },
  });

  if (quote.status !== 'DRAFT' && quote.status !== 'SENT') {
    throw new QuoteRuleError(`A ${quote.status.toLowerCase()} quotation cannot be sent.`);
  }

  const contact = quote.company.contacts[0] ?? null;
  // The primary contact first, then the company's own address. A quotation sent
  // to info@ that nobody reads is a quotation nobody answers.
  const to = input.to?.trim() || contact?.email || quote.company.email;
  if (!to) {
    return { delivered: false, reason: 'NO_RECIPIENT' };
  }

  const org = await getOrgConfig(quote.organizationId);
  const sender = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const money = (value: Prisma.Decimal | string) =>
    new Intl.NumberFormat(org.locale, {
      style: 'currency',
      currency: org.currency,
      maximumFractionDigits: 2,
    }).format(Number(value));

  const lines = (quote.lineItems as unknown as ComputedLine[]).map((l) => ({
    description: l.description,
    quantity: l.quantity,
    rate: money(l.rate),
    amount: money(l.amount),
  }));

  // Only the rows that apply. A quotation showing "IGST 0" next to "CGST 9,000"
  // invites the reader to wonder which one is the mistake.
  const taxRows: { label: string; amount: string }[] = [];
  if (!new D(quote.cgst).isZero()) taxRows.push({ label: 'CGST', amount: money(quote.cgst) });
  if (!new D(quote.sgst).isZero()) taxRows.push({ label: 'SGST', amount: money(quote.sgst) });
  if (!new D(quote.igst).isZero()) taxRows.push({ label: 'IGST', amount: money(quote.igst) });

  const mail = quotationEmail({
    orgName: org.name,
    clientName: quote.company.name,
    contactName: contact?.name ?? null,
    number: quote.number,
    lines,
    subtotal: money(quote.subtotal),
    taxRows,
    total: money(quote.total),
    validUntil: quote.validUntil
      ? new Intl.DateTimeFormat(org.locale, {
          dateStyle: 'long',
          timeZone: org.timezone,
        }).format(quote.validUntil)
      : null,
    senderName: sender?.name ?? org.name,
    note: input.note ?? null,
  });

  const result = await sendMail(quote.organizationId, {
    to,
    ...mail,
    // Replies go to the person who sent it. A client who hits reply to accept a
    // quotation should reach a human, not a mailbox nobody opens.
    replyTo: sender?.email ?? null,
  });

  if (!result.delivered) {
    return { delivered: false, reason: result.reason, detail: result.detail };
  }

  return { delivered: true, quote: await markSent(quoteId, userId, 'FLOWZEN_EMAIL'), to };
};

export type AcceptInput = {
  /** When the CLIENT said yes — not when this was typed in. */
  acceptedAt: Date;
  via: AcceptedVia;
  note?: string | null;
};

/**
 * Record that a client accepted.
 *
 * `acceptedAt` and `recordedAt` are stored separately on purpose. Someone who
 * agreed on Tuesday and was entered on Friday accepted on TUESDAY — store only
 * the typing date and every sales-cycle figure is wrong by however long people
 * take to write things up (§3.12).
 *
 * Accepting PROMPTS the win; it does not perform it. Winning needs a start date
 * the person marking the quote may not have.
 */
export const acceptQuote = async (quoteId: string, input: AcceptInput, userId: string) => {
  const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });

  if (quote.status === 'ACCEPTED') return { quote, alreadyAccepted: true, promptWin: false };
  if (quote.status === 'DECLINED' || quote.status === 'EXPIRED') {
    throw new QuoteRuleError(`A ${quote.status.toLowerCase()} quotation cannot be accepted.`);
  }

  // A deal carries at most one accepted price. Superseding DRAFT and SENT
  // siblings below is safe; an already-ACCEPTED one is not, because it may
  // already have produced an engagement that is billing. So this refuses and
  // says which document is in the way, rather than quietly overwriting the
  // agreement the client is actually on (§3.12).
  const accepted = await prisma.quote.findFirst({
    where: { dealId: quote.dealId, status: 'ACCEPTED', id: { not: quoteId } },
    select: { number: true },
  });
  if (accepted) {
    throw new QuoteRuleError(
      `This deal has already accepted ${accepted.number}. Decline that one first if the client has moved to a different price.`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Accepting version three declines one and two. Otherwise the deal carries
    // two live prices and the engagement could be built from the wrong one —
    // a partial unique index enforces it, so this keeps the insert from failing.
    await tx.quote.updateMany({
      where: { dealId: quote.dealId, status: { in: ['DRAFT', 'SENT'] }, id: { not: quoteId } },
      data: { status: 'DECLINED', declinedAt: new Date(), declineReason: 'Superseded by a later version' },
    });

    const updated = await tx.quote.update({
      where: { id: quoteId },
      data: {
        status: 'ACCEPTED',
        acceptedAt: input.acceptedAt,
        acceptedVia: input.via,
        acceptedNote: input.note ?? null,
        recordedById: userId,
        recordedAt: new Date(),
      },
    });

    await tx.activity.create({
      data: {
        organizationId: quote.organizationId,
        type: 'QUOTE_ACCEPTED',
        message: `Quotation ${quote.number} accepted via ${input.via.toLowerCase().replace('_', ' ')}`,
        body: input.note ?? null,
        userId,
        dealId: quote.dealId,
        companyId: quote.companyId,
        // The timeline records when it HAPPENED, not when it was written up.
        occurredAt: input.acceptedAt,
      },
    });

    return updated;
  });

  return {
    quote: result,
    alreadyAccepted: false,
    // The caller offers the win, pre-filled from this quote's type and frequency.
    promptWin: true,
    winDefaults: {
      contractType: result.engagementType,
      billingFrequency: result.billingFrequency,
      amount: result.subtotal.toString(),
      paymentTerms: result.paymentTerms,
    },
  };
};

export const declineQuote = async (
  quoteId: string,
  reason: string,
  userId: string,
  declinedAt: Date = new Date(),
) => {
  const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.quote.update({
      where: { id: quoteId },
      data: { status: 'DECLINED', declinedAt, declineReason: reason, recordedById: userId, recordedAt: new Date() },
    });

    await tx.activity.create({
      data: {
        organizationId: quote.organizationId,
        type: 'QUOTE_DECLINED',
        message: `Quotation ${quote.number} declined — ${reason}`,
        userId,
        dealId: quote.dealId,
        companyId: quote.companyId,
        occurredAt: declinedAt,
      },
    });

    return updated;
  });
};

/**
 * Quotations sent with no answer.
 *
 * Accepted and declined both get recorded by somebody. Silence is recorded by
 * nobody — which is exactly why it needs the system to raise it (§3.12).
 */
export const findAwaitingReply = async (organizationId: string, afterDays = 7) => {
  const cutoff = new Date(Date.now() - afterDays * 86_400_000);
  return prisma.quote.findMany({
    where: { organizationId, status: 'SENT', sentAt: { not: null, lte: cutoff } },
    include: {
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true, ownerId: true } },
    },
    orderBy: { sentAt: 'asc' },
  });
};
