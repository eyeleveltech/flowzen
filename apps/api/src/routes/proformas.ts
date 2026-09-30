import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAnyPermission, type AuthRequest } from '../middleware/auth.js';
import { ProformaStatus } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';
import { generateDocumentPdf } from '../services/documentPdf.js';
import {
  issueProforma,
  monthCardRefusal,
  monthName,
  proformaCreateSchema,
  ProformaRefusal,
} from '../services/proformaIssue.js';
import {
  documentEmailDefaults,
  documentEmailSchema,
  sendDocumentEmail,
} from '../services/documentEmail.js';
import { buildDocumentSnapshot } from '../services/documentModel.js';
import { documentFieldsSchema, cleanCustomFields, ORG_DOCUMENT_SELECT } from '../utils/documentSchemas.js';

export const proformasRouter = Router();

proformasRouter.use(authenticate);

/*
 * Who may touch a proforma: selling (`pipeline.*`), or Accounts
 * (`money.figures`).
 *
 * It was pipeline only, which fitted when a proforma came off a proposal. But
 * every retainer month is billed with one now, and billing is Accounts' job —
 * who hold no pipeline switch, and so could not raise, download, send or
 * cancel the one document their month-end is made of.
 */

// ── 1. List Proformas Register ──────────────────────────────────────────────

proformasRouter.get('/', requireAnyPermission('pipeline.read', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
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
          /*
           * What it asks to be paid FOR.
           *
           * A proforma comes from a proposal or from a project's billing
           * milestone, and a list of them that cannot say which is a list of
           * numbers with no way to tell the advance on a website build from
           * the quote for a retainer.
           */
          milestone: { select: { id: true, label: true, project: { select: { id: true, name: true } } } },
        },
      }),
      prisma.proforma.count({ where }),
    ]);

    /*
     * And the retainer month, for the ones that bill one.
     *
     * `sourceId` is a polymorphic pointer rather than a relation, so it cannot
     * be included; the months are looked up in one query and attached, so the
     * register can say "Retainer · October 2026" instead of nothing.
     */
    const cardIds = proformas.filter((pf) => pf.sourceType === 'MONTH_CARD').map((pf) => pf.sourceId);
    const cards = cardIds.length
      ? await prisma.monthCard.findMany({
          where: { id: { in: cardIds }, retainer: { organizationId: orgId } },
          select: { id: true, month: true, retainerId: true },
        })
      : [];
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const withMonths = proformas.map((pf) => ({
      ...pf,
      monthCard: pf.sourceType === 'MONTH_CARD' ? (cardById.get(pf.sourceId) ?? null) : null,
    }));

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
      proformas: withMonths,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. Generate Sequential Proforma ─────────────────────────────────────────
//
// The schema and the work are in services/proformaIssue.ts, shared with the
// retainer batch below.

// ── 1b. Download Proforma PDF ───────────────────────────────────────────────
//
// Gated the same as the register itself (pipeline.read) — a BD user needs
// to be able to hand this document to a client, and a proforma amount is a
// deal value they're already entitled to see per §9.

proformasRouter.get('/:id/pdf', requireAnyPermission('pipeline.read', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
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

proformasRouter.get('/:id', requireAnyPermission('pipeline.read', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
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

proformasRouter.get('/:id/email', requireAnyPermission('pipeline.read', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
  try {
    const defaults = await documentEmailDefaults('PROFORMA', String(req.params.id), req.user!.organizationId);
    res.json({ success: true, ...defaults });
  } catch (error) {
    next(error);
  }
});

proformasRouter.post('/:id/email', requireAnyPermission('pipeline.write', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
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

proformasRouter.post('/', requireAnyPermission('pipeline.write', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = proformaCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const proforma = await issueProforma(req.user!.organizationId, req.user!.userId, parsed.data);
    res.status(201).json({ success: true, proforma });
  } catch (error) {
    if (error instanceof ProformaRefusal) {
      res.status(error.status).json({ success: false, error: error.message });
      return;
    }
    next(error);
  }
});

// ── 2b. A month's proformas, for every retainer at once ──────────────────────
//
// The first of the month is one job — every retainer billed in advance wants
// its proforma — and doing it one client at a time is how the fourth one gets
// forgotten. Each month is raised exactly as the single form would raise it,
// filled from what Flowzen already knows: the client's billing details, the
// month's fee and the retainer's GST rate.
//
// Each month stands alone. One that cannot be raised — already invoiced,
// already asked for, a GST rate a proforma cannot carry — is skipped and said
// so, and the rest still go out. Stopping the lot over one would mean nobody
// is billed because of somebody else's paperwork.

const retainerBatchSchema = z.object({
  monthCardIds: z.array(z.string().min(1)).min(1, 'Choose at least one month').max(200),
});

proformasRouter.post('/retainer-months', requireAnyPermission('pipeline.write', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = retainerBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const ids = [...new Set(parsed.data.monthCardIds)];

    const [org, cards] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { sacCodes: true } }),
      prisma.monthCard.findMany({
        where: { id: { in: ids }, retainer: { organizationId: orgId } },
        select: {
          id: true,
          month: true,
          revenue: true,
          retainer: {
            select: {
              gstPercent: true,
              company: {
                select: {
                  id: true,
                  name: true,
                  // Who pays: the contact marked Payer, if there is one.
                  people: { where: { role: 'PAYER' }, select: { name: true }, take: 1 },
                },
              },
            },
          },
        },
      }),
    ]);
    const sac = org?.sacCodes?.[0] ?? '';

    const created: { monthCardId: string; proformaId: string; number: string; companyName: string }[] = [];
    const skipped: { monthCardId: string; companyName: string; reason: string }[] = [];

    for (const id of ids) {
      const card = cards.find((c) => c.id === id);
      if (!card) {
        skipped.push({ monthCardId: id, companyName: '—', reason: 'That retainer month was not found' });
        continue;
      }
      const company = card.retainer.company;
      const fee = Number(card.revenue);
      if (!(fee > 0)) {
        skipped.push({ monthCardId: id, companyName: company.name, reason: 'The month has no fee to bill' });
        continue;
      }
      /*
       * The retainer's own GST rate. None recorded is taken as the standard
       * 18% — the screen says so before anything is raised — and 0% is a
       * client billed without GST. A proforma carries at most 28%.
       */
      const rate = card.retainer.gstPercent == null ? 18 : Number(card.retainer.gstPercent);
      if (rate > 28) {
        skipped.push({
          monthCardId: id,
          companyName: company.name,
          reason: `The retainer's GST rate is ${rate}% — a proforma carries 28% at most. Raise it by hand.`,
        });
        continue;
      }

      const check = await monthCardRefusal(orgId, company.id, id);
      if (check instanceof ProformaRefusal) {
        skipped.push({ monthCardId: id, companyName: company.name, reason: check.message });
        continue;
      }

      try {
        // Through the same schema the form's request passes, so a batch proforma
        // is held to exactly the rules a hand-raised one is.
        const pf = await issueProforma(orgId, req.user!.userId, proformaCreateSchema.parse({
          companyId: company.id,
          sourceType: 'MONTH_CARD',
          sourceId: id,
          billingName: company.name,
          billingContactName: company.people[0]?.name ?? '',
          gstApplicable: rate > 0,
          gstRatePercent: rate,
          lineItems: [
            {
              particulars: `Retainer fee — ${monthName(card.month)}`,
              units: 1,
              unitCost: fee,
              hsnSac: sac || null,
            },
          ],
          terms: 'Advance payment request. Payment due within validity period. GST applicable as per statutory rates.',
        }));
        created.push({ monthCardId: id, proformaId: pf.id, number: pf.number, companyName: company.name });
      } catch (e) {
        if (e instanceof ProformaRefusal) {
          skipped.push({ monthCardId: id, companyName: company.name, reason: e.message });
          continue;
        }
        throw e;
      }
    }

    res.status(created.length > 0 ? 201 : 200).json({ success: true, created, skipped });
  } catch (error) {
    next(error);
  }
});

// ── 3. Update Proforma Status ───────────────────────────────────────────────

proformasRouter.patch('/:id/status', requireAnyPermission('pipeline.write', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
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

proformasRouter.patch('/:id', requireAnyPermission('pipeline.write', 'money.figures'), async (req: AuthRequest, res: Response, next) => {
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
