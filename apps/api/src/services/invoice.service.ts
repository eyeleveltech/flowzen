/**
 * Invoices and payments.
 *
 * The model said what an invoice IS and never what CREATES one. It is the
 * engagement: it knows the amount, how often it bills, and when the next one is
 * due. An invoice is one period of that engagement turned into a document
 * (master plan §3.8).
 */

import { Prisma } from '@prisma/client';
import type { BillingFrequency, InvoiceStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { generateDocumentNumber } from '../utils/documentNumber.js';
import { computeTaxSplit } from '../utils/tax.js';
import { addMonths } from './deal.service.js';

const D = Prisma.Decimal;

/** How far one billing period runs. */
export const periodLength = (frequency: BillingFrequency): number => {
  switch (frequency) {
    case 'MONTHLY':
      return 1;
    case 'QUARTERLY':
      return 3;
    case 'YEARLY':
      return 12;
    case 'ONE_TIME':
      return 0;
  }
};

/**
 * Engagements with an invoice due on or before `asOf`.
 *
 * Surfaced, not raised. Flowzen tells you one is due; a person creates it. B2 in
 * the backlog makes the engagement raise its own draft for approval — deliberately
 * not in the first build.
 */
export const findDueForBilling = async (organizationId: string, asOf: Date = new Date()) =>
  prisma.engagement.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      nextBillingDate: { not: null, lte: asOf },
    },
    include: {
      company: { select: { id: true, name: true, state: true, gstNumber: true, ownerId: true } },
    },
    orderBy: { nextBillingDate: 'asc' },
  });

export type RaiseInvoiceOptions = {
  issueDate?: Date;
  /** Days from issue until payment is due. */
  dueInDays?: number;
  taxRatePercent?: number;
  description?: string;
};

/**
 * Raise the next invoice for an engagement.
 *
 * The billing date advances ONLY here, and only because an invoice was actually
 * created — never on a timer. A cycle that rolls forward by itself silently hides
 * the month nobody billed; by moving only on success, an unbilled month stays
 * showing as due and keeps appearing until somebody deals with it (§3.8).
 *
 * The number is allocated inside the transaction so a failure does not burn one
 * and leave a gap that looks like a deleted document.
 */
export const raiseInvoiceForEngagement = async (
  engagementId: string,
  userId: string | null,
  options: RaiseInvoiceOptions = {},
) => {
  const engagement = await prisma.engagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: { company: { select: { id: true, name: true, state: true } } },
  });

  if (engagement.status !== 'ACTIVE') {
    throw new Error(`Cannot bill a ${engagement.status.toLowerCase()} engagement.`);
  }

  const org = await getOrgConfig(engagement.organizationId);

  const issueDate = options.issueDate ?? new Date();
  const dueDate = new Date(issueDate.getTime() + (options.dueInDays ?? 15) * 86_400_000);

  const periodStart = engagement.nextBillingDate ?? engagement.startDate;
  const months = periodLength(engagement.billingFrequency);
  const periodEnd =
    months > 0 ? new Date(addMonths(periodStart, months).getTime() - 86_400_000) : null;

  // Both states are known here, so the split is computed rather than chosen — and
  // it throws instead of guessing when the organisation's state is unset, because
  // a GST invoice is not valid without it (§3.11).
  const tax = computeTaxSplit(
    engagement.amount,
    options.taxRatePercent ?? 18,
    org.state,
    engagement.company.state,
  );

  const description =
    options.description ??
    (months > 0
      ? `${engagement.type === 'RETAINER' ? 'Retainer' : 'Project'} — ${periodStart.toISOString().slice(0, 10)} to ${periodEnd?.toISOString().slice(0, 10)}`
      : `${engagement.type === 'RETAINER' ? 'Retainer' : 'Project'} — one-time`);

  return prisma.$transaction(async (tx) => {
    const number = await generateDocumentNumber(engagement.organizationId, 'INV', tx, issueDate);

    const invoice = await tx.invoice.create({
      data: {
        organizationId: engagement.organizationId,
        companyId: engagement.companyId,
        engagementId,
        number,
        type: 'INVOICE',
        issueDate,
        dueDate,
        status: 'DRAFT',
        // A frozen snapshot. An issued invoice never changes — if it is wrong you
        // void it and issue a credit note, which is what an audit needs to see.
        lineItems: [
          {
            description,
            quantity: 1,
            rate: engagement.amount.toString(),
            amount: tax.taxable.toString(),
          },
        ],
        subtotal: tax.taxable,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        total: tax.total,
        currency: engagement.currency,
        periodStart,
        periodEnd,
      },
    });

    // Only now does the cycle advance, and only by one period.
    if (months > 0) {
      await tx.engagement.update({
        where: { id: engagementId },
        data: { nextBillingDate: addMonths(periodStart, months) },
      });
    } else {
      await tx.engagement.update({
        where: { id: engagementId },
        data: { nextBillingDate: null },
      });
    }

    await tx.activity.create({
      data: {
        organizationId: engagement.organizationId,
        type: 'SYSTEM',
        message: `Invoice ${number} raised for ${tax.total.toString()}`,
        userId,
        companyId: engagement.companyId,
        engagementId,
      },
    });

    return invoice;
  });
};

/**
 * Work out an invoice's status from its payments.
 *
 * Pure, and the ONLY rule that decides it — the same discipline as company status
 * (§3.2). Two places deciding whether something is paid is how a list and a
 * dashboard disagree about money.
 */
export const statusFromPayments = (
  total: Prisma.Decimal,
  paid: Prisma.Decimal,
  current: InvoiceStatus,
): InvoiceStatus => {
  // A voided or draft invoice is not made "paid" by money arriving against it.
  // Those states are decisions, not arithmetic.
  if (current === 'VOID' || current === 'DRAFT') return current;
  if (paid.lte(0)) return 'SENT';
  if (paid.lt(total)) return 'PARTIALLY_PAID';
  return 'PAID';
};

/**
 * Record a payment and let the invoice's status follow.
 *
 * `invoiceId` may be null: an advance is paid before any invoice exists, and a
 * client paying 50% up front is normal (§3.8).
 *
 * Payments created or deleted are audited, because they are money (§3.12).
 */
export const recordPayment = async (
  input: {
    organizationId: string;
    companyId: string;
    invoiceId?: string | null;
    amount: Prisma.Decimal | number | string;
    currency: string;
    paidOn: Date;
    method?: 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'CARD' | 'OTHER';
    reference?: string | null;
    notes?: string | null;
  },
  userId: string,
) => {
  const amount = new D(input.amount);
  if (amount.lte(0)) throw new Error('A payment must be for more than zero.');

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
        companyId: input.companyId,
        invoiceId: input.invoiceId ?? null,
        amount,
        currency: input.currency,
        paidOn: input.paidOn,
        method: input.method ?? 'BANK_TRANSFER',
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: userId,
      },
    });

    if (input.invoiceId) {
      await refreshInvoiceStatus(input.invoiceId, tx);
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId,
        action: 'PAYMENT_CREATED',
        entityType: 'Payment',
        entityId: payment.id,
        after: { amount: amount.toString(), invoiceId: input.invoiceId ?? null },
      },
    });

    await tx.activity.create({
      data: {
        organizationId: input.organizationId,
        type: 'PAYMENT_RECEIVED',
        message: `Payment of ${amount.toString()} received`,
        userId,
        companyId: input.companyId,
        occurredAt: input.paidOn,
      },
    });

    return payment;
  });
};

/** Re-derive one invoice's status from the payments against it. */
export const refreshInvoiceStatus = async (
  invoiceId: string,
  tx?: Prisma.TransactionClient,
): Promise<InvoiceStatus> => {
  const client = tx ?? prisma;

  const invoice = await client.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { id: true, total: true, status: true },
  });

  const agg = await client.payment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });

  const paid = agg._sum.amount ?? new D(0);
  const next = statusFromPayments(invoice.total, paid, invoice.status);

  if (next !== invoice.status) {
    await client.invoice.update({ where: { id: invoiceId }, data: { status: next } });
  }
  return next;
};

/**
 * Whether an invoice is overdue.
 *
 * Worked out on the spot, never stored. Storing it needs a nightly job, and the
 * night that job fails receivables are silently wrong (§3.8).
 */
export const isOverdue = (
  invoice: { status: InvoiceStatus; dueDate: Date },
  now: Date = new Date(),
): boolean =>
  (invoice.status === 'SENT' || invoice.status === 'PARTIALLY_PAID') && invoice.dueDate < now;

/**
 * The three numbers people treat as one.
 *
 * A month can look excellent on the first and be empty on the third, so none is
 * derived from another (§3.8).
 */
export const revenueSummary = async (
  organizationId: string,
  from: Date,
  to: Date,
): Promise<{
  billed: Prisma.Decimal;
  collected: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  overdue: Prisma.Decimal;
}> => {
  const [billedAgg, collectedAgg, openInvoices] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        organizationId,
        status: { notIn: ['DRAFT', 'VOID'] },
        issueDate: { gte: from, lte: to },
      },
      _sum: { total: true },
    }),
    prisma.payment.aggregate({
      where: { organizationId, paidOn: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
      select: { id: true, total: true, dueDate: true, payments: { select: { amount: true } } },
    }),
  ]);

  let outstanding = new D(0);
  let overdue = new D(0);
  const now = new Date();

  for (const inv of openInvoices) {
    const paid = inv.payments.reduce((s, p) => s.add(p.amount), new D(0));
    const remaining = inv.total.sub(paid);
    if (remaining.lte(0)) continue;
    outstanding = outstanding.add(remaining);
    if (inv.dueDate < now) overdue = overdue.add(remaining);
  }

  return {
    billed: billedAgg._sum.total ?? new D(0),
    collected: collectedAgg._sum.amount ?? new D(0),
    outstanding,
    overdue,
  };
};
