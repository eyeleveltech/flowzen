/**
 * Engagements, invoices, payments and expenses.
 *
 * Money is the one real dividing line in an agency — deals, clients, projects and
 * workload are all more useful shared than guarded (master plan §3.10). So the
 * whole of this router sits behind ADMIN, except the engagement reads a Manager
 * needs to deliver against.
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, param, requireRole, requireModule, type AuthRequest } from '../middleware/auth.js';
import {
  calculateMrr,
  changeTerms,
  findNeedingAttention,
  isRolling,
  monthlyValue,
  pauseEngagement,
  resumeEngagement,
  endEngagement,
} from '../services/engagement.service.js';
import {
  findDueForBilling,
  raiseInvoiceForEngagement,
  recordPayment,
  refreshInvoiceStatus,
  revenueSummary,
  isOverdue,
  statusFromPayments,
} from '../services/invoice.service.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { generateInvoicePdf } from '../services/pdf.service.js';
import { storage } from '../services/storage.js';
import { TaxConfigurationError } from '../utils/tax.js';

export const revenueRouter = Router();

revenueRouter.use(authenticate, requireModule('REVENUE'));

const handleTaxError = (e: unknown, res: Response, next: NextFunction) => {
  if (e instanceof TaxConfigurationError) {
    // Not a server error — a setting is missing, and the message says which.
    res.status(422).json({ success: false, error: e.message, code: e.code });
    return;
  }
  next(e);
};

// ── Engagements ──────────────────────────────────────────────────────────────
//
// **What a client pays** is readable from Sales upward (§3.10). A Manager cannot
// run delivery blind to the number, and a salesperson wrote the quote, so they
// already know it — hiding it from them protects nothing and makes them ask.
//
// What stays behind Admin is what has been BILLED and COLLECTED: invoices,
// payments and the agency's totals. That is the boundary, and it is enforced
// route by route below rather than on the router, because this file straddles it.

revenueRouter.get('/engagements', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const engagements = await prisma.engagement.findMany({
      where: {
        organizationId: orgId,
        ...(req.query.status ? { status: req.query.status as never } : {}),
      },
      include: {
        company: { select: { id: true, name: true, status: true } },
        deal: { select: { id: true, title: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    res.json({
      success: true,
      data: engagements.map((e) => ({
        ...e,
        monthlyValue: monthlyValue(e.amount, e.billingFrequency).toString(),
        // A blank end date is not missing data — it means the engagement runs
        // until somebody stops it (§3.6).
        isRolling: isRolling(e),
      })),
    });
  } catch (e) {
    next(e);
  }
});

revenueRouter.get('/engagements/attention', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const within = Number(req.query.days ?? 30);
    const { expiring, dueForReview } = await findNeedingAttention(req.user!.organizationId, within);

    res.json({
      success: true,
      data: {
        // Fixed-term work expires and needs a renew-or-not decision.
        expiring,
        // Rolling work never does, so the question asked of it is different:
        // should this still be this price? (§4.10)
        dueForReview,
      },
    });
  } catch (e) {
    next(e);
  }
});

const termsInput = z.object({
  amount: z.union([z.number(), z.string()]).optional(),
  billingFrequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']).optional(),
  effectiveFrom: z.coerce.date().optional(),
  reason: z.string().min(1, 'A reason is required — it becomes the price history.'),
});

/** Every commercial change writes a revision. The old price is never overwritten. */
revenueRouter.post('/engagements/:id/terms', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = termsInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const engagement = await prisma.engagement.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!engagement) {
      res.status(404).json({ success: false, error: 'Engagement not found' });
      return;
    }
    res.json({ success: true, data: await changeTerms(engagement.id, parsed.data, req.user!.userId) });
  } catch (e) {
    next(e);
  }
});

/**
 * Pausing a CLIENT stops real money — unlike parking a deal, which stops nothing.
 * One gesture must never do both (§4.11).
 */
revenueRouter.post('/engagements/:id/pause', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const engagement = await prisma.engagement.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true, companyId: true },
    });
    if (!engagement) {
      res.status(404).json({ success: false, error: 'Engagement not found' });
      return;
    }

    // Before freezing anything, check whether this company has other live work —
    // pausing one of two engagements does not pause the customer.
    const others = await prisma.engagement.count({
      where: { companyId: engagement.companyId, status: 'ACTIVE', id: { not: engagement.id } },
    });

    const result = await pauseEngagement(
      engagement.id,
      req.body?.reason ?? 'Paused',
      req.user!.userId,
    );
    res.json({
      success: true,
      data: result,
      message: others > 0 ? `This company still has ${others} other engagement(s) running.` : undefined,
    });
  } catch (e) {
    next(e);
  }
});

revenueRouter.post('/engagements/:id/resume', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const engagement = await prisma.engagement.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!engagement) {
      res.status(404).json({ success: false, error: 'Engagement not found' });
      return;
    }
    res.json({
      success: true,
      data: await resumeEngagement(engagement.id, req.body?.reason ?? 'Resumed', req.user!.userId),
    });
  } catch (e) {
    next(e);
  }
});

revenueRouter.post('/engagements/:id/end', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const engagement = await prisma.engagement.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!engagement) {
      res.status(404).json({ success: false, error: 'Engagement not found' });
      return;
    }
    const on = req.body?.on ? new Date(req.body.on) : undefined;
    res.json({
      success: true,
      data: await endEngagement(engagement.id, req.body?.reason ?? 'Ended', req.user!.userId, on),
    });
  } catch (e) {
    next(e);
  }
});

// ── Invoices ─────────────────────────────────────────────────────────────────

/** What is due to be billed. Surfaced, not raised — a person creates the invoice. */
revenueRouter.get('/billing/due', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const due = await findDueForBilling(req.user!.organizationId);
    res.json({ success: true, data: due });
  } catch (e) {
    next(e);
  }
});

revenueRouter.get('/invoices/:id/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      select: { id: true, pdfKey: true },
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    let key = invoice.pdfKey;
    if (!key) {
      // Generate and store it
      const pdfBuffer = await generateInvoicePdf(invoice.id);
      key = await storage.upload('invoice', pdfBuffer);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { pdfKey: key },
      });
    }

    const filePath = await storage.getUrl(key);
    res.download(filePath, `Invoice-${invoice.id.slice(-6)}.pdf`);
  } catch (e) {
    next(e);
  }
});

revenueRouter.post('/engagements/:id/invoice', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const engagement = await prisma.engagement.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!engagement) {
      res.status(404).json({ success: false, error: 'Engagement not found' });
      return;
    }

    const invoice = await raiseInvoiceForEngagement(engagement.id, req.user!.userId, {
      issueDate: req.body?.issueDate ? new Date(req.body.issueDate) : undefined,
      dueInDays: req.body?.dueInDays,
      taxRatePercent: req.body?.taxRatePercent,
    });
    res.status(201).json({ success: true, data: invoice });
  } catch (e) {
    handleTaxError(e, res, next);
  }
});

revenueRouter.get('/invoices', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.companyId ? { companyId: String(req.query.companyId) } : {}),
      },
      include: {
        company: { select: { id: true, name: true } },
        payments: { select: { id: true, amount: true, paidOn: true } },
      },
      orderBy: { issueDate: 'desc' },
      take: 200,
    });

    const now = new Date();
    res.json({
      success: true,
      data: invoices.map((inv) => {
        const paid = inv.payments.reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0));
        return {
          ...inv,
          paid: paid.toString(),
          balance: inv.total.sub(paid).toString(),
          // Never stored. It is sent, unpaid and past due — worked out on the
          // spot, so it cannot be wrong the night a job fails (§3.8).
          isOverdue: isOverdue(inv, now),
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

/** Sending freezes the document. From here it is voided and credited, never edited. */
revenueRouter.post('/invoices/:id/send', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      include: { payments: true },
    });
    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }
    if (invoice.status !== 'DRAFT') {
      res.status(422).json({ success: false, error: 'Only a draft invoice can be sent.' });
      return;
    }

    const paid = invoice.payments.reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0));
    const nextStatus = statusFromPayments(invoice.total, paid, 'SENT');

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: nextStatus, sentAt: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

const paymentInput = z.object({
  companyId: z.string().min(1),
  invoiceId: z.string().optional().nullable(),
  amount: z.union([z.number(), z.string()]),
  paidOn: z.coerce.date(),
  method: z.enum(['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER']).optional(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * Record money arriving.
 *
 * `invoiceId` is optional so an advance can be recorded before any invoice exists
 * — a client paying 50% up front is normal (§3.8).
 */
revenueRouter.post('/payments', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = paymentInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { currency: true },
    });

    const payment = await recordPayment(
      { ...parsed.data, organizationId: orgId, currency: org.currency },
      req.user!.userId,
    );
    res.status(201).json({ success: true, data: payment });
  } catch (e) {
    next(e);
  }
});

// ── The numbers ──────────────────────────────────────────────────────────────

/**
 * GET /revenue/summary
 *
 * MRR, billed and collected are three separate numbers, and none is derived from
 * another. A month can look excellent on the first and be empty on the third
 * (§3.8).
 */
revenueRouter.get('/summary', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(String(req.query.to)) : now;

    const [mrr, summary, expenseAgg] = await Promise.all([
      calculateMrr(orgId),
      revenueSummary(orgId, from, to),
      prisma.expense.aggregate({
        where: { organizationId: orgId, date: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
    ]);

    const expenses = expenseAgg._sum.amount ?? new Prisma.Decimal(0);
    const grossMargin = summary.billed.sub(expenses);

    res.json({
      success: true,
      data: {
        mrr: mrr.toString(),
        billed: summary.billed.toString(),
        collected: summary.collected.toString(),
        outstanding: summary.outstanding.toString(),
        overdue: summary.overdue.toString(),
        expenses: expenses.toString(),
        grossMargin: grossMargin.toString(),
        period: { from, to },
      },
    });
  } catch (e) {
    next(e);
  }
});
