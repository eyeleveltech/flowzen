import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, requirePermission } from '../middleware/auth.js';

export const briefRouter = Router();

briefRouter.use(authenticate);

/**
 * The brief's own compute, factored out of the route so the Monday-morning
 * mail job (workers/brief.cron.ts) composes the exact same numbers a person
 * would see opening the screen themselves — never a second, drifting copy.
 */
export async function composeMondayBrief(orgId: string) {
  const now = new Date();
  const in45Days = new Date(now.getTime() + 45 * 24 * 3600 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 3600 * 1000);

  // ── Quadrant 1: Contract Risks ──────────────────────────────────────────
  const activeRetainers = await prisma.retainer.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    include: {
      company: { select: { id: true, name: true, website: true } },
      monthCards: { orderBy: { month: 'desc' }, take: 1 },
    },
  });

  const expiringRetainers = activeRetainers
    .filter((r) => r.renewalDate && r.renewalDate <= in45Days)
    .map((r) => {
      const daysLeft = Math.ceil((r.renewalDate!.getTime() - now.getTime()) / (1000 * 3600 * 24));
      return {
        id: r.id,
        companyName: r.company.name,
        monthlyValue: Number(r.monthlyValue),
        renewalDate: r.renewalDate,
        daysLeft,
        severity: daysLeft <= 15 ? 'HIGH' : 'MED',
        message: `Retainer renewal due in ${daysLeft} days (₹${Number(r.monthlyValue).toLocaleString('en-IN')}/mo)`,
      };
    });

  // ── Quadrant 2: Pipeline Momentum ───────────────────────────────────────
  const activeProposals = await prisma.proposal.findMany({
    where: { organizationId: orgId, outcome: null },
    include: {
      company: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      versions: { orderBy: { n: 'desc' }, take: 1 },
    },
  });

  const verbalYesPending = activeProposals
    .filter((p) => p.stage === 'VERBAL_YES' || p.stage === 'PROFORMA_ISSUED')
    .map((p) => ({
      id: p.id,
      companyName: p.company.name,
      stage: p.stage,
      ownerName: p.owner.name,
      value: p.versions[0]?.value ? Number(p.versions[0].value) : 0,
      message: `Verbal agreement awaiting advance invoice / payment (₹${Number(p.versions[0]?.value || 0).toLocaleString('en-IN')})`,
    }));

  const stalledProposals = activeProposals
    .filter((p) => p.updatedAt < sevenDaysAgo && p.stage !== 'VERBAL_YES')
    .map((p) => ({
      id: p.id,
      companyName: p.company.name,
      stage: p.stage,
      ownerName: p.owner.name,
      daysInactive: Math.floor((now.getTime() - p.updatedAt.getTime()) / (1000 * 3600 * 24)),
      message: `No activity in ${Math.floor((now.getTime() - p.updatedAt.getTime()) / (1000 * 3600 * 24))} days`,
    }));

  // ── Quadrant 3: Accounts Receivable Aging ───────────────────────────────
  const unpaidInvoices = await prisma.invoice.findMany({
    where: {
      organizationId: orgId,
      status: { in: ['RAISED', 'OVERDUE'] },
    },
    include: {
      company: { select: { id: true, name: true } },
      payments: true,
    },
  });

  const overdue30 = [];
  const overdue60 = [];
  let totalOverdueAmount = 0;

  for (const inv of unpaidInvoices) {
    const totalPaid = inv.payments.reduce((acc, p) => acc + Number(p.amount), 0);
    const balance = Number(inv.amount) - totalPaid;
    if (balance <= 0) continue;

    const dueTime = new Date(inv.dueAt).getTime();
    if (dueTime < sixtyDaysAgo.getTime()) {
      overdue60.push({
        id: inv.id,
        number: inv.number,
        companyName: inv.company.name,
        dueAt: inv.dueAt,
        balance,
        daysOverdue: Math.floor((now.getTime() - dueTime) / (1000 * 3600 * 24)),
      });
      totalOverdueAmount += balance;
    } else if (dueTime < thirtyDaysAgo.getTime()) {
      overdue30.push({
        id: inv.id,
        number: inv.number,
        companyName: inv.company.name,
        dueAt: inv.dueAt,
        balance,
        daysOverdue: Math.floor((now.getTime() - dueTime) / (1000 * 3600 * 24)),
      });
      totalOverdueAmount += balance;
    }
  }

  // ── Quadrant 4: Team Capacity & Task Hotspots ───────────────────────────
  const team = await prisma.user.findMany({
    where: { organizationId: orgId, active: true },
    include: {
      assignedTasks: {
        where: { status: { notIn: ['DONE', 'CANCELLED'] } },
        select: { id: true, dueDate: true },
      },
      allocations: { select: { percent: true, month: true } },
    },
  });

  const memberBottlenecks = [];
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const member of team) {
    const overdueTasksCount = member.assignedTasks.filter(
      (t) => t.dueDate && t.dueDate.toISOString().slice(0, 10) < now.toISOString().slice(0, 10),
    ).length;

    const currentMonthAlloc = member.allocations
      .filter((a) => a.month === currentMonthKey)
      .reduce((acc, a) => acc + a.percent, 0);

    if (overdueTasksCount >= 2 || currentMonthAlloc > 100) {
      memberBottlenecks.push({
        id: member.id,
        name: member.name,
        dept: member.dept,
        overdueTasksCount,
        totalOpenTasks: member.assignedTasks.length,
        allocationPercent: currentMonthAlloc,
        severity: overdueTasksCount >= 4 || currentMonthAlloc > 120 ? 'HIGH' : 'MED',
        message: `${member.name} (${member.dept}): ${overdueTasksCount} overdue tasks, ${currentMonthAlloc}% allocation`,
      });
    }
  }

  return {
    generatedAt: now.toISOString(),
    quadrants: {
      contractRisks: {
        title: 'At-Risk Contracts & Expiring Retainers',
        count: expiringRetainers.length,
        items: expiringRetainers,
      },
      pipelineMomentum: {
        title: 'Pipeline Velocity & Follow-ups',
        verbalYesCount: verbalYesPending.length,
        stalledCount: stalledProposals.length,
        verbalYesPending,
        stalledProposals,
      },
      accountsReceivable: {
        title: 'Uncollected Revenue & AR Aging',
        totalOverdueAmount,
        overdue30Count: overdue30.length,
        overdue60Count: overdue60.length,
        overdue30,
        overdue60,
      },
      teamCapacity: {
        title: 'Team Capacity & Bottleneck Hotspots',
        hotspotCount: memberBottlenecks.length,
        bottlenecks: memberBottlenecks,
      },
    },
  };
}

/**
 * GET /api/brief/monday — Monday Morning Executive Intelligence Briefing
 */
briefRouter.get(
  '/monday',
  // `reports.read` — the switch whose own label reads "Reports and brief" — was
  // granted to Management and then enforced on nothing, while this route asked
  // for `money.figures` instead. That let Accounts, who legitimately needs
  // figures, into the management reports as well. The narrower switch is the
  // one that was meant to guard this.
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const brief = await composeMondayBrief(req.user!.organizationId);
      res.json({ success: true, ...brief });
    } catch (e) {
      next(e);
    }
  },
);
