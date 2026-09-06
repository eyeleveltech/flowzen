import { prisma } from '../lib/prisma.js';
import { AlertSeverity, TaskWorkType, TaskStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { jobProfit, percentComplete, costRisk } from '../utils/jobProfit.js';
import { calculateWorkingMinutes } from '../utils/workingHours.js';
import { loadPercentage } from '../utils/workload.js';
import { computeTaskTypeMedians, taskTypeGroupKey } from '../utils/taskTypeMedian.js';
import { rupees } from '../utils/money.js';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface EvaluatedRuleAlert {
  rule: string;
  severity: AlertSeverity;
  entityType: string;
  entityId: string;
  message: string;
}

/**
 * Pure evaluation function running the agency's health rules for an organization.
 * Covers all 12 rules named in the design spec, several split into a HIGH/MED pair
 * the way INVOICE_OVERDUE already was — 18 distinct alert keys in total.
 */
export async function evaluateAgencyHealthRules(organizationId: string): Promise<EvaluatedRuleAlert[]> {
  const alerts: EvaluatedRuleAlert[] = [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
  const in45Days = new Date(now.getTime() + 45 * 24 * 3600 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 1. RULE: PROPOSAL_STALLED — brief §12: "stage in (Proposal sent, In
  // negotiation) and days since LAST VERSION > 5, outcome null → task to
  // owner, then management at 10 days." Both stages, the 5-day threshold,
  // and the actual follow-up task were all missing before; only a flat
  // 7-day/PROPOSAL_SENT-only/no-task alert existed.
  const activeProposals = await prisma.proposal.findMany({
    where: { organizationId, stage: { in: ['PROPOSAL_SENT', 'IN_NEGOTIATION'] }, outcome: null },
    include: { company: true, versions: { orderBy: { sentAt: 'desc' }, take: 1 } },
  });
  for (const p of activeProposals) {
    const lastVersion = p.versions[0];
    if (!lastVersion) continue;
    const daysSince = Math.floor((now.getTime() - lastVersion.sentAt.getTime()) / (1000 * 3600 * 24));
    if (daysSince <= 5) continue;
    const escalated = daysSince > 10;
    alerts.push({
      rule: 'PROPOSAL_STALLED',
      severity: escalated ? AlertSeverity.HIGH : AlertSeverity.MED,
      entityType: 'Proposal',
      entityId: p.id,
      message: `Proposal for ${p.company.name} has had no new version for ${daysSince} days${escalated ? ' — escalated to management' : ''}.`,
    });

    // One follow-up task per stall, not one every hourly tick.
    const marker = `proposal_followup:${p.id}`;
    const existingFollowUp = await prisma.task.findFirst({
      where: { organizationId, deletedAt: null, notes: marker, status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] } },
    });
    if (!existingFollowUp) {
      await prisma.task.create({
        data: {
          organizationId,
          title: `Follow up — ${p.company.name} proposal`,
          workType: TaskWorkType.INTERNAL,
          assigneeId: p.ownerId,
          createdById: p.ownerId,
          assignees: { create: { userId: p.ownerId } },
          dueDate: now,
          assignedAt: now,
          status: TaskStatus.TODO,
          notes: marker,
        },
      });
    }
  }

  // 2. RULE: VERBAL_NO_ADVANCE
  const verbalPending = await prisma.proposal.findMany({
    where: {
      organizationId,
      stage: 'VERBAL_YES',
      outcome: null,
      verbalYesAt: { lt: threeDaysAgo },
    },
    include: { company: true },
  });
  if (verbalPending.length > 0) {
    // sourceId is a polymorphic pointer (§7), not a schema relation, so a
    // proposal's proformas are looked up directly rather than `include`d.
    const proformaCounts = await prisma.proforma.groupBy({
      by: ['sourceId'],
      where: { sourceType: 'PROPOSAL', sourceId: { in: verbalPending.map((p) => p.id) } },
      _count: true,
    });
    const hasProforma = new Set(proformaCounts.map((c) => c.sourceId));
    for (const p of verbalPending) {
      if (!hasProforma.has(p.id)) {
        alerts.push({
          rule: 'VERBAL_NO_ADVANCE',
          severity: AlertSeverity.HIGH,
          entityType: 'Proposal',
          entityId: p.id,
          message: `Verbal agreement with ${p.company.name} waiting over 3 days for advance proforma issuance.`,
        });
      }
    }
  }

  // 3. RULE: PROFORMA_EXPIRED
  const expiredProformas = await prisma.proforma.findMany({
    where: {
      organizationId,
      status: 'UNPAID',
      validTill: { lt: now },
    },
    include: { company: true },
  });
  for (const pf of expiredProformas) {
    alerts.push({
      rule: 'PROFORMA_EXPIRED',
      severity: AlertSeverity.MED,
      entityType: 'Proforma',
      entityId: pf.id,
      message: `Proforma ${pf.number} for ${pf.company.name} expired on ${pf.validTill.toISOString().slice(0, 10)}.`,
    });
  }

  // 4. RULE: RETAINER_EXPIRING
  const expiringRetainers = await prisma.retainer.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      renewalDate: { lte: in45Days },
    },
    include: { company: true },
  });
  for (const r of expiringRetainers) {
    if (r.renewalDate) {
      const days = Math.ceil((r.renewalDate.getTime() - now.getTime()) / (1000 * 3600 * 24));
      alerts.push({
        rule: 'RETAINER_EXPIRING',
        severity: days <= 15 ? AlertSeverity.HIGH : AlertSeverity.MED,
        entityType: 'Retainer',
        entityId: r.id,
        message: `Retainer for ${r.company.name} renewing in ${days} days.`,
      });
    }
  }

  // 5. RULE: TASK_OVERDUE
  const overdueTasks = await prisma.task.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { notIn: ['DONE', 'CANCELLED'] },
      dueDate: { lt: now },
    },
    include: { assignee: true },
    take: 30,
  });
  for (const t of overdueTasks) {
    alerts.push({
      rule: 'TASK_OVERDUE',
      severity: AlertSeverity.MED,
      entityType: 'Task',
      entityId: t.id,
      message: `Task "${t.title}" assigned to ${t.assignee.name} is overdue.`,
    });
  }

  // 6. RULE: TASK_WAITING_HOLD
  const holdTasks = await prisma.task.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: 'ON_HOLD',
      waitingOn: 'CLIENT',
      waitingSince: { lt: fiveDaysAgo },
    },
    take: 20,
  });
  for (const t of holdTasks) {
    alerts.push({
      rule: 'TASK_WAITING_HOLD',
      severity: AlertSeverity.MED,
      entityType: 'Task',
      entityId: t.id,
      message: `Task "${t.title}" has been waiting on client feedback for over 5 days.`,
    });
  }

  // 7. RULE: INVOICE_OVERDUE & INVOICE_AGING_60 — brief §12: "weighted by
  // that client's median days to pay." A client whose invoices normally
  // take 45 days is not yet a surprise at day 35 past due; a client who
  // always pays on time being overdue at all is the more unusual signal.
  // Severity below reflects deviation from THIS client's own history, not
  // a flat threshold — clients with no paid-invoice history yet keep the
  // conservative flat HIGH, since there's nothing to weight against.
  const paidInvoices = await prisma.invoice.findMany({
    where: { organizationId, status: 'PAID', paidAt: { not: null } },
    select: { companyId: true, raisedAt: true, paidAt: true },
  });
  const daysToPayByCompany = new Map<string, number[]>();
  for (const inv of paidInvoices) {
    const days = Math.round((inv.paidAt!.getTime() - inv.raisedAt.getTime()) / (1000 * 3600 * 24));
    const arr = daysToPayByCompany.get(inv.companyId) ?? [];
    arr.push(days);
    daysToPayByCompany.set(inv.companyId, arr);
  }

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      status: { in: ['RAISED', 'OVERDUE'] },
      dueAt: { lt: now },
    },
    include: { company: true },
  });
  for (const inv of overdueInvoices) {
    const is60Days = inv.dueAt.getTime() < sixtyDaysAgo.getTime();
    const daysOverdue = Math.floor((now.getTime() - inv.dueAt.getTime()) / (1000 * 3600 * 24));
    const history = daysToPayByCompany.get(inv.companyId);
    const medianDaysToPay = history ? median(history) : null;
    const severity =
      medianDaysToPay === null
        ? AlertSeverity.HIGH
        : daysOverdue > medianDaysToPay
        ? AlertSeverity.HIGH
        : AlertSeverity.MED;
    alerts.push({
      rule: is60Days ? 'INVOICE_AGING_60' : 'INVOICE_OVERDUE',
      severity,
      entityType: 'Invoice',
      entityId: inv.id,
      message: `Invoice ${inv.number} for ${inv.company.name} is overdue (${is60Days ? '>60 days' : 'due date passed'})${
        medianDaysToPay !== null ? `, ${daysOverdue}d past due against their usual ${Math.round(medianDaysToPay)}d` : ''
      }.`,
    });
  }

  // 8. RULE: MEMBER_OVERALLOCATED
  const teamAllocations = await prisma.peopleAllocation.groupBy({
    by: ['userId'],
    where: { month: currentMonthKey, user: { organizationId } },
    _sum: { percent: true },
    having: { percent: { _sum: { gt: 100 } } },
  });
  for (const alloc of teamAllocations) {
    const user = await prisma.user.findUnique({ where: { id: alloc.userId } });
    if (user) {
      alerts.push({
        rule: 'MEMBER_OVERALLOCATED',
        severity: AlertSeverity.HIGH,
        entityType: 'User',
        entityId: user.id,
        message: `${user.name} is overallocated at ${alloc._sum.percent}% capacity for ${currentMonthKey}.`,
      });
    }
  }

  // 9. RULE: ALLOCATIONS_UNCONFIRMED (past the 25th of month)
  if (now.getDate() >= 25) {
    const unconfirmedCount = await prisma.peopleAllocation.count({
      where: {
        month: currentMonthKey,
        confirmedAt: null,
        user: { organizationId },
      },
    });
    if (unconfirmedCount > 0) {
      alerts.push({
        rule: 'ALLOCATIONS_UNCONFIRMED',
        severity: AlertSeverity.MED,
        entityType: 'Organization',
        entityId: organizationId,
        message: `${unconfirmedCount} team allocations pending department confirmation for ${currentMonthKey}.`,
      });
    }
  }

  // 10. RULE: PROFORMA_UNPAID — unpaid a week or more, independent of validity.
  // Distinct from PROFORMA_EXPIRED above: a proforma can sit unpaid well inside
  // a long validity window, which EXPIRED alone would never catch.
  const staleProformas = await prisma.proforma.findMany({
    where: {
      organizationId,
      status: 'UNPAID',
      raisedAt: { lt: sevenDaysAgo },
    },
    include: { company: true },
  });
  for (const pf of staleProformas) {
    const days = Math.floor((now.getTime() - pf.raisedAt.getTime()) / (1000 * 3600 * 24));
    alerts.push({
      rule: 'PROFORMA_UNPAID',
      severity: AlertSeverity.MED,
      entityType: 'Proforma',
      entityId: pf.id,
      message: `Proforma ${pf.number} for ${pf.company.name} has sat unpaid for ${days} days.`,
    });
  }

  // 11 & 12. RULE: PROJECT_OVER_ESTIMATE / PROJECT_BEHIND_SCHEDULE
  //
  // ─── What the cost rule used to be ──────────────────────────────────────
  //
  // `actualCost > estimatedCost`, where actualCost was Cost rows ONLY. Two
  // things wrong with that, and the brief names both:
  //
  //   1. It left out the people. §8 defines a project's actual cost as
  //      Cost rows PLUS allocated salary, and on most jobs here the salary is
  //      the larger half. A project overrunning because three designers are on
  //      it never tripped this rule at all.
  //
  //   2. It only fired once the estimate was already gone. §11.3 step 4 asks
  //      for an alert "while there is still time to act", and by the time
  //      spend has passed the estimate at 40% complete, the money is spent.
  //
  // It now PROJECTS: spend so far, divided by how far through the work is,
  // says where the cost lands at this rate. A job 25% done having spent 60% of
  // its estimate is heading for 240% of it, and that is worth knowing in week
  // two rather than at handover. The arithmetic is `utils/jobProfit.ts` — the
  // same functions the project screen and the profit table use, so an alert
  // and the page it links to can never disagree about the number.
  const liveProjects = await prisma.project.findMany({
    where: { organizationId, status: 'LIVE', deletedAt: null },
    include: {
      company: true,
      costs: { where: { deletedAt: null } },
      tasks: { where: { deletedAt: null }, select: { status: true } },
      milestones: { select: { status: true } },
      allocations: { include: { user: { select: { monthlyCost: true } } } },
    },
  });
  for (const p of liveProjects) {
    const profit = jobProfit({
      quotedValue: Number(p.quotedValue),
      estimatedCost: p.estimatedCost === null ? null : Number(p.estimatedCost),
      directCost: p.costs.reduce((sum, c) => sum + Number(c.amount), 0),
      peopleCost: p.allocations.reduce(
        (sum, a) => sum + (a.percent / 100) * Number(a.user.monthlyCost),
        0,
      ),
    });
    const progress = percentComplete({
      milestones: p.milestones,
      startDate: p.startDate,
      endDate: p.endDate,
      now,
    });
    const risk = costRisk({ profit, percentComplete: progress.percent });

    // WATCH is for the screen, not for an alert. Something that turns into a
    // notification has to be worth interrupting somebody for, and "tracking
    // 12% above estimate" is not.
    if (risk.level === 'OVER' || risk.level === 'LOSS') {
      alerts.push({
        rule: 'PROJECT_OVER_ESTIMATE',
        severity: risk.level === 'LOSS' ? AlertSeverity.HIGH : AlertSeverity.MED,
        entityType: 'Project',
        entityId: p.id,
        // The alert carries the projection too — a notification that only says
        // "38% of the quote spent" makes somebody open the page to find the
        // number that decides whether to act.
        message:
          `${p.name} for ${p.company.name}: ${risk.reason}` +
          (risk.projectedCost != null
            ? ` At this rate it finishes at ${rupees(risk.projectedCost)}.`
            : ''),
      });
    }

    // Delivery pace is a different question from money, and it keeps its own
    // signal — TASKS, not milestones. A milestone moves when a client accepts
    // something, which can lag the work by weeks; task completion is what says
    // whether the team is keeping up.
    if (p.tasks.length > 0) {
      const trackedTasks = p.tasks.filter((t) => t.status !== 'CANCELLED');
      const taskPercent =
        trackedTasks.length > 0
          ? (trackedTasks.filter((t) => t.status === 'DONE').length / trackedTasks.length) * 100
          : 0;
      const totalMs = p.endDate.getTime() - p.startDate.getTime();
      const percentTimeElapsed =
        totalMs > 0 ? Math.min(100, Math.max(0, ((now.getTime() - p.startDate.getTime()) / totalMs) * 100)) : 0;
      if (percentTimeElapsed - taskPercent > 15) {
        alerts.push({
          rule: 'PROJECT_BEHIND_SCHEDULE',
          severity: AlertSeverity.MED,
          entityType: 'Project',
          entityId: p.id,
          message: `${p.name} for ${p.company.name} is ${Math.round(percentTimeElapsed)}% through its timeline but only ${Math.round(taskPercent)}% of tasks are done.`,
        });
      }
    }
  }

  // 13 & 14. RULE: PERSON_OVERLOADED / PERSON_UNDERLOADED — same trailing
  // 8 week median the Team screen already shows (team.ts's loadPercentage),
  // not a separate metric, so this never disagrees with what a head is
  // looking at. Distinct from MEMBER_OVERALLOCATED above, which reads
  // confirmed PeopleAllocation percentages rather than raw task counts.
  const activeUsers = await prisma.user.findMany({
    where: { organizationId, active: true },
    include: {
      // Through the join, so this and the Team screen cannot disagree about
      // who is carrying what — a task shared by three people is on all three
      // desks in both places or in neither.
      taskAssignments: {
        where: { task: { deletedAt: null } },
        select: { task: { select: { status: true, assignedAt: true, completedAt: true } } },
      },
    },
  });
  for (const u of activeUsers) {
    const mine = u.taskAssignments.map((a) => a.task);
    if (mine.length === 0) continue; // nobody ever assigned — nothing to compare against
    const openCount = mine.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length;
    const loadPercent = loadPercentage(mine, openCount);
    if (loadPercent > 130) {
      alerts.push({
        rule: 'PERSON_OVERLOADED',
        severity: AlertSeverity.HIGH,
        entityType: 'User',
        entityId: u.id,
        message: `${u.name} is carrying ${openCount} open tasks, ${Math.round(loadPercent)}% of a normal load.`,
      });
    } else if (loadPercent < 60) {
      alerts.push({
        rule: 'PERSON_UNDERLOADED',
        severity: AlertSeverity.LOW,
        entityType: 'User',
        entityId: u.id,
        message: `${u.name} is at ${Math.round(loadPercent)}% of a normal load.`,
      });
    }
  }

  // 15. RULE: TASK_AGING — brief §8: "median elapsed for tasks sharing the
  // same templateItemId, or the same title pattern when ad hoc." Retainer
  // template tasks carry a real templateItemId now (monthCard.cron.ts sets
  // it on every spawned task); anything else groups by a normalized title,
  // the brief's own stated fallback — not a per-assignee average, which
  // was standing in for a taxonomy that didn't exist yet. Shared with
  // tasks.ts's elapsed-vs-median figure so both mean the same "median".
  const medianByGroup = await computeTaskTypeMedians(organizationId);
  if (medianByGroup.size > 0) {
    const openTasks = await prisma.task.findMany({
      where: { organizationId, deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS', 'ON_HOLD'] } },
      take: 200,
    });
    for (const t of openTasks) {
      const taskTypeMedian = medianByGroup.get(taskTypeGroupKey(t));
      if (!taskTypeMedian) continue;
      const elapsed = calculateWorkingMinutes(t.assignedAt, now, t.waitingTotalMinutes).totalMinutes;
      if (elapsed > taskTypeMedian * 2) {
        alerts.push({
          rule: 'TASK_AGING',
          severity: AlertSeverity.LOW,
          entityType: 'Task',
          entityId: t.id,
          message: `"${t.title}" has been open more than twice as long as similar tasks usually take.`,
        });
      }
    }
  }

  // 16. RULE: RETAINER_NO_CONTRACT — running with no term at all, distinct
  // from RETAINER_EXPIRING which only fires once a renewal date is close.
  // A month-to-month retainer has no renewalDate, so it never trips that one.
  const noContractRetainers = await prisma.retainer.findMany({
    where: { organizationId, status: 'ACTIVE', termMonths: null },
    include: { company: true },
  });
  for (const r of noContractRetainers) {
    alerts.push({
      rule: 'RETAINER_NO_CONTRACT',
      severity: AlertSeverity.MED,
      entityType: 'Retainer',
      entityId: r.id,
      message: `${r.company.name}'s retainer is running month to month with no signed term.`,
    });
  }

  // 17. RULE: CLIENT_QUIET — no task, meeting or invoice for 21 days. There
  // is still no dedicated Meeting entity, but a logged meeting/call/email/
  // WhatsApp now writes a real Activity row against the Company (see
  // activities.ts's `${type}_logged` verbs), so that's checked here too.
  const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 3600 * 1000);
  const clients = await prisma.company.findMany({
    where: { organizationId, status: 'CLIENT' },
    include: {
      retainers: { select: { id: true, monthCards: { select: { id: true } } } },
      projects: { select: { id: true } },
      invoices: { select: { raisedAt: true }, orderBy: { raisedAt: 'desc' }, take: 1 },
    },
  });
  for (const c of clients) {
    const monthCardIds = c.retainers.flatMap((r) => r.monthCards.map((m) => m.id));
    const projectIds = c.projects.map((p) => p.id);
    if (monthCardIds.length === 0 && projectIds.length === 0) continue; // nothing running yet to go quiet on
    const recentTask = await prisma.task.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          ...(monthCardIds.length > 0 ? [{ monthCardId: { in: monthCardIds } }] : []),
          ...(projectIds.length > 0 ? [{ projectId: { in: projectIds } }] : []),
        ],
        updatedAt: { gte: twentyOneDaysAgo },
      },
      select: { id: true },
    });
    if (recentTask) continue;
    const recentInvoice = c.invoices[0];
    if (recentInvoice && recentInvoice.raisedAt >= twentyOneDaysAgo) continue;
    const recentContact = await prisma.activity.findFirst({
      where: {
        organizationId,
        entityType: 'Company',
        entityId: c.id,
        verb: { in: ['meeting_logged', 'call_logged', 'email_logged', 'whatsapp_logged'] },
        at: { gte: twentyOneDaysAgo },
      },
      select: { id: true },
    });
    if (recentContact) continue;
    alerts.push({
      rule: 'CLIENT_QUIET',
      severity: AlertSeverity.MED,
      entityType: 'Company',
      entityId: c.id,
      message: `${c.name} has had no task activity, contact logged, or invoice in 21 days.`,
    });
  }

  // 18. RULE: MONTH_CARD_NOT_INVOICED — closed 5+ days ago, still no invoice.
  const fiveDaysAgoForCards = fiveDaysAgo;
  const uninvoicedCards = await prisma.monthCard.findMany({
    where: {
      retainer: { organizationId },
      status: 'CLOSED',
      invoiceId: null,
      closedAt: { lt: fiveDaysAgoForCards },
    },
    include: { retainer: { include: { company: true } } },
  });
  for (const mc of uninvoicedCards) {
    alerts.push({
      rule: 'MONTH_CARD_NOT_INVOICED',
      severity: AlertSeverity.MED,
      entityType: 'MonthCard',
      entityId: mc.id,
      message: `${mc.retainer.company.name}'s ${mc.month} month card closed over 5 days ago with no invoice linked.`,
    });
  }

  // ── 19-22. The asset rules ────────────────────────────────────────────────
  //
  // These ride the scanner that already runs; no new cron process. Overdue
  // returns and gear stuck with somebody who has left therefore also reach the
  // Monday brief, which reads the same alert feed.

  // 19. RULE: ASSET_OVERDUE — an open booking past its due date.
  // MED at first, HIGH after three days, following the same escalation shape
  // as PROPOSAL_STALLED and INVOICE_OVERDUE rather than inventing a third.
  const overdueBookings = await prisma.assetMovement.findMany({
    where: {
      returnedAt: null,
      kind: 'BOOKING',
      dueAt: { lt: now },
      asset: { organizationId, deletedAt: null },
    },
    include: {
      asset: { select: { id: true, tag: true, name: true } },
      user: { select: { name: true } },
    },
  });
  for (const m of overdueBookings) {
    const days = Math.floor((now.getTime() - (m.dueAt as Date).getTime()) / (1000 * 3600 * 24));
    const escalated = days >= 3;
    alerts.push({
      rule: 'ASSET_OVERDUE',
      severity: escalated ? AlertSeverity.HIGH : AlertSeverity.MED,
      entityType: 'Asset',
      entityId: m.asset.id,
      message: `${m.asset.tag} — ${m.asset.name} was due back ${days} day${days === 1 ? '' : 's'} ago and is still with ${m.user.name}.`,
    });
  }

  // 20. RULE: ASSET_HELD_BY_INACTIVE_USER — kit logged out to somebody whose
  // account is off. HIGH with no escalation: this does not get worse with
  // time, it is already the worst version of itself the moment it is true.
  const strandedAssets = await prisma.asset.findMany({
    where: {
      organizationId,
      deletedAt: null,
      currentHolderId: { not: null },
      currentHolder: { active: false },
    },
    include: { currentHolder: { select: { name: true } } },
  });
  for (const a of strandedAssets) {
    alerts.push({
      rule: 'ASSET_HELD_BY_INACTIVE_USER',
      severity: AlertSeverity.HIGH,
      entityType: 'Asset',
      entityId: a.id,
      message: `${a.tag} — ${a.name} is still logged out to ${a.currentHolder?.name ?? 'somebody'}, whose account is switched off.`,
    });
  }

  // 21. RULE: ASSET_REPAIR_STALE — in for repair for over a fortnight with
  // nothing recorded coming back. Usually means the shop was never chased.
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const staleRepairs = await prisma.assetMaintenance.findMany({
    where: {
      returnedAt: null,
      sentAt: { lt: fourteenDaysAgo },
      asset: { organizationId, deletedAt: null, status: 'IN_REPAIR' },
    },
    include: { asset: { select: { id: true, tag: true, name: true } } },
  });
  for (const m of staleRepairs) {
    const days = Math.floor((now.getTime() - m.sentAt.getTime()) / (1000 * 3600 * 24));
    alerts.push({
      rule: 'ASSET_REPAIR_STALE',
      severity: AlertSeverity.MED,
      entityType: 'Asset',
      entityId: m.asset.id,
      message: `${m.asset.tag} — ${m.asset.name} has been at ${m.vendor ?? 'the repair shop'} for ${days} days.`,
    });
  }

  // 22. RULE: ASSET_WARRANTY_EXPIRING — 30 days' notice, LOW. Worth knowing
  // before it lapses because a fault found inside the window is free; the same
  // fault found a week later is not.
  const in30Days = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const expiringWarranties = await prisma.asset.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { notIn: ['RETIRED', 'SOLD', 'LOST'] },
      warrantyUntil: { gte: now, lte: in30Days },
    },
    select: { id: true, tag: true, name: true, warrantyUntil: true },
  });
  for (const a of expiringWarranties) {
    alerts.push({
      rule: 'ASSET_WARRANTY_EXPIRING',
      severity: AlertSeverity.LOW,
      entityType: 'Asset',
      entityId: a.id,
      message: `${a.tag} — ${a.name} is out of warranty on ${(a.warrantyUntil as Date).toISOString().slice(0, 10)}.`,
    });
  }

  return alerts;
}


/**
 * §8: "Company.status ... Past when no Active retainer and no Live project
 * and last activity older than 90 days." The Won → Client transition was
 * already real (proposals.ts); nothing ever derived Past, so a company that
 * had gone fully dormant just stayed whatever status it was last given by
 * hand. Deliberately impure (writes), so it's kept out of the pure
 * evaluator above and called alongside it instead.
 */
async function applyCompanyStatusDerivation(organizationId: string): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const candidates = await prisma.company.findMany({
    where: { organizationId, status: { in: ['PROSPECT', 'CLIENT'] } },
    include: {
      retainers: { where: { status: 'ACTIVE' }, select: { id: true } },
      projects: { where: { status: 'LIVE' }, select: { id: true } },
    },
  });

  for (const c of candidates) {
    if (c.retainers.length > 0 || c.projects.length > 0) continue;

    const lastActivity = await prisma.activity.findFirst({
      where: { organizationId, entityType: 'Company', entityId: c.id },
      orderBy: { at: 'desc' },
      select: { at: true },
    });
    const lastTouched = lastActivity?.at ?? c.createdAt;
    if (lastTouched >= ninetyDaysAgo) continue;

    await prisma.company.update({ where: { id: c.id }, data: { status: 'PAST' } });
    await prisma.activity.create({
      data: {
        organizationId,
        entityType: 'Company',
        entityId: c.id,
        actorId: null,
        verb: 'status_derived_past',
        payload: { reason: 'no active work, no contact in 90 days' },
      },
    });
  }
}

/**
 * Runs the health scanner across all organizations and updates the Alert table.
 *
 * §13: "re-evaluate all 12 rules. Open new alerts, RESOLVE alerts whose
 * condition no longer holds." The resolve half didn't exist — an alert
 * could sit open in the bell forever after whatever it flagged was fixed.
 */
export async function runAgencyHealthScanner(): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let totalAlertsProcessed = 0;

  for (const org of orgs) {
    try {
      await applyCompanyStatusDerivation(org.id);

      const evaluated = await evaluateAgencyHealthRules(org.id);
      const stillOpenKeys = new Set(evaluated.map((item) => `${item.rule}:${item.entityType}:${item.entityId}`));

      for (const item of evaluated) {
        const existing = await prisma.alert.findFirst({
          where: {
            organizationId: org.id,
            rule: item.rule,
            entityType: item.entityType,
            entityId: item.entityId,
            resolvedAt: null,
          },
        });

        if (!existing) {
          await prisma.alert.create({
            data: {
              organizationId: org.id,
              rule: item.rule,
              severity: item.severity,
              entityType: item.entityType,
              entityId: item.entityId,
              message: item.message,
            },
          });
          totalAlertsProcessed++;
        }
      }

      const openAlerts = await prisma.alert.findMany({
        where: { organizationId: org.id, resolvedAt: null },
        select: { id: true, rule: true, entityType: true, entityId: true },
      });
      const toResolve = openAlerts
        .filter((a) => !stillOpenKeys.has(`${a.rule}:${a.entityType}:${a.entityId}`))
        .map((a) => a.id);
      if (toResolve.length > 0) {
        await prisma.alert.updateMany({ where: { id: { in: toResolve } }, data: { resolvedAt: new Date() } });
      }
    } catch (err) {
      logger.error(`Agency health scanner error for org ${org.id}: ${err}`);
    }
  }

  return totalAlertsProcessed;
}

/**
 * Background runner starting the health scanner on an interval.
 */
export function startAgencyHealthScanner(intervalMs = 3600000) {
  // Run once immediately on start (in non-test environments)
  if (process.env.NODE_ENV !== 'test') {
    runAgencyHealthScanner().catch((e) => logger.error(`Initial scanner error: ${e}`));
    setInterval(() => {
      runAgencyHealthScanner().catch((e) => logger.error(`Periodic scanner error: ${e}`));
    }, intervalMs);
  }
}
