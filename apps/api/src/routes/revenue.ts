import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { emitToOrganization } from '../sse.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { generateQuotePdf } from '../services/quotePdf.service.js';
import { generateDocNumber, computeQuoteFinancials } from '../utils/quote.js';

export const revenueRouter = Router();

export const paymentSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  contractId: z.string().optional(),
  subscriptionId: z.string().optional(), // realizes retainer (recurring) revenue (FZ-032)
  amount: z.number().positive('Amount must be greater than zero'),
  paidOn: z.string()
    .refine((d) => !isNaN(Date.parse(d)), 'Invalid paidOn date')
    // Allow up to 24h of clock skew, but no genuinely future-dated payments (they'd distort
    // paidThisMonth / receivables / trends).
    .refine((d) => Date.parse(d) <= Date.now() + 86400000, 'paidOn cannot be in the future'),
  method: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['PENDING', 'PARTIAL', 'PAID', 'REFUNDED']).optional(),
  currency: z.string().length(3).optional(),
});

export const contractSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  title: z.string().min(1, 'Title is required'),
  value: z.number().nonnegative('Value cannot be negative'),
  advanceAmount: z.number().nonnegative('Advance cannot be negative').optional(),
  billingFrequency: z.string().optional(),
  startDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid start date'),
  endDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid end date').optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED']).optional(),
  notes: z.string().optional(),
  currency: z.string().length(3).optional(),
}).refine((d) => !d.endDate || Date.parse(d.endDate) >= Date.parse(d.startDate), {
  message: 'End date cannot be before start date', path: ['endDate'],
});

export const subscriptionSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  contractId: z.string().optional(),
  amount: z.number().nonnegative('Amount cannot be negative'),
  billingFrequency: z.string().optional(),
  taxIncluded: z.boolean().optional(),
  startDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid start date'),
  nextBillingDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid next billing date').optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED']).optional(),
  notes: z.string().optional(),
  currency: z.string().length(3).optional(),
});

const invoiceStatusSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'CANCELLED'], {
    message: 'Invalid status value',
  }),
});

export const expenseSchema = z.object({
  amount: z.number().positive('Amount must be greater than zero'),
  category: z.enum(['VENDOR', 'TRAVEL', 'EQUIPMENT', 'MARKETING', 'MISC'], {
    message: 'Invalid expense category',
  }),
  date: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid expense date'),
  vendor: z.string().optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  description: z.string().optional(),
  currency: z.string().length(3).optional(),
});
// Guard against cross-tenant IDOR: a revenue record may only reference a client / contract /
// project that belongs to the caller's own organization. Returns an error message to send as
// 400, or null when every supplied reference checks out. Only truthy ids are validated (a
// Prisma `id: undefined` filter would match ANY row in the org, so callers must pass real ids).
async function assertOrgRefs(
  orgId: string,
  refs: { clientId?: string | null; contractId?: string | null; projectId?: string | null; subscriptionId?: string | null },
): Promise<string | null> {
  if (refs.clientId) {
    const ok = await prisma.client.findFirst({ where: { id: refs.clientId, organizationId: orgId }, select: { id: true } });
    if (!ok) return 'Client not found in your organization';
  }
  if (refs.contractId) {
    const ok = await prisma.contract.findFirst({ where: { id: refs.contractId, organizationId: orgId }, select: { id: true } });
    if (!ok) return 'Contract not found in your organization';
  }
  if (refs.subscriptionId) {
    // Scope by client too when given, so a payment can't be booked against another client's sub.
    const ok = await prisma.subscription.findFirst({
      where: { id: refs.subscriptionId, organizationId: orgId, ...(refs.clientId ? { clientId: refs.clientId } : {}) },
      select: { id: true },
    });
    if (!ok) return 'Subscription not found in your organization';
  }
  if (refs.projectId) {
    const ok = await prisma.project.findFirst({ where: { id: refs.projectId, client: { organizationId: orgId } }, select: { id: true } });
    if (!ok) return 'Project not found in your organization';
  }
  return null;
}

// Normalize a recurring billing frequency to its monthly figure so MRR is comparable across
// cadences. Non-recurring (ONE_TIME) and any UNRECOGNISED frequency contribute 0 — MRR is
// recurring revenue only, so a one-off amount (or a garbage value) must never inflate it.
export const toMonthlyAmount = (amount: number, freq: string | null | undefined): number => {
  switch ((freq || 'MONTHLY').toUpperCase()) {
    case 'YEARLY':
    case 'ANNUAL':
    case 'ANNUALLY': return amount / 12;
    case 'HALF_YEARLY':
    case 'SEMI_ANNUAL':
    case 'BIANNUAL': return amount / 6;
    case 'QUARTERLY': return amount / 3;
    case 'MONTHLY': return amount;
    case 'WEEKLY': return amount * 4.33;
    case 'DAILY': return amount * 30;
    // ONE_TIME / ONETIME and anything else are non-recurring → 0 MRR.
    default: return 0;
  }
};

// The single definition of "what counts as a receivable", shared by the Overview total and the
// dedicated Receivables screen so the two can never report different numbers (FZ-039). A
// receivable is an ACTIVE contract; retainer contracts already tracked as MRR via Subscriptions
// are excluded so receivables and MRR don't double-count the same money.
export async function receivableContracts(orgId: string) {
  const contracts = await prisma.contract.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    include: {
      client: { select: { name: true, company: true } },
      payments: { where: { status: 'PAID' } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return contracts.filter(
    (c) => !(c.notes?.includes('Linked to Retainer Subscription') && c.billingFrequency === 'MONTHLY'),
  );
}
export const contractPaid = (c: { payments?: { amount: unknown }[] }) =>
  (c.payments ?? []).reduce((acc, p) => acc + Number(p.amount), 0);

// ============================================================================
// Overview & Dashboards
// ============================================================================

revenueRouter.get('/overview', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    // Exclusive upper bound = start of next month, so payments made on the last
    // calendar day of the month are included (a `lte last-day-midnight` drops them).
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const payments = await prisma.payment.findMany({
      where: {
        organizationId: orgId,
        paidOn: { gte: firstDay, lt: nextMonth },
        status: 'PAID'
      },
      include: { client: { select: { name: true, company: true } } },
      orderBy: { paidOn: 'desc' }
    });
    const paidThisMonth = payments.reduce((acc, p) => acc + Number(p.amount), 0);

    const subs = await prisma.subscription.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' }
    });
    const mrr = subs.reduce((acc, s) => acc + toMonthlyAmount(Number(s.amount), s.billingFrequency), 0);

    // Same source as the Receivables screen (see receivableContracts) so totals always agree.
    const activeContracts = await receivableContracts(orgId);
    let receivables = 0;
    for (const c of activeContracts) {
      receivables += Math.max(0, Number(c.value) - contractPaid(c));
    }
    
    // Trend Calculation Helper
    const calculateTrend = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? '+100.0%' : '0%';
      const pct = ((current - previous) / previous) * 100;
      return (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
    };

    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // 1. Paid Trend  (last month = [firstDayLastMonth, firstDay) — exclusive upper bound)
    const paymentsLastMonth = await prisma.payment.findMany({
      where: {
        organizationId: orgId,
        paidOn: { gte: firstDayLastMonth, lt: firstDay },
        status: 'PAID'
      }
    });
    const paidLastMonth = paymentsLastMonth.reduce((acc, p) => acc + Number(p.amount), 0);
    const paidTrend = calculateTrend(paidThisMonth, paidLastMonth);

    // 2. MRR Trend (approx. using Subscriptions created before this month)
    const mrrLastMonth = subs.filter(s => s.createdAt < firstDay)
      .reduce((acc, s) => acc + toMonthlyAmount(Number(s.amount), s.billingFrequency), 0);
    const mrrTrend = calculateTrend(mrr, mrrLastMonth);

    // 3. Receivables Trend
    let receivablesLastMonth = 0;
    const contractsLastMonth = activeContracts.filter(c => c.createdAt < firstDay);
    for (const c of contractsLastMonth) {
      const paidBeforeThisMonth = c.payments.filter(p => p.paidOn && p.paidOn < firstDay).reduce((acc, p) => acc + Number(p.amount), 0);
      receivablesLastMonth += Math.max(0, Number(c.value) - paidBeforeThisMonth);
    }
    const receivablesTrend = calculateTrend(receivables, receivablesLastMonth);

    res.json({
      paidThisMonth,
      paidTrend,
      mrr,
      mrrTrend,
      receivables,
      receivablesTrend,
      recentPayments: payments.slice(0, 5)
    });
  } catch (err: any) {
    next(err); // central handler maps Prisma errors and never leaks err.message (FZ-022/074)
  }
});

revenueRouter.get('/pnl', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) {
      res.json([]);
      return;
    }

    const { startDate, endDate } = req.query;

    let paymentDateFilter = {};
    let expenseDateFilter = {};
    let timeEntryDateFilter = {};

    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        paymentDateFilter = { paidOn: { gte: start, lte: end } };
        expenseDateFilter = { date: { gte: start, lte: end } };
        timeEntryDateFilter = { date: { gte: start, lte: end } };
      }
    }
    
    // Fetch clients for this org to find their projects
    const clients = await prisma.client.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, company: true }
    });
    const clientMap = new Map(clients.map(c => [c.id, c]));
    const clientIds = clients.map(c => c.id);

    const projects = clientIds.length > 0
      ? await prisma.project.findMany({
          where: { clientId: { in: clientIds } },
          select: { id: true, name: true, clientId: true }
        })
      : [];
    
    const projectIds = projects.map(p => p.id);
    
    // Fetch expenses for these projects
    const expenses = projectIds.length > 0
      ? await prisma.expense.findMany({
          where: { projectId: { in: projectIds }, ...expenseDateFilter }
        })
      : [];

    const timeEntries = projectIds.length > 0
      ? await prisma.timeEntry.findMany({
          where: { projectId: { in: projectIds }, ...timeEntryDateFilter },
          select: { projectId: true, hours: true, costRate: true },
        })
      : [];

    const labourByProject = new Map<string, { hours: number; cost: number }>();
    for (const t of timeEntries) {
      if (!t.projectId) continue;
      const b = labourByProject.get(t.projectId) || { hours: 0, cost: 0 };
      const hoursNum = Number(t.hours) || 0;
      const costRateNum = Number(t.costRate) || 0;
      b.hours += hoursNum;
      b.cost += hoursNum * costRateNum;
      labourByProject.set(t.projectId, b);
    }

    // To get revenue, we will fetch contracts per client
    const contracts = clientIds.length > 0
      ? await prisma.contract.findMany({
          where: { organizationId: orgId, clientId: { in: clientIds } },
          include: { payments: { where: { status: 'PAID', ...paymentDateFilter } } }
        })
      : [];

    const projectCountByClient = new Map<string, number>();
    for (const p of projects) {
      if (p.clientId) projectCountByClient.set(p.clientId, (projectCountByClient.get(p.clientId) || 0) + 1);
    }

    const result = projects.map(p => {
      const projExpenses = expenses.filter(e => e.projectId === p.id);
      const totalExpenses = projExpenses.reduce((acc: number, e: any) => acc + (Number(e.amount) || 0), 0);

      const projectContracts = contracts.filter(c => c.clientId === p.clientId);
      const clientRevenue = projectContracts.reduce((acc: number, c: any) => {
        const pmts = Array.isArray(c.payments) ? c.payments : [];
        return acc + pmts.reduce((pAcc: number, pmt: any) => pAcc + (Number(pmt.amount) || 0), 0);
      }, 0);

      const projectsForClient = Math.max(1, projectCountByClient.get(p.clientId) || 1);
      const revenue = clientRevenue / projectsForClient;

      const client = clientMap.get(p.clientId);
      const labour = labourByProject.get(p.id) || { hours: 0, cost: 0 };

      const revNum = isNaN(revenue) ? 0 : Number(revenue.toFixed(2));
      const expNum = isNaN(totalExpenses) ? 0 : Number(totalExpenses.toFixed(2));
      const labourCostNum = isNaN(labour.cost) ? 0 : Number(labour.cost.toFixed(2));
      const netNum = Number((revNum - expNum - labourCostNum).toFixed(2));

      return {
        projectId: p.id,
        projectName: p.name || 'Untitled Project',
        clientName: client?.company || client?.name || 'Unknown Client',
        revenue: revNum,
        expenses: expNum,
        labourHours: isNaN(labour.hours) ? 0 : Number(labour.hours.toFixed(1)),
        labourCost: labourCostNum,
        net: isNaN(netNum) ? 0 : netNum
      };
    });

    res.json(result);
  } catch (err: any) {
    next(err);
  }
});

// ============================================================================
// 1. Invoice Drafts
// ============================================================================

revenueRouter.get('/invoice-drafts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const drafts = await prisma.invoiceDraft.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        client: { select: { name: true, company: true } },
        quote: { select: { documentNumber: true } }
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(drafts);
  } catch (err: any) {
    next(err); // central handler maps Prisma errors and never leaks err.message (FZ-022/074)
  }
});

revenueRouter.post('/invoice-drafts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Note: client-sent grandTotal / tax / lineItems / draftNumber are intentionally NOT read
    // here — an invoice must never bill an amount the browser posted. Everything financial is
    // inherited from the ACCEPTED source quote below.
    const { quoteId, clientId, clientName, notes } = req.body;

    const orgId = req.user!.organizationId;
    // Check the quote exists IN THIS ORG and is ACCEPTED (no cross-tenant quote read); pull its
    // server-authoritative financials and line items to copy onto the draft.
    const quote = await prisma.quoteDocument.findFirst({
      where: { id: quoteId, organizationId: orgId },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.status !== 'ACCEPTED') return res.status(400).json({ error: 'Quote must be ACCEPTED to generate an invoice draft' });

    // The client must belong to the caller's org and not be archived.
    const clientOk = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId, archivedAt: null }, select: { id: true } });
    if (!clientOk) return res.status(400).json({ error: 'Client not found in your organization' });

    const generatedDraftNumber = await generateDocNumber(orgId, 'INV');

    // Faithful snapshot of the accepted quote's line items so the draft matches the quote (and
    // its totals) exactly, rather than trusting whatever the client posted.
    const lineItemsSnapshot = quote.lineItems.map((li) => ({
      description: li.description, unit: li.unit, quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice), discountPct: Number(li.discountPct),
      taxType: li.taxType, taxPct: Number(li.taxPct), amount: Number(li.amount),
    }));

    const draft = await prisma.invoiceDraft.create({
      data: {
        organizationId: orgId,
        quoteId,
        draftNumber: generatedDraftNumber,
        clientId,
        clientName,
        lineItems: lineItemsSnapshot,
        // Financials inherited from the ACCEPTED quote — server-authoritative, tax fields included.
        untaxedAmount: quote.untaxedAmount,
        cgst: quote.cgst,
        sgst: quote.sgst,
        igst: quote.igst,
        totalTax: quote.totalTax,
        grandTotal: quote.grandTotal,
        notes,
        status: 'DRAFT',
        // Currency snapshot: carried forward from the quote (which inherited from the client at creation)
        currency: (quote as any).currency ?? 'INR',
      },
      include: {
        client: { select: { name: true, company: true } },
        quote: { select: { documentNumber: true } }
      }
    });
    
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:invoice-draft-created', draft);
    res.status(201).json(draft);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'An invoice draft already exists for this quote' });
      return;
    }
    next(err);
  }
});

revenueRouter.put('/invoice-drafts/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Client-sent totals/tax are ignored — recomputed server-side from the line items below.
    const { lineItems, notes } = req.body;

    // Only allow editing if status is DRAFT
    const existing = await prisma.invoiceDraft.findUnique({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId }
    });

    if (!existing) return res.status(404).json({ error: 'Invoice draft not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only DRAFT invoices can be edited' });
    }

    // Recompute every total from the submitted line items so the draft can never bill an amount
    // the browser posted (FZ-036). Line amounts are normalised to the computed values too.
    const items = Array.isArray(lineItems) ? lineItems : [];
    const fin = computeQuoteFinancials(items);
    const normalizedItems = items.map((it: any, i: number) => ({ ...it, amount: fin.lineAmounts[i] }));

    const draft = await prisma.invoiceDraft.update({
      where: { id: req.params.id as string },
      data: {
        lineItems: normalizedItems,
        untaxedAmount: fin.untaxedAmount,
        cgst: fin.cgst,
        sgst: fin.sgst,
        igst: fin.igst,
        totalTax: fin.totalTax,
        grandTotal: fin.grandTotal,
        notes
      },
      include: {
        client: { select: { name: true, company: true } },
        quote: { select: { documentNumber: true } }
      }
    });

    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:invoice-draft-updated', draft);
    res.json(draft);
  } catch (err: any) {
    next(err);
  }
});
// Legal invoice status transitions. Forward-only: once an invoice is SENT it can never return to
// DRAFT (which is the only editable state), and PAID / CANCELLED are terminal. This is what stops
// a paid invoice being flipped back to DRAFT and silently rewritten (FZ-037).
export const INVOICE_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SENT', 'PAID', 'OVERDUE', 'CANCELLED'], // forward to anything; never back to DRAFT
  SENT: ['PAID', 'OVERDUE', 'CANCELLED'],
  OVERDUE: ['PAID', 'CANCELLED'],
  PAID: [],       // terminal
  CANCELLED: [],  // terminal
};

revenueRouter.put('/invoice-drafts/:id/status', validate(invoiceStatusSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    const id = req.params.id as string;
    const existing = await prisma.invoiceDraft.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      select: { status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    if (existing.status !== status) {
      const allowed = INVOICE_STATUS_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Cannot change an invoice from ${existing.status} to ${status}. A sent or paid invoice cannot be reopened or rewritten.`,
        });
      }
    }

    const draft = await prisma.invoiceDraft.update({
      where: { id, organizationId: req.user!.organizationId },
      data: { status },
    });
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:invoice-draft-updated', draft);
    res.json(draft);
  } catch (err: any) {
    next(err);
  }
});

 // Wait, let's fix imports properly at the top. 
// I'll add the route first, then fix imports if needed.

revenueRouter.post('/invoice-drafts/:id/generate-pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const id = req.params.id as string;
    
    const draft = await prisma.invoiceDraft.findFirst({
      where: { id, organizationId: orgId },
      include: {
        client: { select: { address: true, city: true, state: true, billingAddress: true } },
      }
    });
    if (!draft) return res.status(404).json({ error: 'Invoice not found' });
    
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logo: true, address: true, phone: true, website: true, settings: true } });
    
    // Map invoice to quote shape for PDF generator
    const parsedItems: any[] = (typeof draft.lineItems === 'string' ? JSON.parse(draft.lineItems) : (draft.lineItems as any[])) || [];
    const computedUntaxed = parsedItems.reduce((acc: number, item: any) => acc + Number(item.amount || 0), 0);
    const computedTax = parsedItems.reduce((acc: number, item: any) => acc + (Number(item.taxPct) > 0 ? (Number(item.amount) * Number(item.taxPct) / 100) : 0), 0);

    const fakeQuote = {
      ...draft,
      documentType: 'INVOICE',
      documentNumber: draft.draftNumber,
      lineItems: parsedItems,
      // The line-201 draft endpoint doesn't persist untaxedAmount/totalDiscount, so
      // fall back to values computed from the line items (else the PDF Sub Total is ₹0).
      untaxedAmount: Number(draft.untaxedAmount) > 0 ? draft.untaxedAmount : computedUntaxed,
      totalDiscount: (draft as any).totalDiscount ?? 0,
      totalTax: Number(draft.totalTax) > 0 ? draft.totalTax : computedTax,
    };
    
    // We need to import generateQuotePdf dynamically or add it to the top.
    const { generateQuotePdf } = await import('../services/quotePdf.service.js');
    const pdfUrl = await generateQuotePdf(fakeQuote, org);
    
    // Generating the PDF does NOT mark the draft SENT: the PDF is a reference document the
    // user downloads and forwards (corrections §65) — producing it isn't sending it. While the
    // draft stays DRAFT it remains editable and the PDF can be regenerated (same filename, so
    // the download link always serves the latest). SENT is an explicit action via /:id/status,
    // and once SENT the FZ-037 state machine locks it (never back to DRAFT).
    const updated = await prisma.invoiceDraft.update({
      where: { id },
      data: { pdfUrl }
    });
    emitToOrganization(req.app.get('io'), orgId, 'revenue:invoice-draft-updated', updated);
    
    res.json({ pdfUrl });
  } catch (err: any) {
    next(err);
  }
});

// ============================================================================
// 2. Contracts
// ============================================================================

revenueRouter.get('/contracts', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const contracts = await prisma.contract.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        client: { select: { name: true, company: true } },
        // Receivables reads c.payments to compute Paid / Remaining. Without this include it was
        // always undefined, so Paid rendered 0 and every contract looked fully outstanding.
        payments: { where: { status: 'PAID' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(contracts);
  } catch (err: any) {
    next(err);
  }
});

// Outstanding receivables — computed server-side from the same source as the Overview total, so
// the two screens can never disagree (FZ-039). Each row carries Paid / Remaining so the client
// doesn't recompute (and can't drift).
revenueRouter.get('/receivables', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const contracts = await receivableContracts(req.user!.organizationId);
    const items = contracts
      .map((c) => {
        const paid = contractPaid(c);
        return { id: c.id, title: c.title, value: c.value, client: c.client, paid, remaining: Math.max(0, Number(c.value) - paid) };
      })
      .filter((x) => x.remaining > 0);
    const total = items.reduce((acc, x) => acc + x.remaining, 0);
    res.json({ items, total });
  } catch (err: any) {
    next(err);
  }
});

revenueRouter.post('/contracts', validate(contractSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const b = req.body; // validated by contractSchema
    const refErr = await assertOrgRefs(orgId, { clientId: b.clientId });
    if (refErr) return res.status(400).json({ error: refErr });

    // Inherit currency from client when caller doesn't explicitly send one
    let currency = b.currency;
    if (!currency) {
      const client = await prisma.client.findFirst({ where: { id: b.clientId, organizationId: orgId }, select: { currency: true } });
      currency = client?.currency ?? 'INR';
    }

    // Explicit whitelist (FZ-034): no req.body spread, so client-set id/createdAt/tax columns
    // are ignored; server owns those.
    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        clientId: b.clientId,
        title: b.title,
        value: b.value,
        advanceAmount: b.advanceAmount ?? null,
        billingFrequency: b.billingFrequency || 'ONE_TIME',
        startDate: new Date(b.startDate),
        endDate: b.endDate ? new Date(b.endDate) : null,
        status: b.status ?? undefined,
        notes: b.notes ?? null,
        currency,
      },
    });
    emitToOrganization(req.app.get('io'), orgId, 'revenue:contract-created', contract);
    res.status(201).json(contract);
  } catch (err: any) {
    next(err);
  }
});

// ============================================================================
// 3. Payments
// ============================================================================

revenueRouter.get('/payments', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        client: { select: { name: true, company: true } },
        contract: { select: { title: true } },
        subscription: { select: { id: true, notes: true, billingFrequency: true } },
      },
      orderBy: { paidOn: 'desc' },
    });
    res.json(payments);
  } catch (err: any) {
    next(err);
  }
});

revenueRouter.post('/payments', idempotency, validate(paymentSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const b = req.body; // validated by paymentSchema
    const refErr = await assertOrgRefs(orgId, { clientId: b.clientId, contractId: b.contractId, subscriptionId: b.subscriptionId });
    if (refErr) return res.status(400).json({ error: refErr });

    const paidOn = new Date(b.paidOn);

    // Natural-key dedup: this is the money-in path, so a double-submit (a double click, or a
    // retry that carried a fresh idempotency key) must not book the same payment twice. If an
    // identical payment was recorded in the last 2 minutes, return that one instead of creating
    // a duplicate. (The idempotency middleware above already covers same-key retries.)
    const existing = await prisma.payment.findFirst({
      where: {
        organizationId: orgId,
        clientId: b.clientId,
        contractId: b.contractId ?? null,
        subscriptionId: b.subscriptionId ?? null,
        amount: b.amount,
        paidOn,
        reference: b.reference ?? null,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
    });
    if (existing) {
      res.status(200).json(existing);
      return;
    }

    // Explicit whitelist — never spread req.body, so a client can't set id/createdAt or any
    // other column (FZ-034). id/createdAt/updatedAt default on the server.
    //
    // Currency: use whatever the caller sends, or fall back to the linked contract's currency,
    // then to the client's currency, then to 'INR'.
    let currency = b.currency;
    if (!currency) {
      if (b.contractId) {
        const contract = await prisma.contract.findFirst({ where: { id: b.contractId, organizationId: orgId }, select: { currency: true } });
        currency = contract?.currency;
      }
      if (!currency) {
        const client = await prisma.client.findFirst({ where: { id: b.clientId, organizationId: orgId }, select: { currency: true } });
        currency = client?.currency ?? 'INR';
      }
    }
    const payment = await prisma.payment.create({
      data: {
        organizationId: orgId,
        clientId: b.clientId,
        contractId: b.contractId ?? null,
        subscriptionId: b.subscriptionId ?? null,
        amount: b.amount,
        paidOn,
        method: b.method ?? null,
        reference: b.reference ?? null,
        notes: b.notes ?? null,
        status: b.status ?? undefined,
        currency,
      },
    });
    emitToOrganization(req.app.get('io'), orgId, 'revenue:payment-logged', payment);
    res.status(201).json(payment);
  } catch (err: any) {
    next(err);
  }
});

// PUT /revenue/payments/:id/status — confirm (or refund) a payment. Auto-billing books
// retainer instalments as PENDING (FZ-077); this is how they become real, collected revenue.
const paymentStatusSchema = z.object({
  status: z.enum(['PENDING', 'PARTIAL', 'PAID', 'REFUNDED']),
  paidOn: z.string()
    .refine((d) => !isNaN(Date.parse(d)), 'Invalid paidOn date')
    .refine((d) => Date.parse(d) <= Date.now() + 86400000, 'paidOn cannot be in the future')
    .optional(),
});
const PAYMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['PARTIAL', 'PAID'],
  PARTIAL: ['PAID'],
  PAID: ['REFUNDED'],
  REFUNDED: [], // terminal
};
revenueRouter.put('/payments/:id/status', validate(paymentStatusSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.payment.findFirst({
      where: { id: req.params.id as string, organizationId: orgId },
    });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });

    const { status, paidOn } = req.body;
    if (status !== existing.status && !PAYMENT_STATUS_TRANSITIONS[existing.status]?.includes(status)) {
      return res.status(400).json({ error: `Cannot move a ${existing.status} payment to ${status}` });
    }

    const payment = await prisma.payment.update({
      where: { id: existing.id },
      data: {
        status,
        // Confirming receipt stamps when the money actually arrived.
        ...(status === 'PAID' ? { paidOn: paidOn ? new Date(paidOn) : new Date() } : {}),
      },
    });
    emitToOrganization(req.app.get('io'), orgId, 'revenue:payment-updated', payment);
    res.json(payment);
  } catch (err: any) {
    next(err);
  }
});

// ============================================================================
// 4. Subscriptions
// ============================================================================

revenueRouter.get('/subscriptions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const subs = await prisma.subscription.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        client: { select: { name: true, company: true } },
        contract: { select: { title: true } }
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(subs);
  } catch (err: any) {
    next(err);
  }
});

revenueRouter.post('/subscriptions', validate(subscriptionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const b = req.body; // validated by subscriptionSchema
    const refErr = await assertOrgRefs(orgId, { clientId: b.clientId, contractId: b.contractId });
    if (refErr) return res.status(400).json({ error: refErr });

    // Explicit whitelist (FZ-034).
    // Currency: use whatever the caller sends, or fall back to the linked contract's currency,
    // then to the client's currency, then to 'INR'.
    let currency = b.currency;
    if (!currency) {
      if (b.contractId) {
        const contract = await prisma.contract.findFirst({ where: { id: b.contractId, organizationId: orgId }, select: { currency: true } });
        currency = contract?.currency;
      }
      if (!currency) {
        const client = await prisma.client.findFirst({ where: { id: b.clientId, organizationId: orgId }, select: { currency: true } });
        currency = client?.currency ?? 'INR';
      }
    }
    const sub = await prisma.subscription.create({
      data: {
        organizationId: orgId,
        clientId: b.clientId,
        contractId: b.contractId ?? null,
        amount: b.amount,
        taxIncluded: b.taxIncluded ?? undefined,
        billingFrequency: b.billingFrequency || 'MONTHLY',
        startDate: new Date(b.startDate),
        nextBillingDate: b.nextBillingDate ? new Date(b.nextBillingDate) : null,
        status: b.status ?? undefined,
        notes: b.notes ?? null,
        currency,
      },
    });
    emitToOrganization(req.app.get('io'), orgId, 'revenue:subscription-created', sub);
    res.status(201).json(sub);
  } catch (err: any) {
    next(err);
  }
});

// ============================================================================
// 5. Expenses
// ============================================================================

revenueRouter.get('/expenses', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        project: { select: { name: true } },
        client: { select: { name: true, company: true } },
      },
      orderBy: { date: 'desc' },
    });
    res.json(expenses);
  } catch (err: any) {
    next(err);
  }
});

revenueRouter.post('/expenses', validate(expenseSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const b = req.body; // validated by expenseSchema
    // clientId and projectId are optional on an expense, but if supplied they must be ours.
    const refErr = await assertOrgRefs(orgId, { clientId: b.clientId, projectId: b.projectId });
    if (refErr) return res.status(400).json({ error: refErr });

    // Explicit whitelist (FZ-034).
    // Currency: use whatever the caller sends, or fall back to the linked client, then org default.
    let currency = b.currency;
    if (!currency) {
      if (b.clientId) {
        const client = await prisma.client.findFirst({ where: { id: b.clientId, organizationId: orgId }, select: { currency: true } });
        currency = client?.currency;
      }
      if (!currency) {
        const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { currency: true } });
        currency = org?.currency ?? 'INR';
      }
    }
    const expense = await prisma.expense.create({
      data: {
        organizationId: orgId,
        vendor: b.vendor || 'N/A',
        category: b.category,
        amount: b.amount,
        date: new Date(b.date),
        projectId: b.projectId ?? null,
        clientId: b.clientId ?? null,
        description: b.description ?? null,
        currency,
      },
    });
    emitToOrganization(req.app.get('io'), orgId, 'revenue:expense-logged', expense);
    res.status(201).json(expense);
  } catch (err: any) {
    next(err);
  }
});
