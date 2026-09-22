import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, hasPermission, requirePermission } from '../middleware/auth.js';
import { issueWithRetry } from '../utils/documentNumber.js';
import { InvoiceStatus, MonthCardStatus, TaskWorkType } from '@prisma/client';
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
  lineItemSchema,
  cleanCustomFields,
  ORG_DOCUMENT_SELECT,
} from '../utils/documentSchemas.js';

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
        /*
         * Whether this invoice has a printable document yet (CR-02).
         *
         * A flag rather than the document itself: the register needs to know
         * which rows can offer a PDF, and shipping every buyer block and line
         * item to answer that would put the whole of every document into a
         * table that shows none of it. `subtotal` is the marker because it is
         * written by, and only by, the document save.
         */
        hasDocument: inv.subtotal !== null,
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

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const base = { retainer: { organizationId: orgId }, invoiceId: null };

    /**
     * "Owed now", as a query rather than a predicate over the rows we happened
     * to fetch. A month that has ended, or a card closed early because the
     * retainer was stopped part way through.
     */
    const isDue = { OR: [{ status: MonthCardStatus.CLOSED }, { month: { lt: thisMonth } }] };

    const cards = await prisma.monthCard.findMany({
      where: base,
      include: { retainer: { include: { company: { select: { id: true, name: true } } } } },
      // Oldest first. This used to be `desc` under the same cap below, so the
      // rows dropped were the OLDEST — the most overdue, which is the entire
      // reason somebody opens this screen.
      orderBy: { month: 'asc' },
      take: 100,
    });

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

    /**
     * Counted in the DATABASE, over every uninvoiced card — not summed from
     * `rows`, which is capped at 100 for display. Deriving the total from the
     * page is the bug that makes a money figure quietly wrong: it can only ever
     * understate, and it understates by exactly the oldest unpaid months.
     */
    const [dueAgg, upcomingCount] = await Promise.all([
      prisma.monthCard.aggregate({
        where: { ...base, ...isDue },
        _count: true,
        _sum: { revenue: true },
      }),
      prisma.monthCard.count({ where: { ...base, NOT: isDue } }),
    ]);

    res.json({
      success: true,
      rows,
      // `rows` is a page; these are the whole set.
      truncated: rows.length === 100,
      dueCount: dueAgg._count ?? 0,
      dueTotal: Number(dueAgg._sum?.revenue ?? 0),
      upcomingCount,
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
        lineItems: { orderBy: { serialNo: 'asc' } },
      },
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    const totalPaid = invoice.payments.reduce((acc, p) => acc + Number(p.amount), 0);
    const invoiceAmount = Number(invoice.amount);
    const balanceDue = Math.max(0, invoiceAmount - totalPaid);

    /*
     * CR-02 added a subtotal, a tax breakdown, a total and a table of priced
     * line items to this row, and this route spreads the row. Every one of
     * those is a money figure, so every one of them is masked the same way
     * the amount above it always has been — null when withheld, never zero,
     * because a zero is a claim and an absence is not.
     *
     * The line items go further and are withheld entirely: a row that keeps
     * its description and loses its price is still the shape of the deal.
     */
    const money = (value: unknown) => (canSeeFigures ? Number(value) : null);

    const data = {
      ...invoice,
      amount: canSeeFigures ? invoiceAmount : null,
      totalPaid: canSeeFigures ? totalPaid : null,
      balanceDue: canSeeFigures ? balanceDue : null,
      subtotal: invoice.subtotal === null ? null : money(invoice.subtotal),
      cgstAmount: invoice.cgstAmount === null ? null : money(invoice.cgstAmount),
      sgstAmount: invoice.sgstAmount === null ? null : money(invoice.sgstAmount),
      igstAmount: invoice.igstAmount === null ? null : money(invoice.igstAmount),
      roundOff: invoice.roundOff === null ? null : money(invoice.roundOff),
      total: invoice.total === null ? null : money(invoice.total),
      amountInWords: canSeeFigures ? invoice.amountInWords : null,
      lineItems: canSeeFigures
        ? invoice.lineItems.map((li) => ({
            ...li,
            units: Number(li.units),
            unitCost: Number(li.unitCost),
            amount: Number(li.amount),
          }))
        : [],
      /** Whether there is a document to print, which is not itself a figure. */
      hasDocument: invoice.subtotal !== null,
      payments: invoice.payments.map((p) => ({
        ...p,
        amount: canSeeFigures ? Number(p.amount) : null,
      })),
    };

    // Under `data` only. The web client unwraps `data` when it is present, so
    // a second copy under `invoice` is a key no caller can ever reach — and a
    // typed client that claims to return it hands back undefined at runtime.
    res.json({ success: true, data });
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

// ── The printed document (CR-02) ────────────────────────────────────────────
//
// An invoice used to be twelve columns: a number, a company, an amount, two
// dates and a status. That is enough to chase a payment and not nearly enough
// to print a tax invoice — there was no buyer block, no line items, no tax
// breakdown and no terms, and no `invoicePdf` anywhere in the codebase.
//
// The document is attached in a second step rather than at creation, because
// that is the actual sequence: Tally issues the number, the number is recorded
// here against the month or project it bills, and the printable document is
// prepared from it. `POST /invoices` is untouched, so every existing screen
// that records a Tally invoice keeps working exactly as it did.

const invoiceDocumentSchema = z.object({
  billingName: z.string().trim().min(1, 'The buyer name is required'),
  billingContactName: z.string().trim().optional().nullable(),
  billingAddress: z.string().trim().optional().nullable(),
  gstin: z.string().trim().optional().nullable(),
  gstApplicable: z.boolean().default(true),
  gstRatePercent: z.number().min(0).max(28).default(18),
  poNumber: z.string().trim().optional().nullable(),
  poDate: z.coerce.date().optional().nullable(),
  terms: z.string().optional().nullable(),
  ...documentFieldsSchema,
  lineItems: z.array(lineItemSchema).min(1, 'A document needs at least one line item').max(200),
});

/**
 * PUT /api/invoices/:id/document — attach or replace the printable document.
 *
 * Replaces rather than patches, for the same reason the proforma edit does:
 * a total that is patched independently of the lines it sums is a total that
 * can end up disagreeing with them.
 */
invoicesRouter.put(
  '/:id/document',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = invoiceDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const orgId = req.user!.organizationId;
      const id = String(req.params.id);

      const invoice = await prisma.invoice.findFirst({
        where: { id, organizationId: orgId },
        include: {
          company: { select: { billingAddress: true, gstin: true, stateName: true, stateCode: true } },
          payments: { select: { amount: true } },
        },
      });
      if (!invoice) {
        res.status(404).json({ success: false, error: 'Invoice not found' });
        return;
      }
      if (invoice.status === InvoiceStatus.CANCELLED) {
        res.status(400).json({
          success: false,
          error: 'This invoice is cancelled. Raise a new one rather than rewriting it.',
        });
        return;
      }

      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: ORG_DOCUMENT_SELECT });
      if (!org) {
        res.status(404).json({ success: false, error: 'Organisation not found' });
        return;
      }

      const snapshot = buildDocumentSnapshot({
        org,
        lineItems: parsed.data.lineItems,
        gstApplicable: parsed.data.gstApplicable,
        gstRatePercent: parsed.data.gstRatePercent,
        buyer: {
          name: parsed.data.billingName,
          contactName: parsed.data.billingContactName,
          address: parsed.data.billingAddress || invoice.company.billingAddress,
          gstin: parsed.data.gstin || invoice.company.gstin,
          stateName: parsed.data.billingStateName ?? invoice.company.stateName,
          stateCode: parsed.data.billingStateCode ?? invoice.company.stateCode,
        },
        placeOfSupply: parsed.data.placeOfSupply,
        customFields: cleanCustomFields(parsed.data.customFields),
      });

      // An invoice's `amount` is the payable total — it is what payments are
      // settled against — so the document's total becomes the amount. It is not
      // allowed to fall below money already received: that would leave the
      // invoice reading as overpaid, and it means either the document or the
      // receipt is wrong, which is a person's problem, not a rounding one.
      const received = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      if (snapshot.total < received) {
        res.status(400).json({
          success: false,
          error: `This document totals ₹${snapshot.total.toLocaleString('en-IN')}, which is less than the ₹${received.toLocaleString('en-IN')} already received against this invoice.`,
        });
        return;
      }

      /*
       * Whether it is settled follows the new total, not the old one.
       *
       * `amount` is what payments are measured against, so raising it on a
       * PAID invoice left the row saying PAID while money was owed — and a
       * PAID invoice is excluded from outstanding and from overdue, so that
       * balance would never have appeared anywhere again. Only CANCELLED was
       * refused before this; everything else was rewritable in silence.
       */
      const settled = received > 0 && received >= snapshot.total;
      const wasPaid = invoice.status === InvoiceStatus.PAID;
      const nextStatus = settled
        ? InvoiceStatus.PAID
        : wasPaid
          ? InvoiceStatus.RAISED
          : invoice.status;

      const updated = await prisma.$transaction(async (tx) => {
        await tx.documentLineItem.deleteMany({ where: { invoiceId: id } });
        return tx.invoice.update({
          where: { id },
          data: {
            amount: snapshot.total,
            status: nextStatus,
            // Cleared when it stops being settled, so the date on the row is
            // never a payment date for a bill that is not paid.
            paidAt: settled ? (invoice.paidAt ?? new Date()) : null,
            gstApplicable: parsed.data.gstApplicable,
            gstRatePercent: parsed.data.gstRatePercent,
            poNumber: parsed.data.poNumber || null,
            poDate: parsed.data.poDate ?? null,
            terms: parsed.data.terms || null,
            notes: parsed.data.notes || null,
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
          include: { lineItems: { orderBy: { serialNo: 'asc' } } },
        });
      });

      await prisma.activity.create({
        data: {
          organizationId: orgId,
          actorId: req.user!.userId,
          entityType: 'Invoice',
          entityId: id,
          verb: 'invoice_document_saved',
          payload: {
            number: invoice.number,
            amountWas: Number(invoice.amount),
            amountNow: snapshot.total,
            lines: snapshot.lines.length,
            ...(nextStatus !== invoice.status
              ? { statusWas: invoice.status, statusNow: nextStatus }
              : {}),
          },
        },
      });

      res.json({ success: true, data: updated });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /api/invoices/:id/pdf — the printed tax invoice.
 *
 * money.figures, not money.status: the page states the amount, the tax and the
 * bank account, none of which someone holding only "paid or unpaid" may see.
 */
invoicesRouter.get(
  '/:id/pdf',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);

      const invoice = await prisma.invoice.findFirst({
        where: { id, organizationId: orgId },
        select: { number: true },
      });
      if (!invoice) {
        res.status(404).json({ success: false, error: 'Invoice not found' });
        return;
      }

      const pdf = await generateDocumentPdf('INVOICE', id, orgId);

      res.setHeader('Content-Type', 'application/pdf');
      // A Tally number is typed by hand and routinely contains slashes. Anything
      // a filesystem or a Content-Disposition header would choke on becomes a
      // dash, rather than only the two characters the proforma route replaces.
      const safeName = invoice.number.replace(/[^A-Za-z0-9._-]+/g, '-');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
      res.send(pdf);
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /api/invoices/:id/email — what the send form should open with.
 * POST /api/invoices/:id/email — send it, with the PDF attached (CR-02 §10).
 *
 * money.figures for both: the covering note states the total, and the
 * attachment states everything else.
 */
invoicesRouter.get(
  '/:id/email',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const defaults = await documentEmailDefaults('INVOICE', String(req.params.id), req.user!.organizationId);
      res.json({ success: true, ...defaults });
    } catch (e) {
      next(e);
    }
  },
);

invoicesRouter.post(
  '/:id/email',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = documentEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const sent = await sendDocumentEmail(
        'INVOICE',
        String(req.params.id),
        req.user!.organizationId,
        req.user!.userId,
        parsed.data,
      );
      res.json({ success: true, ...sent });
    } catch (e) {
      // A missing mail server is a setup problem with a fix the sender can act
      // on, not a 500 that reads as the app being broken.
      if (e instanceof Error && /mail server/i.test(e.message)) {
        res.status(400).json({ success: false, error: `${e.message} Set one up in Settings > Email.` });
        return;
      }
      next(e);
    }
  },
);
