import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { changesBetween } from '../utils/activityDiff.js';
import { authenticate, requirePermission, type AuthRequest, hasPermission } from '../middleware/auth.js';
import { CompanyStatus, ProjectStatus, MilestoneStatus, Priority } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { jobProfit, percentComplete, costRisk } from '../utils/jobProfit.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';

export const projectsRouter = Router();

projectsRouter.use(authenticate);

// actualCost = Cost rows + PeopleAllocation% x monthlyCost (brief §8, "Derived,
// never stored") — costs alone was the whole of it before, which meant every
// margin figure on this screen quietly excluded salary, the largest cost.
const allocationCost = (allocations: { percent: number; user: { monthlyCost: unknown } }[]) =>
  allocations.reduce((acc, a) => acc + (a.percent / 100) * Number(a.user.monthlyCost), 0);

// ── 1. List Projects ────────────────────────────────────────────────────────

projectsRouter.get('/', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const { status, companyId } = req.query;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    const where: any = { organizationId: orgId, deletedAt: null };
    if (status && typeof status === 'string' && ['LIVE', 'DELIVERED', 'CANCELLED'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as ProjectStatus;
    }
    if (companyId && typeof companyId === 'string') {
      where.companyId = companyId;
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          company: { select: { id: true, name: true, vertical: true, city: true } },
          owner: { select: { id: true, name: true, email: true } },
          milestones: { orderBy: { order: 'asc' } },
          tasks: { where: { deletedAt: null }, select: { id: true, status: true } },
          costs: { where: { deletedAt: null }, select: { amount: true } },
          allocations: { select: { percent: true, user: { select: { monthlyCost: true } } } },
        },
      }),
      prisma.project.count({ where }),
    ]);

    // Live-work's risk flags (brief §12: PROJECT_OVER_ESTIMATE, PROJECT_BEHIND_SCHEDULE)
    // read the real Alert rows the hourly scanner already raises, rather than
    // the frontend re-deriving a simplified approximation of the same rules.
    const openAlerts = await prisma.alert.findMany({
      where: { organizationId: orgId, entityType: 'Project', entityId: { in: projects.map((p) => p.id) }, resolvedAt: null },
      select: { entityId: true, rule: true, severity: true, message: true },
    });
    const alertsByProject = new Map<string, typeof openAlerts>();
    for (const a of openAlerts) {
      alertsByProject.set(a.entityId, [...(alertsByProject.get(a.entityId) ?? []), a]);
    }

    const formatted = projects.map((p) => {
      const directCost = p.costs.reduce((acc, c) => acc + Number(c.amount), 0);
      const peopleCost = allocationCost(p.allocations);
      const actualCostTotal = directCost + peopleCost;
      const profit = jobProfit({
        quotedValue: Number(p.quotedValue),
        directCost,
        peopleCost,
        costEntries: p.costs.length + p.allocations.length,
      });
      const progress = percentComplete({
        milestones: p.milestones,
        startDate: p.startDate,
        endDate: p.endDate,
      });
      const risk = costRisk({ profit, percentComplete: progress.percent });
      const totalMilestones = p.milestones.length;
      const paidMilestones = p.milestones.filter((m) => m.status === 'PAID').length;
      const openTasks = p.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length;

      // Same rule as retainers: work.all is operational visibility, not a
      // right to see a rupee figure. Only money.figures is. A HEAD carries
      // work.all without money.figures.
      const maskedMilestones = p.milestones.map((m) => ({
        ...m,
        amount: canSeeFigures ? m.amount : null,
      }));

      return {
        id: p.id,
        name: p.name,
        companyId: p.companyId,
        company: p.company,
        quotedValue: canSeeFigures ? p.quotedValue : null,
        // Not money, so not masked: whether work was given away is a fact
        // about the work, and the list has to label it either way.
        isSample: p.isSample,
        // A rate, not a figure, so it is not masked with the money.
        gstPercent: p.gstPercent == null ? null : Number(p.gstPercent),
        actualCostTotal: canSeeFigures ? actualCostTotal : null,
        ...(canSeeFigures ? { profit, costRisk: risk } : {}),
        percentComplete: progress.percent,
        percentCompleteBasis: progress.basis,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status,
        priority: p.priority,
        owner: p.owner,
        milestones: maskedMilestones,
        milestoneProgress: totalMilestones > 0 ? Math.round((paidMilestones / totalMilestones) * 100) : 0,
        openTasksCount: openTasks,
        totalTasksCount: p.tasks.length,
        alerts: alertsByProject.get(p.id) ?? [],
      };
    });

    if (wantsCsv) {
      const csv = toCsv(formatted, [
        { label: 'Name', value: (p) => p.name },
        { label: 'Company', value: (p) => p.company.name },
        { label: 'Quoted value', value: (p) => (p.quotedValue != null ? Number(p.quotedValue) : '') },
        { label: 'Actual cost', value: (p) => (p.actualCostTotal != null ? Number(p.actualCostTotal) : '') },
        { label: 'External cost', value: (p) => p.profit?.directCost ?? '' },
        { label: 'People cost', value: (p) => p.profit?.peopleCost ?? '' },
        // Blank, not a number, when nobody has recorded what the job cost —
        // a spreadsheet full of 100% margins is exactly how the unrecorded
        // ones get quoted from.
        { label: 'Profit', value: (p) => (p.profit?.costBasis === 'none' ? '' : p.profit?.profit ?? '') },
        { label: 'Margin %', value: (p) => (p.profit?.costBasis === 'none' ? '' : p.profit?.marginPercent ?? '') },
        { label: 'Costs recorded', value: (p) => (p.profit?.costBasis === 'none' ? 'no' : 'yes') },
        { label: 'Status', value: (p) => p.status },
        { label: 'Owner', value: (p) => p.owner.name },
        { label: 'Milestone progress %', value: (p) => p.milestoneProgress },
        { label: 'Open tasks', value: (p) => p.openTasksCount },
      ]);
      sendCsv(res, `projects-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      projects: formatted,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 1c. Did we make money on these jobs? ────────────────────────────────────
//
// The projects half of the Money screen's profit table. Retainers have had
// `/retainers/profitability` since Phase 5 and projects have had nothing, so
// "did we make money on that job" (brief §1) was answerable for the recurring
// work and not for the one-off work — and one-off work is where it matters
// most, because a project ENDS. A retainer's bad month is next month's
// problem; a project's bad margin is found once it is already delivered.
//
// Deliberately NOT merged into the retainer table, and not summed with it.
// Brief §8 is explicit that retainer and one-time money are "reported split by
// Retainer and One time, never summed into a single figure" — a month of
// retainer revenue and a project's whole contract value are different kinds of
// number, and adding them produces something that answers no question.

projectsRouter.get(
  '/profitability',
  requirePermission('money.figures'),
  async (req: AuthRequest, res: Response, next) => {
    try {
      const orgId = req.user!.organizationId;
      const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;

      const projects = await prisma.project.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          ...(status && ['LIVE', 'DELIVERED', 'CANCELLED'].includes(status)
            ? { status: status as ProjectStatus }
            : {}),
        },
        include: {
          company: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          milestones: { select: { status: true } },
          costs: { where: { deletedAt: null }, select: { amount: true } },
          allocations: { include: { user: { select: { monthlyCost: true } } } },
        },
      });

      const rows = projects.map((p) => {
        const directCost = p.costs.reduce((acc, c) => acc + Number(c.amount), 0);
        const peopleCost = allocationCost(p.allocations);
        const profit = jobProfit({
          quotedValue: Number(p.quotedValue),
          directCost,
          peopleCost,
          costEntries: p.costs.length + p.allocations.length,
        });
        const progress = percentComplete({
          milestones: p.milestones,
          startDate: p.startDate,
          endDate: p.endDate,
        });
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          company: p.company,
          owner: p.owner,
          endDate: p.endDate,
          percentComplete: progress.percent,
          percentCompleteBasis: progress.basis,
          ...profit,
          costRisk: costRisk({ profit, percentComplete: progress.percent }),
        };
      });

      // Delivered jobs are the only ones whose profit is FINAL. A live job's
      // figure is a running total that will still move, and averaging the two
      // together would produce a company margin that quietly improves every
      // time somebody starts a new project and has not spent anything on it
      // yet. So the totals are split, and the delivered set is the one worth
      // quoting from (brief §11.3 step 6: the closing figure "feeds the next
      // quote for similar work").
      const sum = (set: typeof rows) =>
        set.reduce(
          (acc, r) => ({
            count: acc.count + 1,
            revenue: acc.revenue + r.revenue,
            directCost: acc.directCost + r.directCost,
            peopleCost: acc.peopleCost + r.peopleCost,
            profit: acc.profit + r.profit,
          }),
          { count: 0, revenue: 0, directCost: 0, peopleCost: 0, profit: 0 },
        );
      const withMargin = (t: ReturnType<typeof sum>) => ({
        ...t,
        marginPercent: t.revenue > 0 ? Math.round((t.profit / t.revenue) * 1000) / 10 : null,
      });

      const delivered = rows.filter((r) => r.status === 'DELIVERED');
      const live = rows.filter((r) => r.status === 'LIVE');

      res.json({
        success: true,
        rows: rows.sort((a, b) => (a.marginPercent ?? 0) - (b.marginPercent ?? 0)),
        totals: {
          delivered: withMargin(sum(delivered)),
          live: withMargin(sum(live)),
        },
        atRisk: rows.filter((r) => r.costRisk.level === 'OVER' || r.costRisk.level === 'LOSS').length,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── 1b. Trash — soft-deleted projects ───────────────────────────────────────
//
// §16 mandates soft delete but never a way back to it — without this, a
// soft delete is functionally a hard delete from a user's side. setup.admin
// only: recovery is an administrative action, same tier as the delete itself.
// Registered ahead of GET /:id — otherwise "trash" would match as an id.

projectsRouter.get('/trash', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const projects = await prisma.project.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      include: { company: { select: { id: true, name: true } } },
    });
    res.json({ success: true, projects });
  } catch (error) {
    next(error);
  }
});

// ── 2. Get Project Detail Cockpit ───────────────────────────────────────────

projectsRouter.get('/:id', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const id = String(req.params.id);

    const project = await prisma.project.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        company: true,
        owner: { select: { id: true, name: true, email: true, dept: true } },
        milestones: {
          orderBy: { order: 'asc' },
          include: {
            proformas: { select: { id: true, number: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            // The invoice that settles it, which is what the screen needs to
            // offer "record the payment" against the right document.
            invoices: {
              where: { status: { not: 'CANCELLED' } },
              // `paidAt` is the date the client paid — the one entered on the
              // payment, not the day somebody got round to recording it.
              select: { id: true, number: true, amount: true, status: true, paidAt: true },
              orderBy: { raisedAt: 'desc' },
              take: 1,
            },
          },
        },
        tasks: {
          where: { deletedAt: null },
          include: { assignee: { select: { id: true, name: true, designation: true, dept: true } } },
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
        invoices: {
          include: { payments: true },
          orderBy: { raisedAt: 'desc' },
        },
      },
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const directCost = project.costs.reduce((acc, c) => acc + Number(c.amount), 0);
    const peopleCost = allocationCost(project.allocations);
    const actualCostTotal = directCost + peopleCost;

    // "Did we make money on that job" (brief §1) — answerable for retainers
    // since Phase 5 and, until now, not for projects. `actualCostTotal` alone
    // could not say whether an overspend was vendors or people, which is the
    // part that changes what the next quote looks like.
    const profit = jobProfit({
      quotedValue: Number(project.quotedValue),
      directCost,
      peopleCost,
      costEntries: project.costs.length + project.allocations.length,
    });
    const progress = percentComplete({
      milestones: project.milestones,
      startDate: project.startDate,
      endDate: project.endDate,
    });
    const risk = costRisk({ profit, percentComplete: progress.percent });

    // work.all alone must never surface a figure — quoted value, estimated
    // cost, every cost line, every milestone amount, and every invoice/
    // payment amount all require money.figures.
    const maskedCosts = project.costs.map((c) => ({ ...c, amount: canSeeFigures ? c.amount : null }));
    // monthlyCost is gated tighter than money.figures — setup.admin only,
    // same rule team.ts already applies. Allocation percentages themselves
    // stay visible; the salary they multiply against does not.
    const canSeeSalaries = hasPermission(req.user!, 'setup.admin');
    const maskedAllocations = project.allocations.map((a) => ({
      ...a,
      user: { ...a.user, monthlyCost: canSeeSalaries ? a.user.monthlyCost : undefined },
    }));
    const maskedMilestones = project.milestones.map((m) => ({
      ...m,
      amount: canSeeFigures ? m.amount : null,
      // The invoice riding on each milestone carries a figure too.
      invoices: m.invoices.map((inv) => ({ ...inv, amount: canSeeFigures ? inv.amount : null })),
    }));
    const maskedInvoices = project.invoices.map((inv) => ({
      ...inv,
      amount: canSeeFigures ? inv.amount : null,
      payments: inv.payments.map((p) => ({ ...p, amount: canSeeFigures ? p.amount : null })),
    }));

    res.json({
      success: true,
      project: {
        ...project,
        quotedValue: canSeeFigures ? project.quotedValue : null,
        // A Decimal column, which serialises as a string; the screen does
        // arithmetic on it, so it goes out as the number it is.
        gstPercent: project.gstPercent == null ? null : Number(project.gstPercent),
        actualCostTotal: canSeeFigures ? actualCostTotal : null,
        // Absent, not nulled, without money.figures — the same rule the asset
        // register follows. How far through the work is stays visible to
        // everybody: that is a fact about the job, not a figure.
        ...(canSeeFigures ? { profit, costRisk: risk } : {}),
        percentComplete: progress.percent,
        percentCompleteBasis: progress.basis,
        costs: maskedCosts,
        milestones: maskedMilestones,
        invoices: maskedInvoices,
        allocations: maskedAllocations,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── 3. Create Project with Milestones ────────────────────────────────────────

const milestoneInputSchema = z.object({
  label: z.string().min(1),
  percent: z.number().positive(),
  amount: z.number().positive(),
});

/*
 * There is no cost estimate on a project any more.
 *
 * It asked what the work would cost at the one moment nobody knows — before
 * any of it has been done — and then almost nothing read the answer. Cost risk
 * now judges against the QUOTE, which is a figure somebody actually agreed to
 * pay, and the rule for it was already written as the fallback for every
 * project that never had an estimate. The column is still on the table; it is
 * simply no longer collected, shown or read.
 */
const projectCreateSchema = z.object({
  companyId: z.string().min(1, 'Company is required'),
  name: z.string().min(1, 'Project name is required'),
  /**
   * Nought is allowed only for a sample — see `isSample`. Paid work with no
   * number on it is how a project ends up unbillable and nobody notices.
   */
  quotedValue: z.number().min(0, 'Quoted value cannot be negative').optional().default(0),
  /**
   * The GST rate charged on this. Kept BESIDE the value, never folded into it:
   * the value is revenue, and GST charged to a client is collected for the
   * government. Null is "not said", which is not the same as 0%.
   */
  gstPercent: z.number().min(0, 'GST cannot be negative').max(100, 'GST is a percentage — 100 at most').optional().nullable(),
  /** Work done to win somebody, with nothing to invoice at the end of it. */
  isSample: z.boolean().optional().default(false),
  /*
   * Required for paid work, optional for a sample — checked below rather than
   * here, because zod cannot see `isSample` from inside a field.
   *
   * A sample is often decided and started in the same breath ("send them
   * something"), and asking when it ends before anybody has begun it is the
   * kind of question that stops a thing being written down at all.
   */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  ownerId: z.string().optional(),
  priority: z.nativeEnum(Priority).optional(),
  description: z.string().optional().nullable(),
  milestones: z.array(milestoneInputSchema).optional(),
  /** Set when this project is being created from a won proposal (§11.1 step 11) — see below. */
  sourceProposalId: z.string().optional(),
});

projectsRouter.post('/', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = projectCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const { companyId, name, quotedValue, gstPercent, isSample, startDate, endDate, ownerId, priority, description, milestones, sourceProposalId } = parsed.data;

    /*
     * Nought is allowed on any project, not only a sample.
     *
     * This refused it, on the reasoning that paid work has a price. It does —
     * but "nought" and "not settled yet" are both real states for a piece of
     * one-off work, and refusing them only moved the problem: somebody types 1
     * to get past the form and the figure is then wrong rather than absent.
     *
     * What a sample still says, that a ₹0 project does not, is that nothing
     * will EVER be billed for it: no milestones, no proforma, no invoice, and
     * kept out of work-in-flight. A ₹0 project is ordinary work that happens
     * to be priced at nothing today.
     */
    // Paid work is scheduled; a sample is just started. Both dates fall back to
    // today for a sample, so the row still sits somewhere on a timeline.
    if (!isSample && (!startDate || !endDate)) {
      res.status(400).json({ success: false, error: 'A project needs a start date and an expected end.' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const start = startDate || today;
    const end = endDate || startDate || today;

    if (isSample && (milestones?.length || 0) > 0) {
      res.status(400).json({ success: false, error: 'Sample work is not billed, so it cannot carry billing milestones.' });
      return;
    }

    /*
     * The company has to have bought something first.
     *
     * The won-proposal check below lives inside `if (sourceProposalId)`, which
     * made every rule it enforces optional — leave the field out of the request
     * and a live project could be opened against a company nobody had sold
     * anything to. The gate belongs on the company, where it holds whatever
     * shape the request takes: a company becomes a CLIENT when a proposal is
     * won, so "not a prospect" is the same sentence as "somebody bought
     * something", and this read is also what confines `companyId` to the
     * caller's own organization.
     */
    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true, name: true, status: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }
    /*
     * A prospect may be given a sample, and nothing else.
     *
     * The guard is about selling: a company becomes a CLIENT because a
     * proposal was won, so live PAID work for somebody who has bought nothing
     * is the contradiction it exists to stop. A sample is not a sale — it is
     * the thing you make in order TO sell — so it does not contradict
     * anything, and refusing it was what made the money spent winning a client
     * invisible.
     *
     * The company stays a prospect either way. Nothing here promotes anybody.
     */
    if (company.status === CompanyStatus.PROSPECT && !isSample) {
      res.status(400).json({
        success: false,
        error: `${company.name} is still a prospect. Win a proposal for them first — that is what turns a prospect into a client. Sample work can be recorded for them now.`,
      });
      return;
    }

    // A proposal can seed at most one project, and only its own company's,
    // and only once it's actually won — otherwise sourceProposalId would let
    // a live/lost proposal masquerade as the reason a project exists.
    if (sourceProposalId) {
      const proposal = await prisma.proposal.findFirst({
        where: { id: sourceProposalId, organizationId: orgId, companyId, deletedAt: null },
      });
      if (!proposal) {
        res.status(404).json({ success: false, error: 'Source proposal not found for this company' });
        return;
      }
      if (proposal.outcome !== 'WON') {
        res.status(400).json({ success: false, error: 'Only a won proposal can seed a project' });
        return;
      }
      const already = await prisma.project.findFirst({ where: { sourceProposalId, organizationId: orgId, deletedAt: null } });
      if (already) {
        res.status(400).json({ success: false, error: `A project was already created from this proposal: ${already.name}` });
        return;
      }
    }

    // Nothing to split when there is nothing to split. Without this a sample —
    // or any project priced at nought — is born with three ₹0 milestones,
    // which reads as a billing plan and is not one.
    const defaultMilestones = isSample || !(quotedValue > 0) ? [] : milestones || [
      { label: 'Advance Payment', percent: 40, amount: quotedValue * 0.4 },
      { label: 'Phase 1 Sign-off', percent: 30, amount: quotedValue * 0.3 },
      { label: 'Final Delivery & Handover', percent: 30, amount: quotedValue * 0.3 },
    ];

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          organizationId: orgId,
          companyId,
          name: name.trim(),
          quotedValue,
          // A sample is not billed, so it carries no rate to bill at.
          gstPercent: isSample ? null : (gstPercent ?? null),
          isSample,
          startDate: new Date(start),
          endDate: new Date(end),
          ownerId: ownerId || req.user!.userId,
          status: ProjectStatus.LIVE,
          priority: priority ?? Priority.MEDIUM,
          description: description || null,
          sourceProposalId: sourceProposalId || null,
        },
      });

      for (let i = 0; i < defaultMilestones.length; i++) {
        const m = defaultMilestones[i];
        await tx.milestone.create({
          data: {
            projectId: created.id,
            label: m.label,
            percent: m.percent,
            amount: m.amount,
            order: i + 1,
            status: MilestoneStatus.PENDING,
          },
        });
      }

      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Project',
          entityId: created.id,
          actorId: req.user!.userId,
          verb: 'project_created',
          payload: { name: created.name, quotedValue },
        },
      });

      return created;
    });

    res.status(201).json({ success: true, project });
  } catch (error) {
    next(error);
  }
});

// ── 3b. Edit Project ─────────────────────────────────────────────────────────

const projectEditSchema = z.object({
  name: z.string().min(1).optional(),
  /*
   * Nought is allowed here, and whether it is VALID is decided below.
   *
   * This said `.positive()`, which meant every edit of a sample project was
   * refused with "Number must be greater than 0" — the form sends the value
   * back as it stands, and a sample's value is nought by definition. The
   * field could not see `isSample`, so the rule had to move to where it can.
   */
  quotedValue: z.number().min(0, 'Quoted value cannot be negative').optional(),
  /**
   * The GST rate charged on this. Kept BESIDE the value, never folded into it:
   * the value is revenue, and GST charged to a client is collected for the
   * government. Null is "not said", which is not the same as 0%.
   */
  gstPercent: z.number().min(0, 'GST cannot be negative').max(100, 'GST is a percentage — 100 at most').optional().nullable(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  description: z.string().optional().nullable(),
  /**
   * Turning paid work into a sample, or a sample into paid work.
   *
   * Both happen for real: a piece quoted and then given away to keep a client
   * sweet, and a sample the client liked enough to pay for. What must not
   * happen is either one landing on top of billing that already exists, which
   * is what the guards below are for.
   */
  isSample: z.boolean().optional(),
});

projectsRouter.patch('/:id', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = projectEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    // Not a deleted one: editing something that has been thrown away writes
    // changes nobody can see, and the restore route is how it comes back.
    const existing = await prisma.project.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const { name, quotedValue, gstPercent, startDate, endDate, ownerId, status, priority, description, isSample } = parsed.data;

    /*
     * ─── Switching between sample and paid ─────────────────────────────────
     *
     * → SAMPLE: refused once anything has been billed. A proforma or an
     *   invoice is a document that left the building; a project cannot
     *   retrospectively have been free. Milestones that are merely PENDING are
     *   another matter — nothing was raised against them — so they are removed
     *   with the change and the count is reported, rather than left behind as
     *   a billing plan on work that is not billed.
     *
     * → PAID: needs a price. Going from nothing to paid without one produces
     *   exactly the unbillable project this release is trying to stamp out, so
     *   the value has to arrive in the same request.
     */
    /*
     * No price floor on an edit either.
     *
     * The schema said `.positive()`, which refused every edit of a sample —
     * the form sends the value back as it stands and a sample's is nought — and
     * it also refused taking a price back off a project that turned out to be
     * free. Negative is still refused, in the schema, because that is the only
     * figure here that cannot mean anything.
     */
    let clearedMilestones = 0;
    if (isSample !== undefined && isSample !== existing.isSample) {
      if (isSample) {
        const billed = await prisma.milestone.count({
          where: {
            projectId: id,
            OR: [
              { status: { not: 'PENDING' } },
              { proformas: { some: { status: { not: 'CANCELLED' } } } },
              { invoices: { some: { status: { not: 'CANCELLED' } } } },
            ],
          },
        });
        const invoices = await prisma.invoice.count({
          where: { projectId: id, organizationId: orgId, status: { not: 'CANCELLED' } },
        });
        if (billed > 0 || invoices > 0) {
          res.status(400).json({
            success: false,
            error:
              'This project has already been billed, so it cannot become sample work. Cancel the proforma or invoice against it first.',
          });
          return;
        }
        clearedMilestones = (await prisma.milestone.deleteMany({ where: { projectId: id } })).count;
      }
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(quotedValue !== undefined ? { quotedValue } : {}),
        ...(startDate !== undefined ? { startDate: new Date(startDate) } : {}),
        ...(endDate !== undefined ? { endDate: new Date(endDate) } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(isSample !== undefined ? { isSample } : {}),
        // Turning something into a sample takes its rate with it — there is
        // nothing to charge GST on — and otherwise the rate is what was sent.
        ...(isSample === true
          ? { gstPercent: null }
          : gstPercent !== undefined
            ? { gstPercent: gstPercent ?? null }
            : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Project',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'project_edited',
        payload: {
          name: project.name,
          changed: changesBetween(existing, project, [
            'name',
            'quotedValue',
            'startDate',
            'endDate',
            'ownerId',
            'status',
            'priority',
            'description',
            'isSample',
            'gstPercent',
          ]),
          // Named, because a billing plan disappearing is exactly the kind of
          // thing somebody asks about later.
          ...(clearedMilestones > 0 ? { milestonesRemoved: clearedMilestones } : {}),
        },
      },
    });

    /*
     * Brief §11.3 step 6: "On delivery, the project closes with a final profit
     * figure that feeds the next quote for similar work."
     *
     * Stamped once, at the moment the status becomes DELIVERED, as its own
     * activity row. The living figure is computed on read like everything else
     * — but the CLOSING one has to be captured, because it is the only version
     * that stays true. Costs entered late against a finished job would keep
     * moving a number somebody has already quoted from, and a "final" figure
     * that changes six months later is not a record of anything.
     */
    const nowDelivered = status === 'DELIVERED' && existing.status !== 'DELIVERED';
    if (nowDelivered) {
      const closing = await prisma.project.findFirst({
        where: { id, organizationId: orgId },
        include: {
          costs: { where: { deletedAt: null }, select: { amount: true } },
          allocations: { include: { user: { select: { monthlyCost: true } } } },
        },
      });
      if (closing) {
        const finalProfit = jobProfit({
          quotedValue: Number(closing.quotedValue),
          directCost: closing.costs.reduce((acc, c) => acc + Number(c.amount), 0),
          peopleCost: allocationCost(closing.allocations),
        });
        await prisma.activity.create({
          data: {
            organizationId: orgId,
            entityType: 'Project',
            entityId: id,
            actorId: req.user!.userId,
            verb: 'project_delivered',
            payload: { ...finalProfit },
          },
        });
      }
    }

    res.json({ success: true, project, milestonesRemoved: clearedMilestones });
  } catch (error) {
    next(error);
  }
});

// ── 3c. Delete Project ──────────────────────────────────────────────────────
//
// A project entered by mistake should be removable outright; one that has
// real work or spend against it should not disappear — that history is what
// makes profit-per-job trustworthy. Cancel it instead (PATCH status=CANCELLED).
//
// Soft delete — §16: nothing is ever hard deleted by a user. The guard below
// also now blocks deleting a project with a milestone past PENDING — a
// proforma or invoice can exist against one with zero Cost rows recorded,
// since a proforma is about what the client owes, not what was spent.

projectsRouter.delete('/:id', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const project = await prisma.project.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        // Both filtered. `tasks` counted deleted rows while `costs` beside it
        // did not, so a task somebody had thrown away blocked the project for
        // good, with a message naming work that no longer exists.
        _count: {
          select: { tasks: { where: { deletedAt: null } }, costs: { where: { deletedAt: null } } },
        },
        milestones: { select: { status: true } },
        /*
         * The invoices raised straight against the project.
         *
         * A milestone-linked invoice already blocks this through the billing
         * check below — raising one moves its milestone past PENDING. But an
         * invoice can name a project and no milestone, which is how a job
         * billed in one go is recorded, and nothing looked for those. Two of
         * them exist in this database.
         *
         * So the project was deletable, and its invoice stayed on the client's
         * Money tab afterwards — money counted against work the record no
         * longer showed, with a link that opened a 404.
         */
        invoices: { where: { status: { not: 'CANCELLED' } }, select: { number: true } },
      },
    });
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    if (project.invoices.length > 0) {
      const [first] = project.invoices;
      res.status(400).json({
        success: false,
        error:
          project.invoices.length === 1
            ? `Invoice ${first.number} was raised against this project. Cancel it first — it is a document the client has.`
            : `${project.invoices.length} invoices were raised against this project. Cancel them first — they are documents the client has.`,
      });
      return;
    }

    const hasBillingHistory = project.milestones.some((m) => m.status !== 'PENDING');
    if (project._count.tasks > 0 || project._count.costs > 0 || hasBillingHistory) {
      res.status(400).json({
        success: false,
        error: 'This project has tasks, costs, or billing recorded against it. Set it to Cancelled instead of deleting it.',
      });
      return;
    }

    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        actorId: req.user!.userId,
        entityType: 'Project',
        entityId: id,
        verb: 'deleted',
        payload: { name: project.name },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

projectsRouter.post('/:id/restore', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.project.findFirst({ where: { id, organizationId: orgId, deletedAt: { not: null } } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Deleted project not found' });
      return;
    }

    await prisma.project.update({ where: { id }, data: { deletedAt: null } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        actorId: req.user!.userId,
        entityType: 'Project',
        entityId: id,
        verb: 'restored',
        payload: { name: existing.name },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── 4. Add a Milestone ───────────────────────────────────────────────────────
//
// Post-creation milestone editing didn't exist at all — the billing pattern
// picked at creation (Standard/Single/Custom) was permanent. Same shape as
// the creation-time milestoneInputSchema; no server-side "must sum to 100"
// check here either, matching creation's own field-level-only validation.

projectsRouter.post('/:id/milestones', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = milestoneInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const project = await prisma.project.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { milestones: { select: { order: true } } },
    });
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    // A billing plan on work that is not billed is a contradiction — and the
    // one that would quietly make a sample chargeable again.
    if (project.isSample) {
      res.status(400).json({
        success: false,
        error: 'Sample work is not billed, so it cannot carry billing milestones. Move it off sample work first.',
      });
      return;
    }

    const nextOrder = project.milestones.reduce((max, m) => Math.max(max, m.order), -1) + 1;
    const milestone = await prisma.milestone.create({
      data: { projectId: id, label: parsed.data.label, percent: parsed.data.percent, amount: parsed.data.amount, order: nextOrder },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Project',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'milestone_added',
        payload: { milestoneId: milestone.id, label: milestone.label, percent: milestone.percent, amount: Number(milestone.amount) },
      },
    });

    res.json({ success: true, milestone });
  } catch (error) {
    next(error);
  }
});

// ── 5. Update Milestone (status, or label/percent/amount while still Pending) ──

const milestoneEditSchema = z.object({
  status: z.nativeEnum(MilestoneStatus).optional(),
  label: z.string().min(1).optional(),
  percent: z.number().positive().optional(),
  amount: z.number().positive().optional(),
});

projectsRouter.patch('/:id/milestones/:milestoneId', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = milestoneEditSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ success: false, error: parsed.success ? 'Nothing to update' : parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const milestoneId = String(req.params.milestoneId);
    const { status, label, percent, amount } = parsed.data;

    // Scoped through the project, not by bare milestone id — otherwise a
    // milestone id from another organisation would update just as happily.
    const existing = await prisma.milestone.findFirst({
      where: { id: milestoneId, projectId: id, project: { organizationId: orgId } },
      // Cancelled ones do not count: a cancelled proforma is a document that was
      // withdrawn, and holding the milestone down for it would mean a mistake
      // can never be undone.
      include: { _count: { select: { proformas: { where: { status: { not: 'CANCELLED' } } } } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Milestone not found' });
      return;
    }

    /*
     * Back down the ladder, once, for a mis-click.
     *
     * The status only ever went forward on screen — Pending, Proforma raised,
     * Invoiced, Paid, and no button at the end — so "Mark paid" pressed on the
     * wrong row was a one-way door: the milestone counted as collected, the
     * progress bar moved, and the only way back was the database.
     *
     * It can go back now, with one thing held: not below Proforma raised while
     * a proforma exists against it. That document went to the client with a
     * number on it, and a milestone claiming nothing has been raised while one
     * has is the disagreement this rule exists to prevent.
     */
    const LADDER = [
      MilestoneStatus.PENDING,
      MilestoneStatus.PROFORMA_RAISED,
      MilestoneStatus.INVOICED,
      MilestoneStatus.PAID,
    ];
    if (status !== undefined && LADDER.indexOf(status) < LADDER.indexOf(existing.status)) {
      if (status === MilestoneStatus.PENDING && existing._count.proformas > 0) {
        res.status(400).json({
          success: false,
          error:
            'A proforma has been raised against this milestone, so it cannot go back to Pending. ' +
            'Cancel the proforma first — on the client, under Invoices & Proformas — and this returns to Pending by itself.',
        });
        return;
      }
    }

    /*
     * ─── Forward is earned, not claimed ────────────────────────────────────
     *
     * This guarded backward moves only, so a milestone could be walked up to
     * Invoiced and then Paid with one click each and nothing behind either —
     * no document, no number, no money. Eleven of them in this database sit
     * past Pending with no proforma at all, which is how "collected" became a
     * figure nobody could reconcile against Tally.
     *
     * §3 says status is derived. It already was for the first rung: raising a
     * proforma moves a milestone to Proforma raised, cancelling one gives it
     * back. The other two rungs now work the same way — recording the invoice
     * moves it to Invoiced, and the payment that settles that invoice moves it
     * to Paid. Both happen by themselves, which is why this refuses rather
     * than asks.
     *
     * The refusal names the thing to do instead, because "not allowed" without
     * a next step is how people end up typing it in somewhere else.
     */
    const DERIVED_FORWARD: Partial<Record<MilestoneStatus, string>> = {
      [MilestoneStatus.PROFORMA_RAISED]:
        'Raise the proforma — on the client, under Invoices & Proformas — and this moves to Proforma raised by itself.',
      [MilestoneStatus.INVOICED]:
        'Enter the invoice against this milestone — its Tally number, amount and date — and this moves to Invoiced by itself.',
      [MilestoneStatus.PAID]:
        'Record the payment against that invoice and this moves to Paid by itself, once the invoice is fully settled.',
    };
    if (status !== undefined && LADDER.indexOf(status) > LADDER.indexOf(existing.status)) {
      res.status(400).json({
        success: false,
        error: `A milestone's status follows its documents rather than being set. ${DERIVED_FORWARD[status]}`,
      });
      return;
    }

    // The billing structure (label/percent/amount) is locked the moment a
    // proforma has been raised against it — same "immutable once it enters
    // the real billing flow" rule ProposalVersion follows once sent.
    if ((label !== undefined || percent !== undefined || amount !== undefined) && existing.status !== MilestoneStatus.PENDING) {
      res.status(400).json({ success: false, error: 'This milestone already has billing against it — only Pending milestones can be edited.' });
      return;
    }

    const milestone = await prisma.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(percent !== undefined ? { percent } : {}),
        ...(amount !== undefined ? { amount } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Project',
        entityId: id,
        actorId: req.user!.userId,
        verb: status !== undefined ? 'milestone_status_changed' : 'milestone_edited',
        payload: { milestoneId, label: existing.label, from: existing.status, to: status ?? existing.status },
      },
    });

    res.json({ success: true, milestone });
  } catch (error) {
    next(error);
  }
});

// ── 6. Delete a Milestone ────────────────────────────────────────────────────

projectsRouter.delete('/:id/milestones/:milestoneId', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const milestoneId = String(req.params.milestoneId);

    const existing = await prisma.milestone.findFirst({
      where: { id: milestoneId, projectId: id, project: { organizationId: orgId } },
      // Cancelled ones do not count: a cancelled proforma is a document that was
      // withdrawn, and holding the milestone down for it would mean a mistake
      // can never be undone.
      include: { _count: { select: { proformas: { where: { status: { not: 'CANCELLED' } } } } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Milestone not found' });
      return;
    }
    if (existing.status !== MilestoneStatus.PENDING || existing._count.proformas > 0) {
      res.status(400).json({ success: false, error: 'This milestone has a live proforma against it. Cancel the proforma first — on the client, under Invoices & Proformas — and this can be removed.' });
      return;
    }

    await prisma.milestone.delete({ where: { id: milestoneId } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Project',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'milestone_deleted',
        payload: { milestoneId, label: existing.label },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
