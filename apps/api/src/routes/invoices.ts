import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, hasPermission, requirePermission } from '../middleware/auth.js';
import { issueWithRetry } from '../utils/documentNumber.js';
import { calculateGst } from '../utils/tax.js';
import { InvoiceStatus, TaskWorkType } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';

export const invoicesRouter = Router();

invoicesRouter.use(authenticate);

/**
 * GET /api/invoices — List all tax invoices
 *
 * Gated on money.status, not just authenticate: this list is exactly what
 * §9 describes that permission as granting — "See paid or unpaid, never an
 * amount" — and a plain EMPLOYEE holds neither money.status nor
 * money.figures. Without this gate any authenticated user could enumerate
 * every client's invoices and payment status org-wide.
 */
invoicesRouter.get('/', requirePermission('money.status'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const { status, companyId, search } = req.query;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    const where: any = { organizationId: orgId };
    if (status && typeof status === 'string' && Object.values(InvoiceStatus).includes(status as InvoiceStatus)) {
      where.status = status as InvoiceStatus;
    }
    if (companyId && typeof companyId === 'string') {
      where.companyId = companyId;
    }
    if (search && typeof search === 'string') {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { company: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { raisedAt: 'desc' },
        skip,
        take,
        include: {
          company: { select: { id: true, name: true, website: true } },
          payments: { select: { id: true, amount: true, receivedAt: true, mode: true, reference: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const data = invoices.map((inv) => {
      const totalPaid = inv.payments.reduce((acc, p) => acc + Number(p.amount), 0);
      const invoiceAmount = Number(inv.amount);
      const balanceDue = Math.max(0, invoiceAmount - totalPaid);
      const isOverdue = inv.status !== 'PAID' && inv.status !== 'CANCELLED' && inv.dueAt.toISOString().slice(0, 10) < todayStr;
      
      const dueDaysDiff = Math.floor((now.getTime() - new Date(inv.dueAt).getTime()) / (1000 * 3600 * 24));
      const agingDays = isOverdue ? dueDaysDiff : 0;

      return {
        id: inv.id,
        number: inv.number,
        company: inv.company,
        project: inv.project,
        workType: inv.workType,
        workId: inv.workId,
        raisedAt: inv.raisedAt,
        dueAt: inv.dueAt,
        status: isOverdue && inv.status === 'RAISED' ? 'OVERDUE' : inv.status,
        /*
         * Computed since this route was written and never sent, while the web's
         * `Invoice` interface declared it — so the type compiled, the value was
         * `undefined` at runtime, and every `i.isOverdue` on the Money screen
         * quietly read false. That is why the Overdue tile showed 0 next to
         * rows plainly marked OVERDUE: the rows read the derived `status` above,
         * the tile read this.
         */
        isOverdue,
        paidAt: inv.paidAt,
        proformaId: inv.proformaId,
        amount: canSeeFigures ? invoiceAmount : null,
        totalPaid: canSeeFigures ? totalPaid : null,
        balanceDue: canSeeFigures ? balanceDue : null,
        agingDays,
        paymentsCount: inv.payments.length,
      };
    });

    if (wantsCsv) {
      const csv = toCsv(data, [
        { label: 'Number', value: (i) => i.number },
        { label: 'Company', value: (i) => i.company.name },
        { label: 'Status', value: (i) => i.status },
        { label: 'Amount', value: (i) => i.amount ?? '' },
        { label: 'Total paid', value: (i) => i.totalPaid ?? '' },
        { label: 'Balance due', value: (i) => i.balanceDue ?? '' },
        { label: 'Raised', value: (i) => i.raisedAt.toISOString().slice(0, 10) },
        { label: 'Due', value: (i) => i.dueAt.toISOString().slice(0, 10) },
        { label: 'Aging days', value: (i) => i.agingDays },
      ]);
      sendCsv(res, `invoices-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      data,
      invoices: data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/invoices/awaiting — retainer months with no invoice against them.
 *
 * ─── Why this screen needed a list it did not have ──────────────────────────
 *
 * Raising the invoices is one person's job, and that person is ACCOUNTS, who
 * holds `money.figures` and not `work.all`. So she could raise an invoice —
 * the form works, it asks for a company and what to bill against — and she had
 * no way to see WHICH months were waiting for one: /live-work, /retainers/:id
 * and /projects/:id are all behind `work.all` and bounce her to My Work.
 *
 * The alert that would have told her, MONTH_CARD_NOT_INVOICED, reaches her
 * correctly on `money.status` and then links to /live-work, which she cannot
 * open. From the next month roll that alert starts firing in earnest: five of
 * the six cards for the current month carry no invoice.
 *
 * So the list belongs on the screen where the billing is actually done.
 *
 * ─── What counts as waiting ─────────────────────────────────────────────────
 *
 * Every month card with no invoice, not only the ones already overdue, split
 * by whether it can be billed yet. A month that has ended — or a card closed
 * early because the retainer was stopped part way through — is owed for now.
 * One still running is the forward view, and showing it is what makes this a
 * work list rather than a rebuke.
 */
invoicesRouter.get('/awaiting', requirePermission('money.figures'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const cards = await prisma.monthCard.findMany({
      where: { retainer: { organizationId: orgId }, invoiceId: null },
      include: { retainer: { include: { company: { select: { id: true, name: true } } } } },
      orderBy: { month: 'desc' },
      take: 100,
    });

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const rows = cards.map((c) => ({
      id: c.id,
      month: c.month,
      companyId: c.retainer.company.id,
      companyName: c.retainer.company.name,
      revenue: Number(c.revenue),
      status: c.status,
      closedAt: c.closedAt,
      // The month is over, or somebody closed the card early by ending the
      // retainer. Either way the work is done and the money is owed.
      due: c.status === 'CLOSED' || c.month < thisMonth,
      retainerStopped: c.retainer.status === 'STOPPED',
    }));

    res.json({
      success: true,
      rows,
      dueCount: rows.filter((r) => r.due).length,
      dueTotal: rows.filter((r) => r.due).reduce((a, r) => a + r.revenue, 0),
      upcomingCount: rows.filter((r) => !r.due).length,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/invoices/:id — Single invoice detail
 */
invoicesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');

    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        company: true,
        payments: { orderBy: { receivedAt: 'desc' } },
        project: true,
        proforma: true,
        monthCard: true,
      },
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    const totalPaid = invoice.payments.reduce((acc, p) => acc + Number(p.amount), 0);
    const invoiceAmount = Number(invoice.amount);
    const balanceDue = Math.max(0, invoiceAmount - totalPaid);

    res.json({
      success: true,
      data: {
        ...invoice,
        amount: canSeeFigures ? invoiceAmount : null,
        totalPaid: canSeeFigures ? totalPaid : null,
        balanceDue: canSeeFigures ? balanceDue : null,
        payments: invoice.payments.map((p) => ({
          ...p,
          amount: canSeeFigures ? Number(p.amount) : null,
        })),
      },
    });
  } catch (e) {
    next(e);
  }
});

// 'RETAINER' is what a caller means; the Prisma enum has no such value — a
// retainer's work is stored as MONTH_CARD, same transform costs.ts and
// allocations.ts already apply. Passing the raw string through, as this
// schema did, fails prisma.invoice.create() with "Invalid value for
// argument workType" every time — dormant only because nothing ever called
// this endpoint with workType: 'RETAINER' before now.
const workTypeSchema = z.enum(['MONTH_CARD', 'RETAINER', 'PROJECT']).transform((val) => {
  if (val === 'RETAINER') return TaskWorkType.MONTH_CARD;
  return val as TaskWorkType;
});

const createInvoiceSchema = z.object({
  companyId: z.string().min(1),
  amount: z.number().positive(),
  raisedAt: z.string().optional(),
  dueAt: z.string().optional(),
  workType: workTypeSchema.optional().nullable(),
  workId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  proformaId: z.string().optional().nullable(),
  monthCardId: z.string().optional().nullable(),
  customNumber: z.string().optional(),
});

/**
 * POST /api/invoices — Issue sequential tax invoice
 */
invoicesRouter.post(
  '/',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = createInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const orgId = req.user!.organizationId;
      const {
        companyId,
        amount,
        raisedAt,
        dueAt,
        workType,
        workId,
        projectId,
        proformaId,
        monthCardId,
        customNumber,
      } = parsed.data;

      // Verify company belongs to org
      const company = await prisma.company.findFirst({
        where: { id: companyId, organizationId: orgId },
      });
      if (!company) {
        res.status(404).json({ success: false, error: 'Company not found' });
        return;
      }

      /*
       * `companyId` above and `monthCardId` below were checked; these two were
       * written down exactly as they arrived, so an invoice in this
       * organization could point at another one's project or proforma. Same
       * omission `costs.ts` had. The row itself was never mis-tenanted — every
       * read filters on `organizationId` — but a screen that joins through the
       * link renders the other tenant's names.
       */
      if (projectId) {
        const project = await prisma.project.findFirst({
          where: { id: projectId, organizationId: orgId, companyId, deletedAt: null },
          select: { id: true },
        });
        if (!project) {
          res.status(404).json({ success: false, error: 'Project not found for this company' });
          return;
        }
      }
      if (proformaId) {
        const proforma = await prisma.proforma.findFirst({
          where: { id: proformaId, organizationId: orgId, companyId },
          select: { id: true },
        });
        if (!proforma) {
          res.status(404).json({ success: false, error: 'Proforma not found for this company' });
          return;
        }
      }

      // Unlike workId/projectId/proformaId, a month card doesn't hold a
      // foreign key TO its invoice — MonthCard.invoiceId points the other
      // way (it's the unique FK). Validate it up front so the invoice isn't
      // created only to fail linking it afterward.
      let monthCard: { id: string; invoiceId: string | null } | null = null;
      if (monthCardId) {
        monthCard = await prisma.monthCard.findFirst({
          where: { id: monthCardId, retainer: { organizationId: orgId, companyId } },
          select: { id: true, invoiceId: true },
        });
        if (!monthCard) {
          res.status(404).json({ success: false, error: 'Month card not found for this company' });
          return;
        }
        if (monthCard.invoiceId) {
          res.status(400).json({ success: false, error: 'This month already has an invoice entered' });
          return;
        }
      }

      const now = new Date();
      const raisedDate = raisedAt ? new Date(raisedAt) : now;
      const dueDate = dueAt ? new Date(dueAt) : new Date(raisedDate.getTime() + 15 * 24 * 3600 * 1000); // 15 days credit

      // A number typed in by hand (an invoice raised in Tally first) is used as
      // given and cannot be retried — if it collides, that is a real conflict
      // the person has to resolve, not a race to lose politely.
      const typed = customNumber?.trim();

      const issue = async (invoiceNumber: string) =>
        prisma.$transaction(async (tx) => {
          const created = await tx.invoice.create({
            data: {
              organizationId: orgId,
              number: invoiceNumber,
              companyId,
              amount,
              raisedAt: raisedDate,
              dueAt: dueDate,
              workType: workType as TaskWorkType | undefined,
              workId: workId || undefined,
              projectId: projectId || undefined,
              proformaId: proformaId || undefined,
              status: InvoiceStatus.RAISED,
            },
            include: { company: true },
          });

          if (monthCard) {
            await tx.monthCard.update({ where: { id: monthCard.id }, data: { invoiceId: created.id } });
          }

          return created;
        });

      const invoice = typed
        ? await issue(typed)
        : await issueWithRetry(orgId, 'INVOICE', issue);

      // Log activity
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          actorId: req.user!.userId,
          entityType: 'Invoice',
          entityId: invoice.id,
          verb: 'created',
          payload: { number: invoice.number, amount, companyName: company.name },
        },
      });

      res.status(201).json({ success: true, data: invoice, invoice });
    } catch (e) {
      next(e);
    }
  },
);

const paymentSchema = z.object({
  amount: z.number().positive(),
  receivedAt: z.string().optional(),
  mode: z.enum(['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CASH']),
  reference: z.string().optional().nullable(),
});

/**
 * POST /api/invoices/:id/payments — Record payment collection
 */
invoicesRouter.post(
  '/:id/payments',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const orgId = req.user!.organizationId;

      const parsed = paymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const invoice = await prisma.invoice.findFirst({
        where: { id, organizationId: orgId },
        include: { payments: true, company: true },
      });

      if (!invoice) {
        res.status(404).json({ success: false, error: 'Invoice not found' });
        return;
      }

      const receivedDate = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date();

      const payment = await prisma.payment.create({
        data: {
          invoiceId: id,
          amount: parsed.data.amount,
          receivedAt: receivedDate,
          mode: parsed.data.mode,
          reference: parsed.data.reference || undefined,
        },
      });

      // Calculate total paid including this new payment
      const totalPaid =
        invoice.payments.reduce((acc, p) => acc + Number(p.amount), 0) + Number(parsed.data.amount);
      const isFullySettled = totalPaid >= Number(invoice.amount);

      let updatedInvoice: any = invoice;
      if (isFullySettled) {
        updatedInvoice = await prisma.invoice.update({
          where: { id },
          data: {
            status: InvoiceStatus.PAID,
            paidAt: receivedDate,
          },
          include: { payments: true, company: true },
        });
      }

      // Log payment activity
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          actorId: req.user!.userId,
          entityType: 'Invoice',
          entityId: id,
          verb: isFullySettled ? 'fully_paid' : 'payment_received',
          payload: {
            paymentAmount: parsed.data.amount,
            totalPaid,
            invoiceNumber: invoice.number,
            companyName: invoice.company.name,
            mode: parsed.data.mode,
          },
        },
      });

      res.status(201).json({
        success: true,
        payment,
        invoice: updatedInvoice,
        isFullySettled,
      });
    } catch (e) {
      next(e);
    }
  },
);

const statusSchema = z.object({
  status: z.nativeEnum(InvoiceStatus),
});

/**
 * PATCH /api/invoices/:id/status — Update invoice status
 */
invoicesRouter.patch(
  '/:id/status',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const orgId = req.user!.organizationId;

      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const invoice = await prisma.invoice.findFirst({
        where: { id, organizationId: orgId },
      });

      if (!invoice) {
        res.status(404).json({ success: false, error: 'Invoice not found' });
        return;
      }

      const updated = await prisma.invoice.update({
        where: { id },
        data: {
          status: parsed.data.status,
          paidAt: parsed.data.status === InvoiceStatus.PAID ? (invoice.paidAt || new Date()) : invoice.paidAt,
        },
      });

      res.json({ success: true, data: updated });
    } catch (e) {
      next(e);
    }
  },
);
