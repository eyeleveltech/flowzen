import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { emitToOrganization } from '../sse.js';
import { generateQuotePdf } from '../services/quotePdf.service.js';

export const revenueRouter = Router();

// Normalize any billing frequency (a free-form string) to a monthly figure so MRR
// is comparable across cadences. Unknown values fall back to monthly.
const toMonthlyAmount = (amount: number, freq: string | null | undefined): number => {
  switch ((freq || 'MONTHLY').toUpperCase()) {
    case 'YEARLY':
    case 'ANNUAL':
    case 'ANNUALLY': return amount / 12;
    case 'HALF_YEARLY':
    case 'SEMI_ANNUAL':
    case 'BIANNUAL': return amount / 6;
    case 'QUARTERLY': return amount / 3;
    case 'WEEKLY': return amount * 4.33;
    case 'DAILY': return amount * 30;
    case 'MONTHLY':
    default: return amount;
  }
};

// ============================================================================
// Overview & Dashboards
// ============================================================================

revenueRouter.get('/overview', async (req: AuthRequest, res: Response) => {
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

    const activeContracts = await prisma.contract.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      include: { payments: { where: { status: 'PAID' } } }
    });
    let receivables = 0;
    for (const c of activeContracts) {
      const paid = c.payments.reduce((acc, p) => acc + Number(p.amount), 0);
      receivables += Math.max(0, Number(c.value) - paid);
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
    res.status(500).json({ error: err.message });
  }
});

revenueRouter.get('/pnl', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    
    // Fetch clients for this org to find their projects
    const clients = await prisma.client.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, company: true }
    });
    const clientMap = new Map(clients.map(c => [c.id, c]));
    const clientIds = clients.map(c => c.id);

    const projects = await prisma.project.findMany({
      where: { clientId: { in: clientIds } },
      select: { id: true, name: true, clientId: true }
    });
    
    const projectIds = projects.map(p => p.id);
    
    // Fetch expenses for these projects
    const expenses = await prisma.expense.findMany({
      where: { projectId: { in: projectIds } }
    });

    // To get revenue, we will fetch contracts per client
    const contracts = await prisma.contract.findMany({
      where: { organizationId: orgId, clientId: { in: clientIds } },
      include: { payments: { where: { status: 'PAID' } } }
    });

    // Contracts are per-client (no projectId), so a client's paid revenue is split
    // EVENLY across that client's projects — otherwise each project would be credited
    // the client's full total and revenue would be multiplied by the project count.
    const projectCountByClient = new Map<string, number>();
    for (const p of projects) {
      if (p.clientId) projectCountByClient.set(p.clientId, (projectCountByClient.get(p.clientId) || 0) + 1);
    }

    const result = projects.map(p => {
      const projExpenses = expenses.filter(e => e.projectId === p.id);
      const totalExpenses = projExpenses.reduce((acc: number, e: any) => acc + Number(e.amount), 0);

      // approximate project revenue as an even share of the client's paid contract revenue
      const projectContracts = contracts.filter(c => c.clientId === p.clientId);
      const clientRevenue = projectContracts.reduce((acc: number, c: any) => acc + c.payments.reduce((pAcc: number, pmt: any) => pAcc + Number(pmt.amount), 0), 0);
      const projectsForClient = projectCountByClient.get(p.clientId) || 1;
      const revenue = clientRevenue / projectsForClient;

      const client = clientMap.get(p.clientId);
      return {
        projectId: p.id,
        projectName: p.name,
        clientName: client?.company || client?.name || 'Unknown',
        revenue,
        expenses: totalExpenses,
        net: revenue - totalExpenses
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 1. Invoice Drafts
// ============================================================================

revenueRouter.get('/invoice-drafts', async (req: AuthRequest, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

revenueRouter.post('/invoice-drafts', async (req: AuthRequest, res: Response) => {
  try {
    const { quoteId, draftNumber, clientId, clientName, lineItems, grandTotal, notes } = req.body;
    
    const orgId = req.user!.organizationId;
    // Check the quote exists IN THIS ORG and is ACCEPTED (no cross-tenant quote read).
    const quote = await prisma.quoteDocument.findFirst({ where: { id: quoteId, organizationId: orgId } });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.status !== 'ACCEPTED') return res.status(400).json({ error: 'Quote must be ACCEPTED to generate an invoice draft' });

    // The client must belong to the caller's org.
    const clientOk = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true } });
    if (!clientOk) return res.status(400).json({ error: 'Client not found in your organization' });

    const draft = await prisma.invoiceDraft.create({
      data: {
        organizationId: orgId,
        quoteId,
        draftNumber,
        clientId,
        clientName,
        lineItems,
        grandTotal,
        notes,
        status: 'DRAFT',
      },
      include: {
        client: { select: { name: true, company: true } },
        quote: { select: { documentNumber: true } }
      }
    });
    
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:invoice-draft-created', draft);
    res.status(201).json(draft);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

revenueRouter.put('/invoice-drafts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { lineItems, untaxedAmount, cgst, sgst, igst, totalTax, grandTotal, notes } = req.body;
    
    // Only allow editing if status is DRAFT
    const existing = await prisma.invoiceDraft.findUnique({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId }
    });
    
    if (!existing) return res.status(404).json({ error: 'Invoice draft not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only DRAFT invoices can be edited' });
    }

    const draft = await prisma.invoiceDraft.update({
      where: { id: req.params.id as string },
      data: {
        lineItems,
        untaxedAmount,
        cgst,
        sgst,
        igst,
        totalTax,
        grandTotal,
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
    res.status(500).json({ error: err.message });
  }
});
revenueRouter.put('/invoice-drafts/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    const draft = await prisma.invoiceDraft.update({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId },
      data: { status },
    });
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:invoice-draft-updated', draft);
    res.json(draft);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

 // Wait, let's fix imports properly at the top. 
// I'll add the route first, then fix imports if needed.

revenueRouter.post('/invoice-drafts/:id/generate-pdf', async (req: AuthRequest, res: Response) => {
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
    
    const updated = await prisma.invoiceDraft.update({
      where: { id },
      data: { pdfUrl, status: 'SENT' }
    });
    emitToOrganization(req.app.get('io'), orgId, 'revenue:invoice-draft-updated', updated);
    
    res.json({ pdfUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2. Contracts
// ============================================================================

revenueRouter.get('/contracts', async (req: AuthRequest, res: Response) => {
  try {
    const contracts = await prisma.contract.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        client: { select: { name: true, company: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(contracts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

revenueRouter.post('/contracts', async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const contract = await prisma.contract.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
      },
    });
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:contract-created', contract);
    res.status(201).json(contract);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. Payments
// ============================================================================

revenueRouter.get('/payments', async (req: AuthRequest, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        client: { select: { name: true, company: true } },
        contract: { select: { title: true } }
      },
      orderBy: { paidOn: 'desc' },
    });
    res.json(payments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

revenueRouter.post('/payments', async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const payment = await prisma.payment.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        paidOn: new Date(data.paidOn),
      },
    });
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:payment-logged', payment);
    res.status(201).json(payment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 4. Subscriptions
// ============================================================================

revenueRouter.get('/subscriptions', async (req: AuthRequest, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

revenueRouter.post('/subscriptions', async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const sub = await prisma.subscription.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        startDate: new Date(data.startDate),
        nextBillingDate: data.nextBillingDate ? new Date(data.nextBillingDate) : null,
      },
    });
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:subscription-created', sub);
    res.status(201).json(sub);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 5. Expenses
// ============================================================================

revenueRouter.get('/expenses', async (req: AuthRequest, res: Response) => {
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
    res.status(500).json({ error: err.message });
  }
});

revenueRouter.post('/expenses', async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const expense = await prisma.expense.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        date: new Date(data.date),
      },
    });
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'revenue:expense-logged', expense);
    res.status(201).json(expense);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
