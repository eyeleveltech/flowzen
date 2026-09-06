import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest, hasPermission } from '../middleware/auth.js';
import { rollActiveRetainers } from '../workers/monthCard.cron.js';
import { CompanyStatus, RetainerStatus } from '@prisma/client';
import { monthKey } from '../utils/retainerMonths.js';
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';

export const retainersRouter = Router();

retainersRouter.use(authenticate);

// Same formula and same reason as projects.ts's allocationCost — a month
// card's cost was Cost rows only, quietly excluding the people allocated to
// it, which is usually the larger share of what a retainer actually costs.
const allocationCost = (allocations: { percent: number; user: { monthlyCost: unknown } }[]) =>
  allocations.reduce((acc, a) => acc + (a.percent / 100) * Number(a.user.monthlyCost), 0);

// ── 0. Profit by client, one month ──────────────────────────────────────────
//
// Money screen's "did we make money on that job" table — brief §1's success
// criteria, literally. Retainers only: a one-time project has no monthly
// revenue recognition schedule in this model, so mixing it into a month's
// P&L would be a made-up number, not a derived one.

retainersRouter.get('/profitability', requirePermission('money.figures'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const monthCards = await prisma.monthCard.findMany({
      where: { month, retainer: { organizationId: orgId } },
      include: {
        retainer: { include: { company: { select: { id: true, name: true } } } },
        costs: { where: { deletedAt: null }, select: { amount: true } },
        allocations: { include: { user: { select: { monthlyCost: true } } } },
      },
    });

    const rows = monthCards.map((mc) => {
      const revenue = Number(mc.revenue);
      const externalCost = mc.costs.reduce((acc, c) => acc + Number(c.amount), 0);
      const peopleCost = allocationCost(mc.allocations);
      const profit = revenue - externalCost - peopleCost;
      return {
        companyId: mc.retainer.company.id,
        companyName: mc.retainer.company.name,
        revenue,
        externalCost,
        peopleCost,
        profit,
        marginPercent: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({ revenue: acc.revenue + r.revenue, externalCost: acc.externalCost + r.externalCost, peopleCost: acc.peopleCost + r.peopleCost, profit: acc.profit + r.profit }),
      { revenue: 0, externalCost: 0, peopleCost: 0, profit: 0 },
    );

    res.json({
      success: true,
      month,
      rows: rows.sort((a, b) => b.profit - a.profit),
      totals: { ...totals, marginPercent: totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 1000) / 10 : 0 },
    });
  } catch (error) {
    next(error);
  }
});

// ── 1. List Retainers ───────────────────────────────────────────────────────

retainersRouter.get('/', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const { status } = req.query;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    const where: any = { organizationId: orgId };
    if (status && typeof status === 'string' && ['ACTIVE', 'STOPPED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as RetainerStatus;
    }

    const [retainers, total] = await Promise.all([
      prisma.retainer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          company: { select: { id: true, name: true, vertical: true, city: true } },
          owner: { select: { id: true, name: true, email: true } },
          template: { select: { id: true, name: true } },
          monthCards: {
            orderBy: { month: 'desc' },
            take: 3,
            include: {
              invoice: { select: { id: true, number: true, status: true } },
              tasks: { where: { deletedAt: null }, select: { status: true } },
            },
          },
        },
      }),
      prisma.retainer.count({ where }),
    ]);

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const formatted = retainers.map((r) => {
      const activeMonthCard = r.monthCards.find((m) => m.month === currentMonth) || r.monthCards[0] || null;

      let renewalDaysLeft: number | null = null;
      let isExpiringSoon = false;
      if (r.renewalDate) {
        renewalDaysLeft = Math.ceil((new Date(r.renewalDate).getTime() - now.getTime()) / (1000 * 3600 * 24));
        isExpiringSoon = renewalDaysLeft <= 45 && renewalDaysLeft >= 0;
      }

      // `work.all` grants operational visibility into every retainer — it does
      // NOT grant sight of a rupee figure. Only `money.figures` does. A HEAD
      // has work.all without money.figures, so monthlyValue and every
      // MonthCard's revenue must be masked for them here, on the server —
      // the brief's rule is that the client masks for presentation only.
      const maskedMonthCards = r.monthCards.map((m) => ({
        ...m,
        tasks: undefined,
        revenue: canSeeFigures ? m.revenue : null,
      }));
      // "October, 11 of 18 tasks done" on Live work — total excludes cancelled
      // work the same way "open" does everywhere else (tasks.ts/team.ts).
      const monthTasksTotal = activeMonthCard?.tasks.filter((t) => t.status !== 'CANCELLED').length ?? 0;
      const monthTasksDone = activeMonthCard?.tasks.filter((t) => t.status === 'DONE').length ?? 0;

      const maskedActiveMonthCard = activeMonthCard
        ? { ...activeMonthCard, tasks: undefined, revenue: canSeeFigures ? activeMonthCard.revenue : null }
        : null;

      return {
        id: r.id,
        companyId: r.companyId,
        company: r.company,
        monthlyValue: canSeeFigures ? r.monthlyValue : null,
        startDate: r.startDate,
        termMonths: r.termMonths,
        renewalDate: r.renewalDate,
        status: r.status,
        owner: r.owner,
        template: r.template,
        activeMonthCard: maskedActiveMonthCard,
        recentMonthCards: maskedMonthCards,
        renewalDaysLeft,
        isExpiringSoon,
        noFixedTermRisk: !r.termMonths && !r.renewalDate,
        monthTasksDone,
        monthTasksTotal,
      };
    });

    if (wantsCsv) {
      const csv = toCsv(formatted, [
        { label: 'Company', value: (r) => r.company.name },
        { label: 'Monthly value', value: (r) => (r.monthlyValue != null ? Number(r.monthlyValue) : '') },
        { label: 'Start date', value: (r) => r.startDate.toISOString().slice(0, 10) },
        { label: 'Term (months)', value: (r) => r.termMonths ?? '' },
        { label: 'Renewal date', value: (r) => (r.renewalDate ? r.renewalDate.toISOString().slice(0, 10) : '') },
        { label: 'Status', value: (r) => r.status },
        { label: 'Owner', value: (r) => r.owner.name },
        { label: 'No fixed term risk', value: (r) => (r.noFixedTermRisk ? 'Yes' : 'No') },
      ]);
      sendCsv(res, `retainers-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      retainers: formatted,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. Create Retainer ──────────────────────────────────────────────────────

const retainerCreateSchema = z.object({
  companyId: z.string().min(1, 'Company is required'),
  monthlyValue: z.number().positive('Monthly value must be positive'),
  startDate: z.string().min(1, 'Start date is required'),
  termMonths: z.number().optional().nullable(),
  ownerId: z.string().optional(),
  templateId: z.string().optional().nullable(),
  /** Set when this retainer is created from a won proposal (§11.1 step 11). */
  sourceProposalId: z.string().optional(),
});

retainersRouter.post('/', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = retainerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const { companyId, monthlyValue, startDate, termMonths, ownerId, templateId, sourceProposalId } = parsed.data;

    /*
     * ─── The gate, and why it could not be the proposal alone ──────────────
     *
     * The won-proposal check below sits inside `if (sourceProposalId)`, so
     * omitting one field skipped every rule it enforced: a retainer could be
     * opened against a company nobody had sold anything to, and a second one
     * opened beside it the next minute. The client decided whether to be
     * validated.
     *
     * The invariant is about the COMPANY, not the request. A company becomes a
     * CLIENT when a proposal is won, so "not a prospect" is exactly "somebody
     * has bought something", and it holds however the request is shaped.
     *
     * It also settles the tenancy question the same way: this is the first read
     * of `companyId` scoped to the caller's organization, so a company id from
     * another org now 404s here rather than being written into a retainer.
     */
    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true, name: true, status: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }
    if (company.status === CompanyStatus.PROSPECT) {
      res.status(400).json({
        success: false,
        error: `${company.name} is still a prospect. Win a proposal for them first — that is what turns a prospect into a client.`,
      });
      return;
    }

    // One live retainer per client. Two is not a bigger client, it is the same
    // client billed twice, and every month-end figure counts both.
    const alreadyRunning = await prisma.retainer.findFirst({
      where: { companyId, organizationId: orgId, status: RetainerStatus.ACTIVE },
      select: { id: true, monthlyValue: true },
    });
    if (alreadyRunning) {
      res.status(400).json({
        success: false,
        error: `${company.name} already has an active retainer. End that one before starting another.`,
      });
      return;
    }

    // Same guard as Project.sourceProposalId: only a won proposal for this
    // company can seed a retainer, and only once.
    if (sourceProposalId) {
      const proposal = await prisma.proposal.findFirst({
        where: { id: sourceProposalId, organizationId: orgId, companyId },
      });
      if (!proposal) {
        res.status(404).json({ success: false, error: 'Source proposal not found for this company' });
        return;
      }
      if (proposal.outcome !== 'WON') {
        res.status(400).json({ success: false, error: 'Only a won proposal can seed a retainer' });
        return;
      }
      const already = await prisma.retainer.findFirst({ where: { sourceProposalId, organizationId: orgId } });
      if (already) {
        res.status(400).json({ success: false, error: 'A retainer was already created from this proposal' });
        return;
      }
    }

    let renewalDate: Date | null = null;
    if (termMonths && termMonths > 0) {
      const start = new Date(startDate);
      renewalDate = new Date(start.getFullYear(), start.getMonth() + termMonths, start.getDate());
    }

    const retainer = await prisma.retainer.create({
      data: {
        organizationId: orgId,
        companyId,
        monthlyValue,
        startDate: new Date(startDate),
        termMonths: termMonths || null,
        renewalDate,
        ownerId: ownerId || req.user!.userId,
        templateId: templateId || null,
        status: RetainerStatus.ACTIVE,
        sourceProposalId: sourceProposalId || null,
      },
    });

    /*
     * This month's card — but only if the retainer has actually started.
     *
     * It used to read `new Date()` and open a card for the current month
     * whatever `startDate` said, so a retainer signed today to begin in
     * November was billed for September the moment it was saved, and the
     * revenue showed up in a month it had not earned. The monthly roll
     * (`workers/monthCard.cron.ts`) picks it up on the 1st of the month it
     * really starts.
     */
    const startMonth = monthKey(new Date(startDate));
    const thisMonth = monthKey(new Date());
    if (startMonth <= thisMonth) {
      await prisma.monthCard.create({
        data: {
          retainerId: retainer.id,
          month: thisMonth,
          revenue: monthlyValue,
          status: 'OPEN',
        },
      });
    }

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Retainer',
        entityId: retainer.id,
        actorId: req.user!.userId,
        verb: 'retainer_created',
        payload: { companyId, monthlyValue, termMonths: termMonths || null },
      },
    });

    res.status(201).json({ success: true, retainer });
  } catch (error) {
    next(error);
  }
});

// ── 2b. Get One Retainer ─────────────────────────────────────────────────────
//
// The Month Card page needs retainer-level context (company, term, renewal,
// owner) even when the month it's been asked for has no card yet — landing
// on the current month by default and letting someone page backward/forward
// from there needs this to exist independently of any one month.

retainersRouter.get('/:id', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const id = String(req.params.id);

    const retainer = await prisma.retainer.findFirst({
      where: { id, organizationId: orgId },
      include: {
        company: { select: { id: true, name: true, vertical: true, city: true, gstin: true } },
        owner: { select: { id: true, name: true, email: true, dept: true } },
        template: { select: { id: true, name: true } },
        monthCards: { orderBy: { month: 'desc' }, select: { id: true, month: true, status: true } },
      },
    });

    if (!retainer) {
      res.status(404).json({ success: false, error: 'Retainer not found' });
      return;
    }

    res.json({
      success: true,
      retainer: {
        ...retainer,
        monthlyValue: canSeeFigures ? retainer.monthlyValue : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── 3. Get MonthCard Cockpit Detail ─────────────────────────────────────────

retainersRouter.get('/:id/month-cards/:month', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const id = String(req.params.id);
    const month = String(req.params.month);

    const monthCard = await prisma.monthCard.findFirst({
      where: { retainerId: id, month },
      include: {
        retainer: {
          include: {
            company: true,
            owner: { select: { id: true, name: true } },
          },
        },
        tasks: {
          where: { deletedAt: null },
          include: {
            assignee: { select: { id: true, name: true, designation: true, dept: true } },
            creator: { select: { id: true, name: true } },
            reviewer: { select: { id: true, name: true } },
            assignees: {
              orderBy: { assignedAt: 'asc' },
              select: { user: { select: { id: true, name: true, designation: true } } },
            },
          },
          orderBy: { dueDate: 'asc' },
        },
        costs: {
          where: { deletedAt: null },
          include: { enteredBy: { select: { id: true, name: true } } },
          orderBy: { incurredAt: 'desc' },
        },
        allocations: {
          include: {
            user: { select: { id: true, name: true, designation: true, dept: true, monthlyCost: true } },
            confirmedBy: { select: { id: true, name: true } },
          },
        },
        invoice: {
          include: { payments: true },
        },
      },
    });

    if (!monthCard) {
      res.status(404).json({ success: false, error: 'MonthCard not found' });
      return;
    }

    // Direct (Cost rows) plus people cost (allocations) — brief §8.
    const directCostsTotal =
      monthCard.costs.reduce((acc, c) => acc + Number(c.amount), 0) + allocationCost(monthCard.allocations);

    // Same server-side mask as the list endpoint: revenue, every cost line,
    // and every invoice/payment amount need money.figures, not just work.all.
    const maskedCosts = monthCard.costs.map((c) => ({ ...c, amount: canSeeFigures ? c.amount : null }));
    // monthlyCost needs setup.admin, same tighter gate team.ts already uses —
    // money.figures alone shows the allocation %, not the salary behind it.
    const canSeeSalaries = hasPermission(req.user!, 'setup.admin');
    const maskedAllocations = monthCard.allocations.map((a) => ({
      ...a,
      user: { ...a.user, monthlyCost: canSeeSalaries ? a.user.monthlyCost : undefined },
    }));
    const maskedInvoice = monthCard.invoice
      ? {
          ...monthCard.invoice,
          amount: canSeeFigures ? monthCard.invoice.amount : null,
          payments: monthCard.invoice.payments.map((p) => ({
            ...p,
            amount: canSeeFigures ? p.amount : null,
          })),
        }
      : null;

    res.json({
      success: true,
      monthCard: {
        ...monthCard,
        // Flattened, so the wire carries people rather than join rows — the
        // same shape /tasks hands back.
        tasks: monthCard.tasks.map((t) => ({ ...t, assignees: t.assignees.map((a) => a.user) })),
        revenue: canSeeFigures ? monthCard.revenue : null,
        directCostsTotal: canSeeFigures ? directCostsTotal : null,
        costs: maskedCosts,
        invoice: maskedInvoice,
        allocations: maskedAllocations,
        retainer: {
          ...monthCard.retainer,
          monthlyValue: canSeeFigures ? monthCard.retainer.monthlyValue : null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── 4. Trigger Month Roll ───────────────────────────────────────────────────

retainersRouter.post('/roll-month', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { month } = req.body;
    const result = await rollActiveRetainers(month);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// ── 5. Stop a Retainer ──────────────────────────────────────────────────────
//
// `RetainerStatus.STOPPED`, `stoppedAt` and `stopReason` have been in the
// schema since the first version and nothing has ever written them, so a
// retainer, once started, ran for ever. That is not a cosmetic gap:
//
//   · the 1st-of-month roll opens a new month card and spawns that template's
//     tasks for every ACTIVE retainer, so a departed client kept generating
//     real work on real people's screens;
//   · MRR sums `monthlyValue` over every ACTIVE retainer, so the figure never
//     came down when somebody left;
//   · the forecast drops a retainer after its `renewalDate`, but three of six
//     have no term at all, so those projected revenue indefinitely.
//
// Every one of those reads `status: 'ACTIVE'` already, which is why this route
// is the whole fix — nothing else has to change to stop counting a client who
// has gone.

const stopSchema = z.object({
  reason: z.string().min(1, 'Say why it is ending — it is the one thing nobody remembers later').max(500),
});

retainersRouter.post('/:id/stop', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = stopSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const retainer = await prisma.retainer.findFirst({
      where: { id, organizationId: orgId },
      include: { company: { select: { name: true } } },
    });
    if (!retainer) {
      res.status(404).json({ success: false, error: 'Retainer not found' });
      return;
    }
    if (retainer.status !== RetainerStatus.ACTIVE) {
      res.status(400).json({ success: false, error: 'This retainer has already been stopped' });
      return;
    }

    /*
     * What happens to the month you are part way through.
     *
     * The work of a month that has been worked is owed for, so the card stays
     * and is closed rather than removed — closing it is also what puts it in
     * front of somebody, because MONTH_CARD_NOT_INVOICED flags a closed card
     * with no invoice against it after five days. Ending a client and never
     * billing their last month is exactly the thing worth being told about.
     *
     * A card with nothing on it at all is a different case: the roll opened it
     * on the 1st, nobody has done anything against it, and leaving it behind
     * would bill for a month that never happened.
     */
    const openCards = await prisma.monthCard.findMany({
      where: { retainerId: id, status: 'OPEN' },
      include: { _count: { select: { tasks: true, costs: true } } },
    });

    const empty = openCards.filter((c) => c._count.tasks === 0 && c._count.costs === 0 && !c.invoiceId);
    const worked = openCards.filter((c) => !empty.some((e) => e.id === c.id));

    const stopped = await prisma.$transaction(async (tx) => {
      if (empty.length > 0) {
        await tx.monthCard.deleteMany({ where: { id: { in: empty.map((c) => c.id) } } });
      }
      if (worked.length > 0) {
        await tx.monthCard.updateMany({
          where: { id: { in: worked.map((c) => c.id) } },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      }

      const updated = await tx.retainer.update({
        where: { id },
        data: {
          status: RetainerStatus.STOPPED,
          stoppedAt: new Date(),
          stopReason: parsed.data.reason.trim(),
        },
      });

      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Retainer',
          entityId: id,
          actorId: req.user!.userId,
          verb: 'retainer_stopped',
          payload: {
            companyName: retainer.company.name,
            reason: parsed.data.reason.trim(),
            monthsClosed: worked.map((c) => c.month),
            emptyMonthsRemoved: empty.map((c) => c.month),
          },
        },
      });

      return updated;
    });

    res.json({
      success: true,
      retainer: stopped,
      // So the caller can say what it did rather than "done".
      closedMonths: worked.map((c) => c.month),
      removedMonths: empty.map((c) => c.month),
    });
  } catch (error) {
    next(error);
  }
});
