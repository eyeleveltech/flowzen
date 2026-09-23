import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest, hasPermission } from '../middleware/auth.js';
import { rollActiveRetainers } from '../workers/monthCard.cron.js';
import { CompanyStatus, RetainerStatus, RetainerProjectStatus } from '@prisma/client';
import { monthKey } from '../utils/retainerMonths.js';
import { TASK_PEOPLE, withPeople } from './tasks.js';
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
    /** Today as `yyyy-mm-dd`, for the late comparison below. */
    const todayKey = new Date().toISOString().slice(0, 10);
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
          monthCards: {
            orderBy: { month: 'desc' },
            take: 3,
            include: {
              invoice: { select: { id: true, number: true, status: true } },
              tasks: { where: { deletedAt: null }, select: { status: true, dueDate: true } },
            },
          },
          /*
           * What the client is actually buying, by name.
           *
           * The list's only column about the work was "1 of 5 tasks done" for
           * the current month — a number that says nothing about what the
           * retainer IS. A retainer is a Diwali campaign and an always-on
           * stream, and that is the thing to show next to the fee.
           *
           * Names and statuses only; the per-task counts belong on the
           * retainer's own screen, and pulling them here would be a task read
           * across every retainer on the page.
           */
          projects: {
            orderBy: [{ status: 'asc' }, { startDate: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, status: true, endDate: true },
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
      /*
       * How much of it is already late.
       *
       * The list could say "11 of 18 done" and nothing else, and 11 of 18 reads
       * the same whether the other seven are due next week or were due last
       * Tuesday. Without this the only way to find the client who needs you is
       * to open every client, which is the opposite of what a list is for.
       *
       * Same definition as everywhere else: past its due date and neither done
       * nor cancelled. Compared as `yyyy-mm-dd` strings so a task due today is
       * not late at one minute past midnight.
       */
      const monthTasksLate =
        activeMonthCard?.tasks.filter(
          (t) =>
            t.status !== 'DONE' &&
            t.status !== 'CANCELLED' &&
            t.dueDate.toISOString().slice(0, 10) < todayKey,
        ).length ?? 0;

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
        activeMonthCard: maskedActiveMonthCard,
        recentMonthCards: maskedMonthCards,
        renewalDaysLeft,
        isExpiringSoon,
        noFixedTermRisk: !r.termMonths && !r.renewalDate,
        monthTasksDone,
        monthTasksTotal,
        monthTasksLate,
        /*
         * The named pieces of work inside it, and how many are still running.
         *
         * `active` rather than the raw length, because a finished campaign is
         * not something the list should keep advertising — but the full set
         * goes out too, so the row can say "3 · 1 done" without a second call.
         */
        projects: r.projects,
        activeProjectCount: r.projects.filter((p) => p.status === 'ACTIVE').length,
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
        { label: 'Projects running', value: (r) => r.activeProjectCount },
        { label: 'Projects', value: (r) => r.projects.map((p) => p.name).join('; ') },
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
  /**
   * What to call the first piece of work, instead of the placeholder.
   *
   * Every retainer gets one project made with it, because a retainer task must
   * name one. It used to be called "Monthly Retainer Work" always -- a name
   * nobody chose, appearing on the client's page before anybody had said what
   * the retainer is for, and impossible to delete because it is the fallback
   * every other project's tasks move into. Asking here means the first thing
   * you see is your own words.
   */
  firstProjectName: z.string().trim().min(1).max(80).optional(),
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
    const { companyId, monthlyValue, startDate, termMonths, ownerId, firstProjectName, sourceProposalId } = parsed.data;

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
        where: { id: sourceProposalId, organizationId: orgId, companyId, deletedAt: null },
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
        status: RetainerStatus.ACTIVE,
        sourceProposalId: sourceProposalId || null,
      },
    });

    /*
     * Every retainer starts with somewhere to put its work.
     *
     * A retainer task must name a project, so a retainer with none could not
     * hold a task at all — the month roll would fail on the 1st and the create
     * form would have an empty picker. This is the one that catches the
     * monthly baseline; campaigns are added beside it.
     *
     * Named for what it is rather than for work nobody has scoped yet.
     */
    await prisma.retainerProject.create({
      data: {
        retainerId: retainer.id,
        name: firstProjectName || 'Monthly Retainer Work',
        ownerId: ownerId || req.user!.userId,
        isDefault: true,
        description: firstProjectName
          ? null
          : 'The monthly work this retainer is for. Campaigns and one-off pieces sit beside it.',
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
        monthCards: { orderBy: { month: 'desc' }, select: { id: true, month: true, status: true } },
        projects: {
          orderBy: [{ status: 'asc' }, { startDate: 'asc' }, { name: 'asc' }],
          include: {
            owner: { select: { id: true, name: true, designation: true } },
            _count: { select: { tasks: true } },
            // Same summary the list route builds, because this is the response
            // the retainer screen draws its project cards from — and a card
            // that cannot say how its work is going is a card nobody opens.
            tasks: {
              where: { deletedAt: null },
              select: { status: true, dueDate: true, monthCard: { select: { month: true } } },
            },
          },
        },
      },
    });

    if (!retainer) {
      res.status(404).json({ success: false, error: 'Retainer not found' });
      return;
    }

    /*
     * And the work that belongs to no project.
     *
     * Not a leftover bucket — it is where every month-card task on this
     * retainer currently sits, so the screen needs to be able to draw it as a
     * card beside the real projects with the same figures on it. Computed here
     * rather than counted on the client, which only ever sees one month and
     * would put a month's number on a card that opens onto all of them.
     */
    const unfiledTasks = await prisma.task.findMany({
      where: {
        deletedAt: null,
        retainerProjectId: null,
        monthCard: { retainerId: retainer.id },
      },
      select: { status: true, dueDate: true, monthCard: { select: { month: true } } },
    });
    const unfiled = summariseProject({ tasks: unfiledTasks });

    res.json({
      success: true,
      retainer: {
        ...retainer,
        projects: retainer.projects.map(summariseProject),
        unfiled,
        monthlyValue: canSeeFigures ? retainer.monthlyValue : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2b. Projects inside a retainer ──────────────────────────────────────────
//
// A named piece of work — a campaign, a film, an always-on stream — that the
// team's tasks hang under. It holds no money: the retainer is already billed
// monthly through its month cards, and a second value here would be the same
// work counted twice.
//
// Gated on `work.all` rather than `company.write`: naming a campaign is work
// organisation, not a commercial change to the contract. Stopping a retainer
// or changing its monthly value is the thing that needs the heavier switch.

const retainerProjectSchema = z.object({
  name: z.string().trim().min(1, 'Give the project a name').max(120),
  startDate: z.string().min(1).optional().nullable(),
  /** Null is not 'unknown' — it is what ongoing means. */
  endDate: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  status: z.nativeEnum(RetainerProjectStatus).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
});

/** The retainer, confirmed to be this caller's. Every route below starts here. */
async function findRetainer(id: string, organizationId: string) {
  return prisma.retainer.findFirst({ where: { id, organizationId }, select: { id: true } });
}

/** Cancelled work is not outstanding work, and not finished work either. */
const COUNTED = (s: string) => s !== 'CANCELLED';

/**
 * A project row, with how its work is going.
 *
 * The same shape wherever a project is listed, so the card on the retainer and
 * the header inside it cannot disagree about how many tasks are open. `months`
 * is what makes a campaign legible: a Diwali push that runs October into
 * November says so, rather than looking like two unrelated piles.
 */
function summariseProject<
  T extends { tasks: { status: string; dueDate: Date; monthCard: { month: string } | null }[] },
>(p: T) {
  const today = new Date().toISOString().slice(0, 10);
  const counted = p.tasks.filter((t) => COUNTED(t.status));
  const done = counted.filter((t) => t.status === 'DONE').length;
  const late = counted.filter(
    (t) => t.status !== 'DONE' && new Date(t.dueDate).toISOString().slice(0, 10) < today,
  ).length;
  const months = [...new Set(p.tasks.map((t) => t.monthCard?.month).filter(Boolean))].sort() as string[];
  const { tasks: _dropped, ...rest } = p;
  return {
    ...rest,
    taskCounts: {
      total: counted.length,
      done,
      open: counted.length - done,
      late,
      cancelled: p.tasks.length - counted.length,
      // Nought of nought is not 0% done, it is nothing to be a share of.
      donePercent: counted.length > 0 ? Math.round((done / counted.length) * 100) : null,
    },
    months,
  };
}

retainersRouter.get('/:id/projects', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const retainer = await findRetainer(String(req.params.id), orgId);
    if (!retainer) {
      res.status(404).json({ success: false, error: 'Retainer not found' });
      return;
    }
    const projects = await prisma.retainerProject.findMany({
      where: { retainerId: retainer.id },
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }, { name: 'asc' }],
      include: {
        owner: { select: { id: true, name: true, designation: true } },
        _count: { select: { tasks: true } },
        /*
         * Enough of each task to say how the project is going.
         *
         * The list is now the way into a retainer's work rather than a caption
         * above it, so a row has to carry more than a name: how much is done,
         * how much is late, and which months it actually touches. Statuses and
         * due dates only — the rows themselves are fetched when you open one.
         */
        tasks: {
          where: { deletedAt: null },
          select: { status: true, dueDate: true, monthCard: { select: { month: true } } },
        },
      },
    });

    res.json({ success: true, projects: projects.map(summariseProject) });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/retainers/:id/projects/:projectId/tasks — one project, opened.
 *
 * Across every month it touches, not just the one on screen. That is the whole
 * reason a retainer project exists: a campaign running October into November
 * was some tasks in one month card and some more in the next, with nothing
 * joining them. Filtering this to the selected month would put the work back
 * in the two piles the feature was built to join.
 *
 * `:projectId` may be the literal `none`, which answers with the month's work
 * that belongs to no project. Every task in this database is currently one of
 * those, so a screen that could only reach work through a project would be a
 * screen with nothing on it.
 */
retainersRouter.get(
  '/:id/projects/:projectId/tasks',
  requirePermission('work.all'),
  async (req: AuthRequest, res: Response, next) => {
    try {
      const orgId = req.user!.organizationId;
      const retainer = await findRetainer(String(req.params.id), orgId);
      if (!retainer) {
        res.status(404).json({ success: false, error: 'Retainer not found' });
        return;
      }
      const projectId = String(req.params.projectId);
      const unfiled = projectId === 'none';

      let project = null;
      if (!unfiled) {
        project = await prisma.retainerProject.findFirst({
          where: { id: projectId, retainerId: retainer.id },
          include: {
            owner: { select: { id: true, name: true, designation: true } },
            _count: { select: { tasks: true } },
            tasks: {
              where: { deletedAt: null },
              select: { status: true, dueDate: true, monthCard: { select: { month: true } } },
            },
          },
        });
        if (!project) {
          res.status(404).json({ success: false, error: 'Project not found on this retainer' });
          return;
        }
      }

      const tasks = await prisma.task.findMany({
        where: {
          deletedAt: null,
          // Scoped through the month card's retainer, so "none" cannot reach
          // another client's unfiled work.
          monthCard: { retainerId: retainer.id },
          ...(unfiled ? { retainerProjectId: null } : { retainerProjectId: projectId }),
        },
        include: {
          ...TASK_PEOPLE,
          monthCard: { select: { id: true, month: true, status: true } },
          retainerProject: { select: { id: true, name: true, status: true } },
        },
        orderBy: [{ dueDate: 'asc' }],
      });

      /*
       * Grouped by the month that bills them, newest first.
       *
       * The month is not decoration here — it is which card the task's cost and
       * profit land on, and a closed month is one the screen must not offer to
       * edit. Carrying the status through means the drill-in knows that without
       * a second request per group.
       */
      const byMonth = new Map<string, { month: string; status: string; tasks: unknown[] }>();
      for (const t of tasks) {
        const key = t.monthCard?.month ?? 'unfiled';
        const group = byMonth.get(key) ?? {
          month: key,
          status: t.monthCard?.status ?? 'OPEN',
          tasks: [],
        };
        group.tasks.push(withPeople(t));
        byMonth.set(key, group);
      }

      res.json({
        success: true,
        project: project ? summariseProject(project) : null,
        months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)),
        total: tasks.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

retainersRouter.post('/:id/projects', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = retainerProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const retainer = await findRetainer(String(req.params.id), orgId);
    if (!retainer) {
      res.status(404).json({ success: false, error: 'Retainer not found' });
      return;
    }

    const { name, startDate, endDate, ownerId, description } = parsed.data;
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      res.status(400).json({ success: false, error: 'The end date is before the start date' });
      return;
    }
    if (ownerId && !(await prisma.user.findFirst({ where: { id: ownerId, organizationId: orgId, active: true } }))) {
      res.status(404).json({ success: false, error: 'That owner is not on this team' });
      return;
    }

    const project = await prisma.retainerProject.create({
      data: {
        retainerId: retainer.id,
        name,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        ownerId: ownerId || null,
        description: description || null,
      },
      include: { owner: { select: { id: true, name: true, designation: true } }, _count: { select: { tasks: true } } },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Retainer',
        entityId: retainer.id,
        actorId: req.user!.userId,
        verb: 'retainer_project_created',
        payload: { projectId: project.id, name: project.name },
      },
    });

    res.status(201).json({ success: true, project });
  } catch (error) {
    next(error);
  }
});

retainersRouter.patch('/:id/projects/:projectId', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = retainerProjectSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    // Scoped through the retainer, not matched on the id in the URL alone.
    const existing = await prisma.retainerProject.findFirst({
      where: {
        id: String(req.params.projectId),
        retainerId: String(req.params.id),
        retainer: { organizationId: orgId },
      },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Project not found on this retainer' });
      return;
    }

    const d = parsed.data;
    const start = d.startDate !== undefined ? (d.startDate ? new Date(d.startDate) : null) : existing.startDate;
    const end = d.endDate !== undefined ? (d.endDate ? new Date(d.endDate) : null) : existing.endDate;
    if (start && end && end < start) {
      res.status(400).json({ success: false, error: 'The end date is before the start date' });
      return;
    }
    if (d.ownerId && !(await prisma.user.findFirst({ where: { id: d.ownerId, organizationId: orgId, active: true } }))) {
      res.status(404).json({ success: false, error: 'That owner is not on this team' });
      return;
    }

    const project = await prisma.retainerProject.update({
      where: { id: existing.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.startDate !== undefined ? { startDate: start } : {}),
        ...(d.endDate !== undefined ? { endDate: end } : {}),
        ...(d.ownerId !== undefined ? { ownerId: d.ownerId || null } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.description !== undefined ? { description: d.description || null } : {}),
      },
      include: { owner: { select: { id: true, name: true, designation: true } }, _count: { select: { tasks: true } } },
    });

    res.json({ success: true, project });
  } catch (error) {
    next(error);
  }
});

/**
 * Removing a project does not remove the work done under it.
 *
 * Its tasks stay on their month card — which is where the month's cost and
 * profit are counted from — and simply stop being grouped. Deleting the tasks
 * with it would silently change a closed month's figures.
 */
retainersRouter.delete('/:id/projects/:projectId', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.retainerProject.findFirst({
      where: {
        id: String(req.params.projectId),
        retainerId: String(req.params.id),
        retainer: { organizationId: orgId },
      },
      include: { _count: { select: { tasks: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Project not found on this retainer' });
      return;
    }

    /*
     * The default is the floor, and a floor cannot be removed.
     *
     * Every retainer task names a project, so deleting the one that catches
     * the monthly baseline would leave the next roll with nowhere to put its
     * work. The database refuses it too.
     */
    if (existing.isDefault) {
      res.status(400).json({
        success: false,
        error: 'This is where the retainer’s monthly work goes, so it cannot be removed. Rename it instead.',
      });
      return;
    }

    /*
     * Its tasks move rather than losing their project.
     *
     * The foreign key is ON DELETE SET NULL, which now breaks the CHECK saying
     * a month-card task names a project — the delete would fail with a
     * constraint error nobody could read. They go to the default, which is
     * what "the campaign is over, the work still happened" actually means.
     */
    const fallback = await prisma.retainerProject.findFirst({
      where: { retainerId: existing.retainerId, isDefault: true },
      select: { id: true, name: true },
    });
    if (!fallback) {
      res.status(409).json({
        success: false,
        error: 'That retainer has no default project to move the work into',
      });
      return;
    }
    await prisma.task.updateMany({
      where: { retainerProjectId: existing.id },
      data: { retainerProjectId: fallback.id },
    });

    await prisma.retainerProject.delete({ where: { id: existing.id } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Retainer',
        entityId: String(req.params.id),
        actorId: req.user!.userId,
        verb: 'retainer_project_deleted',
        payload: {
          name: existing.name,
          tasksMoved: existing._count.tasks,
          movedTo: fallback.name,
        },
      },
    });

    res.json({ success: true, tasksMoved: existing._count.tasks, movedTo: fallback.name });
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
      // Scoped through the retainer, not just matched on the id in the URL.
      // Without the organisation here this route answered for ANY retainer id
      // — the whole cockpit (company, tasks, costs, allocations, invoice and
      // its payments) for a month belonging to somebody else's organisation.
      where: { retainerId: id, month, retainer: { organizationId: orgId } },
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
            // What this task is FOR, as opposed to which month it is
            // billed in. The month's list groups by it.
            retainerProject: { select: { id: true, name: true, status: true } },
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

    /*
     * Whether anybody has said what the month cost.
     *
     * With no cost rows and no allocations the arithmetic gives profit = the
     * whole fee and a 100% margin, and the card showed exactly that — a month
     * nobody had costed read as the best month the studio had ever had. The
     * figure is not wrong so much as not a figure yet, so the screen is told
     * which it is rather than being left to guess from a zero.
     */
    const costBasis: 'recorded' | 'none' =
      monthCard.costs.length + monthCard.allocations.length === 0 ? 'none' : 'recorded';

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
        costBasis,
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

/**
 * POST /api/retainers/:id/month-cards/:month/reopen — put a closed month back
 * into play.
 *
 * The other half of making a closed month actually closed. Refusing every
 * write without offering a way through would only mean the real correction —
 * a cost that genuinely belongs to August — never gets recorded at all, and
 * the number stays wrong for a better-sounding reason.
 *
 * So: deliberate, gated on setup.admin rather than cost.enter, and it leaves a
 * row saying who did it and why. Reopening is the exception; the refusal is
 * the rule.
 */
retainersRouter.post(
  '/:id/month-cards/:month/reopen',
  requirePermission('setup.admin'),
  async (req: AuthRequest, res: Response, next) => {
    try {
      const orgId = req.user!.organizationId;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length < 3) {
        res.status(400).json({ success: false, error: 'Say why the month is being reopened' });
        return;
      }

      const card = await prisma.monthCard.findFirst({
        where: {
          retainerId: String(req.params.id),
          month: String(req.params.month),
          retainer: { organizationId: orgId },
        },
        select: { id: true, status: true, month: true },
      });
      if (!card) {
        res.status(404).json({ success: false, error: 'MonthCard not found' });
        return;
      }
      if (card.status !== 'CLOSED') {
        res.status(400).json({ success: false, error: 'That month is already open' });
        return;
      }

      await prisma.monthCard.update({
        where: { id: card.id },
        data: { status: 'OPEN', closedAt: null },
      });

      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'MonthCard',
          entityId: card.id,
          actorId: req.user!.userId,
          verb: 'month_card_reopened',
          payload: { month: card.month, reason },
        },
      });

      res.json({ success: true, month: card.month });
    } catch (error) {
      next(error);
    }
  },
);

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
//   · the 1st-of-month roll opens a new month card for every ACTIVE retainer,
//     so a departed client kept billing;
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

// ── 6. Edit a Retainer ──────────────────────────────────────────────────────
//
// A retainer could be started and stopped but never corrected, so a rate
// agreed at ₹50,000 and typed as ₹5,000 was permanent — and it is the number
// MRR, the forecast and every month card are built from.
//
// Two things are deliberately not editable here:
//
//   · `companyId`, for the same reason a proposal cannot be moved — the
//     one-live-retainer-per-client rule and every figure already recorded
//     against this client are built on it. Stop it and start the right one.
//   · `renewalDate`, because it is derived (§8): startDate + termMonths, the
//     same formula the create route uses. Accepting it here would make two
//     writers for one value, and the one that skipped the formula would win.
//
// `status` is not here either — POST /:id/stop is how a retainer ends, and it
// has real work to do (closing or removing the open month card) that a status
// write would skip.

const retainerEditSchema = z
  .object({
    monthlyValue: z.number().positive('Monthly value must be positive').optional(),
    startDate: z.string().min(1).optional(),
    termMonths: z.number().int().positive().nullable().optional(),
    ownerId: z.string().min(1).optional(),
    /*
     * What a new rate does to the month you are part way through.
     *
     * A month card snapshots `revenue` when it is opened, so a rate change is
     * otherwise invisible until the next roll — and the current month would be
     * invoiced at the old rate with nothing saying so. Defaulting to true
     * treats a re-rate as effective now, which is the usual case; send false
     * when it starts next month. Either way the response says how many cards
     * moved, and a card that is closed or already invoiced is never touched.
     */
    repriceOpenMonth: z.boolean().optional().default(true),
  })
  .refine(
    (v) =>
      v.monthlyValue !== undefined ||
      v.startDate !== undefined ||
      v.termMonths !== undefined ||
      v.ownerId !== undefined,
    { message: 'Nothing to change' },
  );

retainersRouter.patch('/:id', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = retainerEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const { monthlyValue, startDate, termMonths, ownerId, repriceOpenMonth } = parsed.data;

    const existing = await prisma.retainer.findFirst({
      where: { id, organizationId: orgId },
      include: { company: { select: { name: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Retainer not found' });
      return;
    }

    // A stopped retainer's months are closed and its figures have settled into
    // MRR history and the forecast. Editing it would move numbers for months
    // that are already reported.
    if (existing.status !== RetainerStatus.ACTIVE) {
      res.status(400).json({
        success: false,
        error: 'This retainer has been stopped. Start a new one rather than editing a closed arrangement.',
      });
      return;
    }

    if (ownerId !== undefined && ownerId !== existing.ownerId) {
      const owner = await prisma.user.findFirst({
        where: { id: ownerId, organizationId: orgId, active: true },
        select: { id: true },
      });
      if (!owner) {
        res.status(404).json({ success: false, error: 'That person is not on the team' });
        return;
      }
    }

    const nextStart = startDate !== undefined ? new Date(startDate) : existing.startDate;
    if (startDate !== undefined && Number.isNaN(nextStart.getTime())) {
      res.status(400).json({ success: false, error: 'Start date is not a real date' });
      return;
    }

    // Moving the start forward past a month that has already been opened would
    // leave a card for a month the retainer now says had not begun.
    if (startDate !== undefined) {
      const earliest = await prisma.monthCard.findFirst({
        where: { retainerId: id },
        orderBy: { month: 'asc' },
        select: { month: true },
      });
      if (earliest && monthKey(nextStart) > earliest.month) {
        res.status(400).json({
          success: false,
          error: `This retainer already has a month card for ${earliest.month}. The start date cannot be later than the first month worked.`,
        });
        return;
      }
    }

    // Derived, never accepted: same formula as the create route.
    const nextTerm = termMonths !== undefined ? termMonths : existing.termMonths;
    const nextRenewal =
      nextTerm && nextTerm > 0
        ? new Date(nextStart.getFullYear(), nextStart.getMonth() + nextTerm, nextStart.getDate())
        : null;

    const rateChanged = monthlyValue !== undefined && Number(existing.monthlyValue) !== monthlyValue;
    const startChanged = startDate !== undefined && nextStart.getTime() !== existing.startDate.getTime();
    const termChanged = termMonths !== undefined && (termMonths ?? null) !== (existing.termMonths ?? null);
    const ownerChanged = ownerId !== undefined && ownerId !== existing.ownerId;

    // Resending what is already there writes nothing — no row, no month-card
    // reprice, and no "edited" line in the client's activity feed for a save
    // that changed no figure.
    if (!rateChanged && !startChanged && !termChanged && !ownerChanged) {
      const { company: _company, ...unchanged } = existing;
      res.json({ success: true, retainer: unchanged, repricedCards: 0 });
      return;
    }

    const { retainer, repricedCards } = await prisma.$transaction(async (tx) => {
      const updated = await tx.retainer.update({
        where: { id },
        data: {
          ...(rateChanged ? { monthlyValue } : {}),
          ...(startChanged ? { startDate: nextStart } : {}),
          ...(termChanged ? { termMonths } : {}),
          ...(startChanged || termChanged ? { renewalDate: nextRenewal } : {}),
          ...(ownerChanged ? { ownerId } : {}),
        },
      });

      let count = 0;
      if (rateChanged && repriceOpenMonth) {
        // Open and not yet invoiced only. A closed month has been worked and a
        // billed one has gone to the client; both are records, not intentions.
        const result = await tx.monthCard.updateMany({
          where: { retainerId: id, status: 'OPEN', invoiceId: null },
          data: { revenue: monthlyValue },
        });
        count = result.count;
      }

      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Retainer',
          entityId: id,
          actorId: req.user!.userId,
          verb: 'retainer_edited',
          payload: {
            companyName: existing.company.name,
            ...(rateChanged
              ? { monthlyValueFrom: Number(existing.monthlyValue), monthlyValueTo: monthlyValue, repricedCards: count }
              : {}),
            ...(startChanged ? { startDateTo: nextStart.toISOString().slice(0, 10) } : {}),
            ...(termChanged ? { termMonthsFrom: existing.termMonths, termMonthsTo: termMonths } : {}),
            ...(ownerChanged ? { ownerFrom: existing.ownerId, ownerTo: ownerId } : {}),
          },
        },
      });

      return { retainer: updated, repricedCards: count };
    });

    res.json({ success: true, retainer, repricedCards });
  } catch (error) {
    next(error);
  }
});
