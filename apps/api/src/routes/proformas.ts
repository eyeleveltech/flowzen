import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { issueWithRetry } from '../utils/documentNumber.js';
import { ProformaStatus, ProformaSourceType } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';
import { generateProformaPdf } from '../services/proformaPdf.js';

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
  amount: z.number().positive('Proforma amount must be positive'),
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

    const pdf = await generateProformaPdf(id, orgId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${proforma.number.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
  } catch (error) {
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
    const { companyId, sourceType, sourceId, milestoneId, amount, billingName, billingContactName, billingAddress, gstin, gstApplicable, gstRatePercent, description, poNumber, poDate, sacCode, terms } = parsed.data;

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

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { defaultProformaValidityDays: true } });
    const validDays = parsed.data.validDays ?? org?.defaultProformaValidityDays ?? 30;

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
            amount,
            raisedAt,
            validTill,
            status: ProformaStatus.UNPAID,
            billingName: billingName.trim(),
            billingContactName: billingContactName ? billingContactName.trim() : null,
            billingAddress: billingAddress ? billingAddress.trim() : null,
            gstin: gstin ? gstin.trim() : null,
            gstApplicable,
            gstRatePercent,
            description: description ? description.trim() : null,
            poNumber: poNumber ? poNumber.trim() : null,
            poDate: poDate ?? null,
            sacCode: sacCode ? sacCode.trim() : null,
            terms,
          },
        });

        // If source is a proposal, auto update proposal stage to PROFORMA_ISSUED
        if (sourceType === ProformaSourceType.PROPOSAL) {
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
            payload: { number: nextNumber, amount, billingName },
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

    const { amount, raisedAt, validDays, billingName, billingContactName, billingAddress, gstin, gstApplicable, gstRatePercent, description, poNumber, poDate, sacCode, terms } = parsed.data;

    // validTill is stored as an absolute date, not a day-count, so moving the
    // issue date has to recompute it. If validDays wasn't sent alongside a new
    // raisedAt, preserve however many days validity the document already had
    // rather than leaving validTill stranded relative to the old issue date.
    const effectiveRaisedAt = raisedAt ?? existing.raisedAt;
    const existingValidDays = Math.round((existing.validTill.getTime() - existing.raisedAt.getTime()) / 86400000);
    const effectiveValidDays = validDays ?? (raisedAt !== undefined ? existingValidDays : undefined);

    const proforma = await prisma.proforma.update({
      where: { id },
      data: {
        ...(amount !== undefined ? { amount } : {}),
        ...(raisedAt !== undefined ? { raisedAt } : {}),
        ...(effectiveValidDays !== undefined
          ? { validTill: new Date(effectiveRaisedAt.getTime() + effectiveValidDays * 24 * 3600 * 1000) }
          : {}),
        ...(billingName !== undefined ? { billingName: billingName.trim() } : {}),
        ...(billingContactName !== undefined ? { billingContactName: billingContactName ? billingContactName.trim() : null } : {}),
        ...(billingAddress !== undefined ? { billingAddress: billingAddress ? billingAddress.trim() : null } : {}),
        ...(gstin !== undefined ? { gstin: gstin ? gstin.trim() : null } : {}),
        ...(gstApplicable !== undefined ? { gstApplicable } : {}),
        ...(gstRatePercent !== undefined ? { gstRatePercent } : {}),
        ...(description !== undefined ? { description: description ? description.trim() : null } : {}),
        ...(poNumber !== undefined ? { poNumber: poNumber ? poNumber.trim() : null } : {}),
        ...(poDate !== undefined ? { poDate } : {}),
        ...(sacCode !== undefined ? { sacCode: sacCode ? sacCode.trim() : null } : {}),
        ...(terms !== undefined ? { terms } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Proforma',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'proforma_edited',
        payload: { fields: Object.keys(parsed.data) },
      },
    });

    res.json({ success: true, proforma });
  } catch (error) {
    next(error);
  }
});
