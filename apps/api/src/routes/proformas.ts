import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { issueWithRetry } from '../utils/documentNumber.js';
import { ProformaStatus, ProformaSourceType } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';
import { generateDocumentPdf } from '../services/documentPdf.js';
import { buildDocumentSnapshot } from '../services/documentModel.js';
import {
  documentEmailDefaults,
  documentEmailSchema,
  sendDocumentEmail,
} from '../services/documentEmail.js';
import {
  documentFieldsSchema,
  cleanCustomFields,
  ORG_DOCUMENT_SELECT,
} from '../utils/documentSchemas.js';

export const proformasRouter = Router();

proformasRouter.use(authenticate);

// ── 1. List Proformas Register ──────────────────────────────────────────────

proformasRouter.get('/', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { status, companyId } = req.query;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    const where: any = { organizationId: orgId };
    if (status && typeof status === 'string' && ['UNPAID', 'PAID', 'EXPIRED', 'CANCELLED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as ProformaStatus;
    }
    if (companyId && typeof companyId === 'string') {
      where.companyId = companyId;
    }

    const [proformas, total] = await Promise.all([
      prisma.proforma.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          company: { select: { id: true, name: true, gstin: true, city: true } },
          invoice: { select: { id: true, number: true, status: true } },
        },
      }),
      prisma.proforma.count({ where }),
    ]);

    if (wantsCsv) {
      const csv = toCsv(proformas, [
        { label: 'Number', value: (pf) => pf.number },
        { label: 'Company', value: (pf) => pf.company.name },
        { label: 'Amount', value: (pf) => Number(pf.amount) },
        { label: 'Status', value: (pf) => pf.status },
        { label: 'Raised', value: (pf) => pf.raisedAt.toISOString().slice(0, 10) },
        { label: 'Valid till', value: (pf) => pf.validTill.toISOString().slice(0, 10) },
        { label: 'Invoice', value: (pf) => pf.invoice?.number ?? '' },
      ]);
      sendCsv(res, `proformas-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      proformas,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. Generate Sequential Proforma ─────────────────────────────────────────

const proformaCreateSchema = z.object({
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
  terms: z.string().default('Advance payment request. Payment due within validity period. GST applicable as per statutory rates.'),
  ...documentFieldsSchema,
})
  .refine((v) => v.lineItems !== undefined || v.amount !== undefined, {
    message: 'A proforma needs either line items or an amount',
    path: ['lineItems'],
  });

// ── 1b. Download Proforma PDF ───────────────────────────────────────────────
//
// Gated the same as the register itself (pipeline.read) — a BD user needs
// to be able to hand this document to a client, and a proforma amount is a
// deal value they're already entitled to see per §9.

proformasRouter.get('/:id/pdf', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const proforma = await prisma.proforma.findFirst({ where: { id, organizationId: orgId } });
    if (!proforma) {
      res.status(404).json({ success: false, error: 'Proforma not found' });
      return;
    }

    const pdf = await generateDocumentPdf('PROFORMA', id, orgId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${proforma.number.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

// ── 1c. One Proforma, In Full ───────────────────────────────────────────────
//
// The register carries enough to list a proforma; the edit form needs the
// whole document, line items included. Those are deliberately NOT folded into
// the list response: every row would then carry every line of every document
// to render a table that shows none of them.

proformasRouter.get('/:id', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const proforma = await prisma.proforma.findFirst({
      where: { id: String(req.params.id), organizationId: orgId },
      include: {
        company: { select: { id: true, name: true, gstin: true, city: true, stateName: true, stateCode: true } },
        invoice: { select: { id: true, number: true, status: true } },
        lineItems: { orderBy: { serialNo: 'asc' } },
      },
    });
    if (!proforma) {
      res.status(404).json({ success: false, error: 'Proforma not found' });
      return;
    }
    res.json({ success: true, proforma });
  } catch (error) {
    next(error);
  }
});

// ── 1d. Send it to the client (CR-02 §10) ───────────────────────────────────

proformasRouter.get('/:id/email', requirePermission('pipeline.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const defaults = await documentEmailDefaults('PROFORMA', String(req.params.id), req.user!.organizationId);
    res.json({ success: true, ...defaults });
  } catch (error) {
    next(error);
  }
});

proformasRouter.post('/:id/email', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = documentEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const sent = await sendDocumentEmail(
      'PROFORMA',
      String(req.params.id),
      req.user!.organizationId,
      req.user!.userId,
      parsed.data,
    );
    res.json({ success: true, ...sent });
  } catch (error) {
    // "No mail server is configured" is a setup problem with a fix the sender
    // can act on, not a 500 that reads as the app being broken.
    if (error instanceof Error && /mail server/i.test(error.message)) {
      res.status(400).json({ success: false, error: `${error.message} Set one up in Settings > Email.` });
      return;
    }
    next(error);
  }
});

proformasRouter.post('/', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = proformaCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const { companyId, sourceType, sourceId, milestoneId, amount, billingName, billingContactName, billingAddress, gstin, gstApplicable, gstRatePercent, description, poNumber, poDate, sacCode, terms, lineItems, customFields, placeOfSupply, billingStateName, billingStateCode, notes } = parsed.data;

    // A milestone can be billed once — the same guard `MSTATUS_NEXT` already
    // enforces client-side (only a PENDING milestone offers "raise proforma"),
    // repeated here because the client-side rule is a courtesy, not a control.
    if (milestoneId) {
      const milestone = await prisma.milestone.findFirst({
        where: { id: milestoneId, project: { organizationId: orgId, companyId } },
      });
      if (!milestone) {
        res.status(404).json({ success: false, error: 'Milestone not found for this company' });
        return;
      }
      if (milestone.status !== 'PENDING') {
        res.status(400).json({ success: false, error: 'This milestone already has a proforma raised against it' });
        return;
      }
    }

    // Fetched for the seller snapshot the document freezes onto itself,
    // rather than just the validity default it used to read.
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: ORG_DOCUMENT_SELECT });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organisation not found' });
      return;
    }
    const validDays = parsed.data.validDays ?? org.defaultProformaValidityDays ?? 30;

    // The company was never checked against the caller's org here — a
    // proforma in this organisation could be raised against another one's
    // company. It is fetched anyway now, for the buyer state to default from.
    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { billingAddress: true, gstin: true, stateName: true, stateCode: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

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
    const proforma = await issueWithRetry(orgId, 'PROFORMA', (nextNumber) =>
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
            actorId: req.user!.userId,
            verb: 'proforma_generated',
            payload: {
              number: nextNumber,
              amount: snapshot.subtotal,
              total: snapshot.total,
              billingName,
              ...(stageFrom ? { stageFrom, stageTo: 'PROFORMA_ISSUED' } : {}),
            },
          },
        });

        return created;
      }),
    );

    res.status(201).json({ success: true, proforma });
  } catch (error) {
    next(error);
  }
});

// ── 3. Update Proforma Status ───────────────────────────────────────────────

proformasRouter.patch('/:id/status', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { status } = req.body;
    if (!status || !['UNPAID', 'PAID', 'EXPIRED', 'CANCELLED'].includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid proforma status' });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    // Unlike every other write in this file, this one updated by bare id with
    // no check that the proforma belongs to the caller's org.
    const existing = await prisma.proforma.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Proforma not found' });
      return;
    }

    const proforma = await prisma.proforma.update({
      where: { id },
      data: { status: status as ProformaStatus },
    });

    /*
     * Cancelling one gives its milestone back.
     *
     * Raising a proforma moves the milestone to Proforma raised — status
     * follows the record — so withdrawing the document has to move it back, or
     * the milestone claims a document exists that no longer does. That was the
     * dead end: the milestone could not return to Pending and could not be
     * removed, and the only advice was to delete a proforma, which nothing can
     * do.
     *
     * Only from Proforma raised. Once it has been invoiced or paid, money has
     * moved on its own record and cancelling this document does not undo that.
     */
    if (status === 'CANCELLED' && existing.milestoneId) {
      const milestone = await prisma.milestone.findFirst({
        where: { id: existing.milestoneId },
        include: { _count: { select: { proformas: { where: { status: { not: 'CANCELLED' } } } } } },
      });
      if (milestone && milestone.status === 'PROFORMA_RAISED' && milestone._count.proformas === 0) {
        await prisma.milestone.update({ where: { id: milestone.id }, data: { status: 'PENDING' } });
        await prisma.activity.create({
          data: {
            organizationId: orgId,
            entityType: 'Project',
            entityId: milestone.projectId,
            actorId: req.user!.userId,
            verb: 'milestone_status_changed',
            payload: {
              milestoneId: milestone.id,
              label: milestone.label,
              from: 'PROFORMA_RAISED',
              to: 'PENDING',
              because: `Proforma ${existing.number} was cancelled`,
            },
          },
        });
      }
    }

    res.json({ success: true, proforma });
  } catch (error) {
    next(error);
  }
});

// ── 3b. Edit Proforma ────────────────────────────────────────────────────────
//
// Only while it's still UNPAID. A proforma somebody has already paid against,
// or one that's been cancelled, is a record of what actually happened —
// rewriting it after the fact is exactly the kind of drift §16's audit trail
// exists to catch. Raise a fresh one instead (as this app's own workflow
// already does when correcting a wrong figure).

const proformaEditSchema = z.object({
  amount: z.number().positive('Proforma amount must be positive').optional(),
  raisedAt: z.coerce.date().optional(),
  validDays: z.number().min(1).optional(),
  billingName: z.string().min(1, 'Billing name is required').optional(),
  billingContactName: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  gstApplicable: z.boolean().optional(),
  gstRatePercent: z.number().min(0).max(28).optional(),
  description: z.string().optional().nullable(),
  poNumber: z.string().optional().nullable(),
  poDate: z.coerce.date().optional().nullable(),
  sacCode: z.string().optional().nullable(),
  terms: z.string().optional(),
  ...documentFieldsSchema,
});

proformasRouter.patch('/:id', requirePermission('pipeline.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = proformaEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.proforma.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Proforma not found' });
      return;
    }
    if (existing.status !== ProformaStatus.UNPAID) {
      res.status(400).json({
        success: false,
        error: `This proforma is ${existing.status.toLowerCase()} and can no longer be edited. Raise a new one instead.`,
      });
      return;
    }

    const { raisedAt, validDays, poNumber, poDate, terms, notes } = parsed.data;

    // validTill is stored as an absolute date, not a day-count, so moving the
    // issue date has to recompute it. If validDays wasn't sent alongside a new
    // raisedAt, preserve however many days validity the document already had
    // rather than leaving validTill stranded relative to the old issue date.
    const effectiveRaisedAt = raisedAt ?? existing.raisedAt;
    const existingValidDays = Math.round((existing.validTill.getTime() - existing.raisedAt.getTime()) / 86400000);
    const effectiveValidDays = validDays ?? (raisedAt !== undefined ? existingValidDays : undefined);

    // An edit rebuilds the whole document rather than patching the columns
    // that changed. Patching is what lets a total drift away from the lines
    // it is supposed to be the sum of: change the rate and leave the tax, or
    // change the place of supply and leave CGST where IGST now belongs. The
    // merged values below are the document as it will stand after this edit,
    // and every figure is recomputed from them in one place.
    const merged = {
      gstApplicable: parsed.data.gstApplicable ?? existing.gstApplicable,
      gstRatePercent: parsed.data.gstRatePercent ?? existing.gstRatePercent,
      billingName: parsed.data.billingName ?? existing.billingName,
      billingContactName:
        parsed.data.billingContactName !== undefined ? parsed.data.billingContactName : existing.billingContactName,
      billingAddress:
        parsed.data.billingAddress !== undefined ? parsed.data.billingAddress : existing.billingAddress,
      gstin: parsed.data.gstin !== undefined ? parsed.data.gstin : existing.gstin,
      billingStateName:
        parsed.data.billingStateName !== undefined ? parsed.data.billingStateName : existing.billingStateName,
      billingStateCode:
        parsed.data.billingStateCode !== undefined ? parsed.data.billingStateCode : existing.billingStateCode,
    };

    // Line items sent, or the ones already on the row, or — for a proforma
    // raised before CR-02 that has neither — the single line its description
    // and amount always implied.
    const existingLines = await prisma.documentLineItem.findMany({
      where: { proformaId: id },
      orderBy: { serialNo: 'asc' },
    });
    const nextLines =
      parsed.data.lineItems ??
      (existingLines.length > 0
        ? existingLines.map((li) => ({
            particulars: li.particulars,
            units: Number(li.units),
            unitCost: Number(li.unitCost),
            hsnSac: li.hsnSac,
            gstRate: li.gstRate,
          }))
        : [
            {
              particulars:
                (parsed.data.description ?? existing.description)?.trim() ||
                'Retainer fee for the billing period.',
              units: 1,
              unitCost: parsed.data.amount ?? Number(existing.amount),
              hsnSac: parsed.data.sacCode ?? existing.sacCode,
            },
          ]);

    // An amount sent WITHOUT line items is still the whole document — the old
    // single-figure edit — so it replaces the one line's unit cost rather
    // than sitting beside a subtotal that disagrees with it.
    if (parsed.data.lineItems === undefined && parsed.data.amount !== undefined && nextLines.length === 1) {
      nextLines[0] = { ...nextLines[0], units: 1, unitCost: parsed.data.amount };
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: ORG_DOCUMENT_SELECT });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organisation not found' });
      return;
    }

    const snapshot = buildDocumentSnapshot({
      org,
      lineItems: nextLines,
      gstApplicable: merged.gstApplicable,
      gstRatePercent: merged.gstRatePercent,
      buyer: {
        name: merged.billingName,
        contactName: merged.billingContactName,
        address: merged.billingAddress,
        gstin: merged.gstin,
        stateName: merged.billingStateName,
        stateCode: merged.billingStateCode,
      },
      placeOfSupply:
        parsed.data.placeOfSupply ??
        { state: existing.placeOfSupplyState, code: existing.placeOfSupplyCode },
      customFields: cleanCustomFields(
        parsed.data.customFields ??
          (Array.isArray(existing.customFields)
            ? (existing.customFields as unknown as { label: string; value: string }[])
            : []),
      ),
    });

    const proforma = await prisma.$transaction(async (tx) => {
      // Replaced rather than diffed: serial numbers are array position, so a
      // deleted middle row renumbers everything after it anyway.
      await tx.documentLineItem.deleteMany({ where: { proformaId: id } });
      return tx.proforma.update({
        where: { id },
        data: {
          amount: snapshot.subtotal,
          ...(raisedAt !== undefined ? { raisedAt } : {}),
          ...(effectiveValidDays !== undefined
            ? { validTill: new Date(effectiveRaisedAt.getTime() + effectiveValidDays * 24 * 3600 * 1000) }
            : {}),
          gstApplicable: merged.gstApplicable,
          gstRatePercent: merged.gstRatePercent,
          description: snapshot.lines[0]?.particulars ?? null,
          sacCode: snapshot.lines[0]?.hsnSac ?? null,
          ...(poNumber !== undefined ? { poNumber: poNumber ? poNumber.trim() : null } : {}),
          ...(poDate !== undefined ? { poDate } : {}),
          ...(terms !== undefined ? { terms } : {}),
          ...(notes !== undefined ? { notes: notes || null } : {}),
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
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proforma',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'proforma_edited',
        payload: { fields: Object.keys(parsed.data), amount: snapshot.subtotal, total: snapshot.total },
      },
    });

    res.json({ success: true, proforma });
  } catch (error) {
    next(error);
  }
});
