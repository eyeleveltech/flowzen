/**
 * Raising a proforma — the one place it happens.
 *
 * This lived inside `POST /proformas`, which was fine while a proforma was
 * raised one at a time by hand. Retainer billing raises them a month at a time
 * for every client at once, and a second copy of the numbering, the tax split
 * and the source checks is how two proformas raised the same day end up
 * disagreeing about what a proforma is. Both routes call this.
 *
 * Three things a proforma can bill, named by `sourceType` + `sourceId`:
 *   · PROPOSAL   — a deal, before it is won. Issuing moves it to Proforma issued.
 *   · PROJECT    — a project, usually one billing milestone of it.
 *   · MONTH_CARD — one month of a retainer.
 */

import { z } from 'zod';
import { ProformaStatus, ProformaSourceType, type Proforma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { issueWithRetry } from '../utils/documentNumber.js';
import { buildDocumentSnapshot } from './documentModel.js';
import { documentFieldsSchema, cleanCustomFields, ORG_DOCUMENT_SELECT } from '../utils/documentSchemas.js';

export const proformaCreateSchema = z
  .object({
    companyId: z.string().min(1, 'Company is required'),
    sourceType: z.nativeEnum(ProformaSourceType).default(ProformaSourceType.PROPOSAL),
    sourceId: z.string().min(1, 'Source ID is required'),
    /** Set when this proforma is raised against one specific project milestone rather than the project in general. */
    milestoneId: z.string().optional(),
    /**
     * The pre-tax subtotal. Optional only because a caller sending line items
     * has already said what it is; the refine below rejects a request that
     * sends neither, rather than quietly raising a proforma for nothing.
     */
    amount: z.number().positive('Proforma amount must be positive').optional(),
    /** Falls back to the org's own defaultProformaValidityDays when omitted — not a fixed number in code. */
    validDays: z.number().min(1).optional(),
    billingName: z.string().min(1, 'Billing name is required'),
    billingContactName: z.string().optional().or(z.literal('')),
    billingAddress: z.string().optional().or(z.literal('')),
    gstin: z.string().optional().or(z.literal('')),
    /** Off for e.g. an export invoice or a GST-exempt client — drops the tax rows on the PDF entirely. */
    gstApplicable: z.boolean().default(true),
    /** The rate used when gstApplicable is true. 18% is the standard agency-services rate, but not the only real one. */
    gstRatePercent: z.number().min(0).max(28).default(18),
    /** The line-item description printed on the document, e.g. "Social Media Management for the Month of August". */
    description: z.string().optional().or(z.literal('')),
    /** The client's own PO reference, when this proforma is being raised against one they've already issued. */
    poNumber: z.string().optional().or(z.literal('')),
    poDate: z.coerce.date().optional(),
    /** SAC/HSN code for the single line item, e.g. "998382". */
    sacCode: z.string().optional().or(z.literal('')),
    terms: z
      .string()
      .default('Advance payment request. Payment due within validity period. GST applicable as per statutory rates.'),
    ...documentFieldsSchema,
  })
  .refine((v) => v.lineItems !== undefined || v.amount !== undefined, {
    message: 'A proforma needs either line items or an amount',
    path: ['lineItems'],
  });

export type ProformaInput = z.infer<typeof proformaCreateSchema>;

/** A reason a proforma cannot be raised, with the status it should answer with. */
export class ProformaRefusal extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** "2026-10" → "October 2026". */
export const monthName = (month: string) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? month
    : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** Proforma statuses that still stand — a cancelled or expired one no longer bills anything. */
export const LIVE_PROFORMA = [ProformaStatus.UNPAID, ProformaStatus.PAID];

/**
 * Whether a retainer month can take a proforma, and if not why not.
 *
 * Exported so the batch route can say, per client, why one was skipped —
 * in the same words a single refusal would use.
 */
export async function monthCardRefusal(
  orgId: string,
  companyId: string,
  monthCardId: string,
): Promise<{ month: string } | ProformaRefusal> {
  const card = await prisma.monthCard.findFirst({
    where: { id: monthCardId, retainer: { organizationId: orgId } },
    select: { id: true, month: true, invoiceId: true, retainer: { select: { companyId: true } } },
  });
  if (!card) return new ProformaRefusal(404, 'That retainer month was not found');
  if (card.retainer.companyId !== companyId) {
    return new ProformaRefusal(400, 'That retainer month belongs to another client');
  }
  // Once the tax invoice exists there is nothing left to ask for in advance.
  if (card.invoiceId) {
    return new ProformaRefusal(400, `${monthName(card.month)} already has its invoice — there is nothing left to ask for.`);
  }
  const live = await prisma.proforma.findFirst({
    where: { sourceType: ProformaSourceType.MONTH_CARD, sourceId: card.id, status: { in: LIVE_PROFORMA } },
    select: { number: true },
  });
  if (live) {
    return new ProformaRefusal(
      400,
      `${monthName(card.month)} already has proforma ${live.number}. Cancel it first to raise a new one.`,
    );
  }
  return { month: card.month };
}

export async function issueProforma(orgId: string, actorId: string, input: ProformaInput): Promise<Proforma> {
  const {
    companyId,
    sourceType,
    sourceId,
    milestoneId,
    amount,
    billingName,
    billingContactName,
    billingAddress,
    gstin,
    gstApplicable,
    gstRatePercent,
    description,
    poNumber,
    poDate,
    sacCode,
    terms,
    lineItems,
    customFields,
    placeOfSupply,
    billingStateName,
    billingStateCode,
    notes,
  } = input;

  // A milestone can be billed once — the same guard `MSTATUS_NEXT` already
  // enforces client-side (only a PENDING milestone offers "raise proforma"),
  // repeated here because the client-side rule is a courtesy, not a control.
  if (milestoneId) {
    const milestone = await prisma.milestone.findFirst({
      where: { id: milestoneId, project: { organizationId: orgId, companyId } },
      include: { project: { select: { isSample: true, name: true } } },
    });
    if (!milestone) throw new ProformaRefusal(404, 'Milestone not found for this company');
    // Sample work is given away. A proforma is a request for money, so there
    // is nothing for this one to ask for.
    if (milestone.project.isSample) {
      throw new ProformaRefusal(
        400,
        `${milestone.project.name} is sample work — there is nothing to bill against it. Move it off sample work first if it is being charged for.`,
      );
    }
    if (milestone.status !== 'PENDING') {
      throw new ProformaRefusal(400, 'This milestone already has a proforma raised against it');
    }
  }

  // A retainer month: in this client's retainer, not already invoiced, and
  // not already asked for.
  let month: string | null = null;
  if (sourceType === ProformaSourceType.MONTH_CARD) {
    const check = await monthCardRefusal(orgId, companyId, sourceId);
    if (check instanceof ProformaRefusal) throw check;
    month = check.month;
  }

  // Fetched for the seller snapshot the document freezes onto itself,
  // rather than just the validity default it used to read.
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: ORG_DOCUMENT_SELECT });
  if (!org) throw new ProformaRefusal(404, 'Organisation not found');
  const validDays = input.validDays ?? org.defaultProformaValidityDays ?? 30;

  // The company was never checked against the caller's org here — a
  // proforma in this organisation could be raised against another one's
  // company. It is fetched anyway now, for the buyer state to default from.
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: { billingAddress: true, gstin: true, stateName: true, stateCode: true },
  });
  if (!company) throw new ProformaRefusal(404, 'Company not found');

  // A proforma raised without line items is still a one-line document —
  // exactly the one the old single-description form produced — so the same
  // request that worked yesterday produces the same page today.
  const lines = lineItems ?? [
    {
      particulars: description?.trim() || 'Retainer fee for the billing period.',
      units: 1,
      unitCost: amount!,
      hsnSac: sacCode?.trim() || null,
    },
  ];

  const snapshot = buildDocumentSnapshot({
    org,
    lineItems: lines,
    gstApplicable,
    gstRatePercent,
    buyer: {
      name: billingName,
      contactName: billingContactName,
      address: billingAddress || company.billingAddress,
      gstin: gstin || company.gstin,
      stateName: billingStateName ?? company.stateName,
      stateCode: billingStateCode ?? company.stateCode,
    },
    placeOfSupply,
    customFields: cleanCustomFields(customFields),
  });

  const raisedAt = new Date();
  const validTill = new Date(Date.now() + validDays * 24 * 3600 * 1000);

  // The number is read-highest-then-insert, so two people raising a proforma
  // at the same moment compute the same one. The unique index on
  // (organizationId, number) is what actually guarantees the series is never
  // reused; `issueWithRetry` is what turns losing that race into the next
  // number instead of a 500. Shared with invoices — one series, one rule.
  return issueWithRetry(orgId, 'PROFORMA', (nextNumber) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.proforma.create({
        data: {
          organizationId: orgId,
          number: nextNumber,
          companyId,
          sourceType,
          sourceId,
          milestoneId: milestoneId || null,
          // Still the PRE-TAX subtotal, unchanged in meaning: the register,
          // the forecast and the money screens all read this column, and
          // `total` is added beside it rather than in place of it.
          amount: snapshot.subtotal,
          raisedAt,
          validTill,
          status: ProformaStatus.UNPAID,
          gstApplicable,
          gstRatePercent,
          // Kept in step with line one so anything still reading the single
          // description (the register CSV, the proposal trail) keeps working.
          description: (lines[0]?.particulars ?? description)?.trim() || null,
          sacCode: lines[0]?.hsnSac ?? (sacCode ? sacCode.trim() : null),
          poNumber: poNumber ? poNumber.trim() : null,
          poDate: poDate ?? null,
          terms,
          notes: notes || null,
          billingName: snapshot.billingName,
          billingContactName: snapshot.billingContactName,
          billingAddress: snapshot.billingAddress,
          gstin: snapshot.gstin,
          billingStateName: snapshot.billingStateName,
          billingStateCode: snapshot.billingStateCode,
          placeOfSupplyState: snapshot.placeOfSupplyState,
          placeOfSupplyCode: snapshot.placeOfSupplyCode,
          supplyType: snapshot.supplyType,
          sellerSnapshot: snapshot.sellerSnapshot,
          customFields: snapshot.customFields,
          subtotal: snapshot.subtotal,
          cgstAmount: snapshot.cgstAmount,
          sgstAmount: snapshot.sgstAmount,
          igstAmount: snapshot.igstAmount,
          roundOff: snapshot.roundOff,
          total: snapshot.total,
          amountInWords: snapshot.amountInWords,
          lineItems: { create: snapshot.lines },
        },
      });

      // If source is a proposal, auto update proposal stage to PROFORMA_ISSUED
      let stageFrom: string | null = null;
      if (sourceType === ProformaSourceType.PROPOSAL) {
        // Read before the write: issuing the proforma is what moved the deal,
        // and the trail should say where it moved FROM. Nothing recorded that,
        // so the one stage change nobody performs by hand was also the one
        // with no history.
        const source = await tx.proposal.findUnique({ where: { id: sourceId }, select: { stage: true } });
        stageFrom = source?.stage ?? null;
        await tx.proposal.update({
          where: { id: sourceId },
          data: { stage: 'PROFORMA_ISSUED' },
        });
      }

      // A milestone's status is derived from what's actually been raised
      // against it, same principle as a proposal's stage — this is what
      // turns "raise proforma" from a label flip into a real document.
      if (milestoneId) {
        await tx.milestone.update({
          where: { id: milestoneId },
          data: { status: 'PROFORMA_RAISED' },
        });
      }

      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Proforma',
          entityId: created.id,
          actorId,
          verb: 'proforma_generated',
          payload: {
            number: nextNumber,
            amount: snapshot.subtotal,
            total: snapshot.total,
            billingName,
            ...(month ? { month } : {}),
            ...(stageFrom ? { stageFrom, stageTo: 'PROFORMA_ISSUED' } : {}),
          },
        },
      });

      return created;
    }),
  );
}
