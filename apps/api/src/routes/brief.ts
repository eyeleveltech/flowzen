import { Router, type Response, type NextFunction } from 'express';
import type { AlertSeverity, TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, requirePermission } from '../middleware/auth.js';
import { notUsingLastWeek } from '../services/usageSummary.js';
import { composeApprovalsReport } from '../services/approvalsReport.js';
import { TASK_TYPE_LABEL } from '../services/taskApprovals.js';
import { generateBriefSummary } from '../services/briefSummary.js';
import { addDays, isWorkingDay, loadWorkCalendar, todayIn, weekdayOf } from '../utils/workCalendar.js';
import { dayStartUtc, localDayAndTime, whenLabel } from '../utils/zonedTime.js';
import { linkForUser, rawLinkFor, taskLink } from '../utils/recordLink.js';
import { logger } from '../utils/logger.js';

export const briefRouter = Router();

briefRouter.use(authenticate);

/**
 * The Monday brief.
 *
 * It answers four questions, in this order, under a short summary: how did
 * last week go, what needs my action, what is coming this week, and where are
 * the risks — then the team, by department.
 *
 * ─── Where each part comes from ─────────────────────────────────────────────
 *
 *   · Last week is the last complete Monday to Sunday on the organisation's
 *     calendar, set against the week before. Opening it on a Thursday still
 *     shows last week's scoreboard.
 *   · "Needs action" and "Risks" are the open alerts — the same rows the bell
 *     shows, grouped. Not a second calculation: the old brief had its own
 *     "stalled" test and its own idea of overdue (30 days or more), so it
 *     disagreed with the bell and hid every invoice 1–29 days late.
 *   · The team is counted straight from tasks, by department, never by name.
 *     The scanner caps its task alerts (30 overdue, 20 on hold), so counting
 *     alerts would undercount.
 *   · The one block that names people is "Not using Flowzen", for Management
 *     only, and it is never part of what the AI summary is written from.
 *
 * One compute for the screen, the mail job and the summary — never a second,
 * drifting copy.
 */

/* ─── The rules, by where they appear ──────────────────────────────────── */

export const NEEDS_ACTION = [
  { group: 'Money to collect', rules: ['INVOICE_OVERDUE', 'INVOICE_AGING_60', 'PROFORMA_UNPAID'] },
  { group: 'Sales follow-ups', rules: ['VERBAL_NO_ADVANCE', 'PROPOSAL_STALLED', 'PROFORMA_EXPIRED'] },
  { group: 'Billing to do', rules: ['MONTH_CARD_NOT_INVOICED', 'RETAINER_PROFORMA_NOT_RAISED', 'ALLOCATIONS_UNCONFIRMED'] },
  { group: 'Stuck approvals', rules: ['APPROVAL_ESCALATED'] },
] as const;

export const RISKS = [
  { group: 'Delivery', rules: ['PROJECT_OVER_ESTIMATE', 'PROJECT_BEHIND_SCHEDULE'] },
  { group: 'Clients', rules: ['CLIENT_QUIET', 'RETAINER_NO_CONTRACT'] },
] as const;

/** Coming up → renewals, from the alert that already watches a 45-day window. */
const RENEWAL_RULE = 'RETAINER_EXPIRING';

/*
 * Left out on purpose: TASK_* and MEMBER_OVERALLOCATED (the team block counts
 * them, by department), APPROVAL_REMINDER (escalation is the one worth a
 * Monday line) and ASSET_*.
 */
const BRIEF_RULES: string[] = [...[...NEEDS_ACTION, ...RISKS].flatMap((g): string[] => [...g.rules]), RENEWAL_RULE];

/** One alert, as a row somebody can act on. */
export type AlertRow = {
  alertId: string;
  rule: string;
  /** What it is, without the client — the client has its own column. */
  title: string;
  clientName: string | null;
  amount?: number;
  /** Who to ask: the proposal, project or retainer owner. Never the editor on an approval. */
  ownerName?: string;
  flaggedDaysAgo: number;
  severity: AlertSeverity;
  link: string | null;
};

type Viewer = AuthRequest['user'];
type Week = { from: string; to: string };

const DAY_MS = 86_400_000;
const SEVERITY_RANK: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };

/** A calendar day as the UTC midnight a `@db.Date` column stores it at. */
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
/** And back. */
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
/** A stored summary as plain text — one written before markdown was stripped on the way in still reads cleanly. */
const plainText = (s: string) => s.replace(/\*\*|__/g, '').trim();

/**
 * Last week, the week before, and the seven days ahead, on the organisation's
 * calendar. Weeks run Monday to Sunday; `weekStart` is this week's Monday — the
 * Monday the brief is FOR.
 */
export function weeksFor(timezone: string, now: Date) {
  const today = todayIn(timezone, now);
  const weekStart = addDays(today, -((weekdayOf(today) + 6) % 7));
  return {
    today,
    weekStart,
    last: { from: addDays(weekStart, -7), to: addDays(weekStart, -1) },
    before: { from: addDays(weekStart, -14), to: addDays(weekStart, -8) },
    comingUntil: addDays(today, 7),
  };
}

/*
 * Two kinds of date in this schema, and a week has to be cut the right way for
 * each. A moment (`wonAt`, `sentAt`, `completedAt`) is cut at the studio's
 * midnight — a proposal sent at 23:30 IST on Sunday is last week's, though it
 * is Sunday 18:00 in UTC. A calendar day (`receivedAt`, `raisedAt`, `dueAt`)
 * is already the studio's day and is compared as one.
 */
const momentsIn = (w: Week, tz: string) => ({ gte: dayStartUtc(w.from, tz), lt: dayStartUtc(addDays(w.to, 1), tz) });
const daysIn = (w: Week) => ({ gte: asDate(w.from), lt: asDate(addDays(w.to, 1)) });

type DeptRef = { departmentId: string | null };
type HasPeople = { assignees: { user: DeptRef }[]; assignee: DeptRef | null };
/** Who is on a task, as the department each belongs to. */
const DEPT_OF_PEOPLE = {
  assignees: { select: { user: { select: { departmentId: true } } } },
  assignee: { select: { departmentId: true } },
} as const;

/** The departments a task belongs to, by id — once each, however many of one department are on it. '' is none. */
function deptsOf(t: HasPeople): string[] {
  const ids = t.assignees.length ? t.assignees.map((a) => a.user.departmentId) : t.assignee ? [t.assignee.departmentId] : [];
  return [...new Set(ids.map((id) => id ?? ''))];
}

/**
 * The organisation's departments, for naming and ordering — archived ones
 * too, so a task finished by somebody in a department since archived still
 * says where it was done. Ordered as Settings → Departments orders them.
 */
async function departmentBook(orgId: string) {
  const rows = await prisma.department.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
  const at = new Map(rows.map((r, i) => [r.id, { name: r.name, i }]));
  return {
    name: (id: string) => at.get(id)?.name ?? 'No department',
    rank: (id: string) => at.get(id)?.i ?? rows.length,
  };
}
type DepartmentBook = Awaited<ReturnType<typeof departmentBook>>;

/* ─── Last week ─────────────────────────────────────────────────────────── */

async function weekFigures(orgId: string, w: Week, tz: string) {
  const [cash, invoiced, won, sent, done] = await Promise.all([
    // A payment counts the week it came in, whichever invoice it was against.
    prisma.payment.aggregate({
      where: { receivedAt: daysIn(w), invoice: { organizationId: orgId } },
      _sum: { amount: true },
    }),
    // `amount`, the figure the Money screen uses. A cancelled invoice was never billed.
    prisma.invoice.aggregate({
      where: { organizationId: orgId, raisedAt: daysIn(w), status: { not: 'CANCELLED' } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.proposal.findMany({
      where: { organizationId: orgId, deletedAt: null, outcome: 'WON', wonAt: momentsIn(w, tz) },
      select: { versions: { orderBy: { n: 'desc' }, take: 1, select: { value: true } } },
    }),
    // Every version sent, revisions included — the tile says so.
    prisma.proposalVersion.count({
      where: { sentAt: momentsIn(w, tz), proposal: { organizationId: orgId, deletedAt: null } },
    }),
    prisma.task.findMany({
      where: { organizationId: orgId, deletedAt: null, status: 'DONE', completedAt: momentsIn(w, tz) },
      select: {
        completedAt: true,
        dueDate: true,
        ...DEPT_OF_PEOPLE,
      },
    }),
  ]);
  return {
    cashCollected: num(cash._sum.amount),
    invoiced: { amount: num(invoiced._sum.amount), count: invoiced._count._all },
    dealsWon: { count: won.length, value: won.reduce((s, p) => s + num(p.versions[0]?.value), 0) },
    proposalsSent: sent,
    tasksDone: {
      count: done.length,
      // On time: finished on or before the day it was due, on the studio's calendar.
      onTime: done.filter((t) => t.completedAt && localDayAndTime(t.completedAt, tz).date <= dayOf(t.dueDate)).length,
    },
    doneTasks: done,
  };
}

/** How approvals went, one entry per approver group — today that is one "All work" group. */
/** A week as the approvals report takes it: the studio's midnight to the last millisecond of Sunday. */
const reportRange = (w: Week, tz: string) => ({
  from: dayStartUtc(w.from, tz),
  to: new Date(dayStartUtc(addDays(w.to, 1), tz).getTime() - 1),
});
const groupKey = (types: TaskType[]) => [...types].sort().join(',');
const groupLabel = (g: { allWork: boolean; taskTypes: TaskType[] }) =>
  g.allWork ? 'All work' : g.taskTypes.map((t) => TASK_TYPE_LABEL[t]).join(', ');

async function approvalFigures(orgId: string, shown: Week, previous: Week, tz: string, now: Date) {
  const [last, before] = await Promise.all([
    composeApprovalsReport(orgId, reportRange(shown, tz), now),
    composeApprovalsReport(orgId, reportRange(previous, tz), now),
  ]);
  const pick = (g: (typeof last.byType)[number]) => ({
    decided: g.decided,
    medianDecisionMinutes: g.medianDecisionMinutes,
    onTime: g.onTime,
    escalated: g.escalated,
  });
  return last.byType.map((g) => {
    const prev = before.byType.find((b) => groupKey(b.taskTypes) === groupKey(g.taskTypes));
    return { group: groupLabel(g), last: pick(g), before: prev ? pick(prev) : null };
  });
}

/** The week before a week. */
const weekBefore = (w: Week): Week => ({ from: addDays(w.from, -7), to: addDays(w.from, -1) });

/**
 * One week's scoreboard against the week before it — the current brief's
 * "last week", or any of the 26 before it on the week switcher. One compute
 * for both, so a past week can never be counted differently from this one.
 */
export async function scoreboardFor(orgId: string, shown: Week, tz: string, now: Date) {
  const previous = weekBefore(shown);
  const [last, before, approvals] = await Promise.all([
    weekFigures(orgId, shown, tz),
    weekFigures(orgId, previous, tz),
    approvalFigures(orgId, shown, previous, tz, now),
  ]);
  const pair = <T>(pick: (w: typeof last) => T) => ({ last: pick(last), before: pick(before) });
  return {
    before: previous,
    scoreboard: {
      cashCollected: pair((w) => w.cashCollected),
      invoiced: pair((w) => w.invoiced),
      dealsWon: pair((w) => w.dealsWon),
      proposalsSent: pair((w) => w.proposalsSent),
      tasksDone: pair((w) => w.tasksDone),
      approvals,
    },
    doneTasks: last.doneTasks,
  };
}

/* ─── The open alerts, as rows ─────────────────────────────────────────── */

/**
 * The alert's own sentence, less the client it names — the client is its own
 * column. "Invoice INV/0144 for Da One is overdue…" → "Invoice INV/0144 is
 * overdue…". Kept as the rule's own words so a row reads the same as the bell.
 */
function withoutClient(message: string, client: string | null): string {
  let s = message;
  if (client) {
    for (const lead of [`${client}'s `, `${client} has had `, `${client} `]) {
      if (s.startsWith(lead)) {
        s = s.slice(lead.length);
        break;
      }
    }
    s = s.split(` for ${client}`).join('').split(` with ${client}`).join('');
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "3 h", "2 days" — how long something has been waiting. */
function waitedFor(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Every open alert the brief shows, enriched in batches — one query per kind
 * of record, never one per row — with its client, amount, owner and link.
 */
async function alertRows(orgId: string, now: Date, viewer?: Viewer) {
  const alerts = await prisma.alert.findMany({
    where: { organizationId: orgId, resolvedAt: null, rule: { in: BRIEF_RULES } },
    select: { id: true, rule: true, severity: true, entityType: true, entityId: true, message: true, raisedAt: true },
  });
  const idsOf = (type: string) => [...new Set(alerts.filter((a) => a.entityType === type).map((a) => a.entityId))];
  const owner = { select: { name: true } } as const;
  const company = { select: { name: true, owner } } as const;

  const [invoices, proformas, proposals, monthCards, tasks, projects, companies, retainers] = await Promise.all([
    idsOf('Invoice').length
      ? prisma.invoice.findMany({
          where: { id: { in: idsOf('Invoice') } },
          select: {
            id: true,
            amount: true,
            company,
            payments: { select: { amount: true } },
            project: { select: { owner } },
            monthCard: { select: { retainer: { select: { owner } } } },
          },
        })
      : [],
    idsOf('Proforma').length
      ? prisma.proforma.findMany({
          where: { id: { in: idsOf('Proforma') } },
          select: { id: true, amount: true, sourceType: true, sourceId: true, company },
        })
      : [],
    idsOf('Proposal').length
      ? prisma.proposal.findMany({
          where: { id: { in: idsOf('Proposal') } },
          select: { id: true, company, owner, versions: { orderBy: { n: 'desc' }, take: 1, select: { value: true } } },
        })
      : [],
    idsOf('MonthCard').length
      ? prisma.monthCard.findMany({
          where: { id: { in: idsOf('MonthCard') } },
          select: { id: true, revenue: true, retainer: { select: { company, owner } } },
        })
      : [],
    idsOf('Task').length
      ? prisma.task.findMany({
          where: { id: { in: idsOf('Task') } },
          select: {
            id: true,
            title: true,
            company: { select: { name: true } },
            project: { select: { company: { select: { name: true } } } },
            monthCard: { select: { retainer: { select: { company: { select: { name: true } } } } } },
            // When the round now waiting went in — not who sent it.
            reviews: { where: { decision: null }, orderBy: { round: 'desc' }, take: 1, select: { submittedAt: true } },
          },
        })
      : [],
    idsOf('Project').length
      ? prisma.project.findMany({ where: { id: { in: idsOf('Project') } }, select: { id: true, company, owner } })
      : [],
    idsOf('Company').length
      ? prisma.company.findMany({ where: { id: { in: idsOf('Company') } }, select: { id: true, name: true, owner } })
      : [],
    idsOf('Retainer').length
      ? prisma.retainer.findMany({
          where: { id: { in: idsOf('Retainer') } },
          select: { id: true, monthlyValue: true, renewalDate: true, company, owner },
        })
      : [],
  ]);

  // A proforma's owner is whoever owns what it bills: the proposal, project or retainer.
  const source = (type: string) => proformas.filter((p) => p.sourceType === type).map((p) => p.sourceId);
  const [pfProposals, pfProjects, pfMonthCards] = await Promise.all([
    source('PROPOSAL').length
      ? prisma.proposal.findMany({ where: { id: { in: source('PROPOSAL') } }, select: { id: true, owner } })
      : [],
    source('PROJECT').length
      ? prisma.project.findMany({ where: { id: { in: source('PROJECT') } }, select: { id: true, owner } })
      : [],
    source('MONTH_CARD').length
      ? prisma.monthCard.findMany({
          where: { id: { in: source('MONTH_CARD') } },
          select: { id: true, retainer: { select: { owner } } },
        })
      : [],
  ]);
  const proformaOwner = new Map<string, string | undefined>([
    ...pfProposals.map((p) => [p.id, p.owner.name] as const),
    ...pfProjects.map((p) => [p.id, p.owner.name] as const),
    ...pfMonthCards.map((m) => [m.id, m.retainer.owner.name] as const),
  ]);

  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const invoice = byId(invoices);
  const proforma = byId(proformas);
  const proposal = byId(proposals);
  const monthCard = byId(monthCards);
  const task = byId(tasks);
  const project = byId(projects);
  const companyOf = byId(companies);
  const retainer = byId(retainers);

  const linkTo = (entityType: string, entityId: string) =>
    viewer ? linkForUser(entityType, entityId, viewer) : rawLinkFor(entityType, entityId);

  const rows: AlertRow[] = [];
  const renewals: {
    alertId: string;
    clientName: string;
    renewalDate: string | null;
    monthlyValue: number;
    ownerName?: string;
    severity: AlertSeverity;
    link: string | null;
  }[] = [];

  for (const a of alerts) {
    const base = {
      alertId: a.id,
      rule: a.rule,
      severity: a.severity,
      flaggedDaysAgo: Math.max(0, Math.floor((now.getTime() - a.raisedAt.getTime()) / DAY_MS)),
    };
    const row = (clientName: string | null, extra: { amount?: number; ownerName?: string; title?: string } = {}) =>
      rows.push({
        ...base,
        clientName,
        title: extra.title ?? withoutClient(a.message, clientName),
        ...(extra.amount !== undefined ? { amount: extra.amount } : {}),
        ...(extra.ownerName ? { ownerName: extra.ownerName } : {}),
        link: linkTo(a.entityType, a.entityId),
      });

    /*
     * A record that has gone since the alert was raised is left out: there is
     * nothing to open, and the scanner closes the alert on its next pass.
     */
    switch (a.entityType) {
      case 'Invoice': {
        const inv = invoice.get(a.entityId);
        if (!inv) break;
        const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0);
        row(inv.company.name, {
          amount: Math.max(0, num(inv.amount) - paid),
          ownerName: inv.project?.owner.name ?? inv.monthCard?.retainer.owner.name ?? inv.company.owner?.name,
        });
        break;
      }
      case 'Proforma': {
        const pf = proforma.get(a.entityId);
        if (!pf) break;
        row(pf.company.name, {
          amount: num(pf.amount),
          ownerName: proformaOwner.get(pf.sourceId) ?? pf.company.owner?.name,
        });
        break;
      }
      case 'Proposal': {
        const p = proposal.get(a.entityId);
        if (!p) break;
        row(p.company.name, { amount: num(p.versions[0]?.value), ownerName: p.owner.name });
        break;
      }
      case 'MonthCard': {
        const mc = monthCard.get(a.entityId);
        if (!mc) break;
        row(mc.retainer.company.name, { amount: num(mc.revenue), ownerName: mc.retainer.owner.name });
        break;
      }
      case 'Task': {
        // A stuck approval: the video, its client and how long — never the editor's name.
        const t = task.get(a.entityId);
        if (!t) break;
        const client =
          t.monthCard?.retainer.company.name || t.project?.company.name || t.company?.name || null;
        const since = t.reviews[0]?.submittedAt ?? a.raisedAt;
        rows.push({
          ...base,
          clientName: client,
          title: `${t.title} — waiting ${waitedFor(now.getTime() - since.getTime())}`,
          link: taskLink(t.id),
        });
        break;
      }
      case 'Project': {
        const p = project.get(a.entityId);
        if (!p) break;
        row(p.company.name, { ownerName: p.owner.name });
        break;
      }
      case 'Company': {
        const c = companyOf.get(a.entityId);
        if (!c) break;
        row(c.name, { ownerName: c.owner?.name });
        break;
      }
      case 'Retainer': {
        const r = retainer.get(a.entityId);
        if (!r) break;
        if (a.rule === RENEWAL_RULE) {
          renewals.push({
            alertId: a.id,
            clientName: r.company.name,
            renewalDate: r.renewalDate ? dayOf(r.renewalDate) : null,
            monthlyValue: num(r.monthlyValue),
            ownerName: r.owner.name,
            severity: a.severity,
            link: linkTo('Retainer', r.id),
          });
        } else {
          row(r.company.name, { amount: num(r.monthlyValue), ownerName: r.owner.name });
        }
        break;
      }
      // The month's time split: about the team as a whole, with no client.
      case 'Organization':
        row(null);
        break;
      default:
        row(null);
    }
  }

  // Worst first, then the most money.
  rows.sort(
    (x, y) => (SEVERITY_RANK[x.severity] ?? 9) - (SEVERITY_RANK[y.severity] ?? 9) || (y.amount ?? -1) - (x.amount ?? -1),
  );
  renewals.sort((x, y) => (x.renewalDate ?? '9999').localeCompare(y.renewalDate ?? '9999'));

  const grouped = (sections: readonly { group: string; rules: readonly string[] }[]) =>
    sections
      .map((s) => ({ group: s.group, items: rows.filter((r) => (s.rules as readonly string[]).includes(r.rule)) }))
      .filter((g) => g.items.length > 0);

  return { needsAction: grouped(NEEDS_ACTION), risks: grouped(RISKS), renewals };
}

/* ─── The week ahead ───────────────────────────────────────────────────── */

async function comingUp(orgId: string, weeks: ReturnType<typeof weeksFor>, tz: string, viewer?: Viewer) {
  const linkTo = (entityType: string, entityId: string) =>
    viewer ? linkForUser(entityType, entityId, viewer) : rawLinkFor(entityType, entityId);
  const ahead = { gte: asDate(weeks.today), lt: asDate(addDays(weeks.comingUntil, 1)) };

  const [invoices, projects, events] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId: orgId, status: { in: ['RAISED', 'OVERDUE'] }, dueAt: ahead },
      select: {
        id: true,
        number: true,
        amount: true,
        dueAt: true,
        company: { select: { name: true } },
        payments: { select: { amount: true } },
      },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.project.findMany({
      where: { organizationId: orgId, deletedAt: null, status: 'LIVE', endDate: ahead },
      select: {
        id: true,
        name: true,
        endDate: true,
        company: { select: { name: true } },
        owner: { select: { name: true } },
      },
      orderBy: { endDate: 'asc' },
    }),
    prisma.calendarEvent.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        kind: { in: ['SHOOT', 'MEETING'] },
        startsAt: { gte: dayStartUtc(weeks.today, tz), lt: dayStartUtc(addDays(weeks.comingUntil, 1), tz) },
      },
      select: {
        id: true,
        kind: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        location: true,
        company: { select: { name: true } },
        project: { select: { company: { select: { name: true } } } },
        retainer: { select: { company: { select: { name: true } } } },
        // Who is on the shoot — fine here; never sent to the summary.
        attendees: { select: { user: { select: { name: true } } } },
      },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  return {
    invoicesDue: invoices
      .map((i) => ({
        id: i.id,
        clientName: i.company.name,
        number: i.number,
        balance: Math.max(0, num(i.amount) - i.payments.reduce((s, p) => s + num(p.amount), 0)),
        dueAt: dayOf(i.dueAt),
        link: linkTo('Invoice', i.id),
      }))
      .filter((i) => i.balance > 0),
    projectsEnding: projects.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.company.name,
      ownerName: p.owner.name,
      endDate: dayOf(p.endDate),
      link: linkTo('Project', p.id),
    })),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind as 'SHOOT' | 'MEETING',
      title: e.title,
      when: whenLabel(e.startsAt, e.endsAt, e.allDay, tz),
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      location: e.location,
      clientName: e.company?.name ?? e.project?.company.name ?? e.retainer?.company.name ?? null,
      people: e.attendees.map((a) => a.user.name),
      link: rawLinkFor('CalendarEvent', e.id),
    })),
  };
}

/* ─── The team, by department ──────────────────────────────────────────── */

type TeamRow = {
  /** Null for people nobody has placed in a department yet. */
  departmentId: string | null;
  dept: string;
  active: number;
  overdue: number;
  dueThisWeek: number;
  doneLastWeek: number;
  waitingOnClient: number;
  inReview: number;
  overAllocatedPeople: number;
  /**
   * The same open work split so no task is in two pieces, for the stacked
   * bar: overdue first (on hold included), then on track, in review, and
   * waiting on the client. `active` and `overdue` above overlap; these don't.
   */
  segments: { overdue: number; onTrack: number; inReview: number; waitingOnClient: number };
};

async function teamByDepartment(
  orgId: string,
  weeks: ReturnType<typeof weeksFor>,
  book: DepartmentBook,
  doneLastWeek: HasPeople[],
): Promise<TeamRow[]> {
  const month = weeks.today.slice(0, 7);
  const [open, allocations] = await Promise.all([
    prisma.task.findMany({
      where: { organizationId: orgId, deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'IN_REVIEW'] } },
      select: {
        status: true,
        dueDate: true,
        waitingOn: true,
        ...DEPT_OF_PEOPLE,
      },
    }),
    prisma.peopleAllocation.groupBy({
      by: ['userId'],
      where: { month, user: { organizationId: orgId, active: true } },
      _sum: { percent: true },
    }),
  ]);
  const overIds = allocations.filter((a) => (a._sum.percent ?? 0) > 100).map((a) => a.userId);
  const over = overIds.length
    ? await prisma.user.findMany({ where: { id: { in: overIds } }, select: { departmentId: true } })
    : [];

  const rows = new Map<string, TeamRow>();
  const rowFor = (id: string) => {
    if (!rows.has(id)) {
      rows.set(id, {
        departmentId: id || null,
        dept: book.name(id),
        active: 0,
        overdue: 0,
        dueThisWeek: 0,
        doneLastWeek: 0,
        waitingOnClient: 0,
        inReview: 0,
        overAllocatedPeople: 0,
        segments: { overdue: 0, onTrack: 0, inReview: 0, waitingOnClient: 0 },
      });
    }
    return rows.get(id)!;
  };

  const today = weeks.today;
  for (const t of open) {
    const due = dayOf(t.dueDate);
    for (const dept of deptsOf(t)) {
      const r = rowFor(dept);
      if (t.status === 'TODO' || t.status === 'IN_PROGRESS') r.active += 1;
      // Waiting on an approver is not the editor's overdue: IN_REVIEW is left out.
      if (due < today && t.status !== 'IN_REVIEW') r.overdue += 1;
      if (due >= today && due <= weeks.comingUntil) r.dueThisWeek += 1;
      if (t.status === 'ON_HOLD' && t.waitingOn === 'CLIENT') r.waitingOnClient += 1;
      if (t.status === 'IN_REVIEW') r.inReview += 1;

      const late = due < today && t.status !== 'IN_REVIEW';
      if (late) r.segments.overdue += 1;
      else if (t.status === 'TODO' || t.status === 'IN_PROGRESS') r.segments.onTrack += 1;
      else if (t.status === 'IN_REVIEW') r.segments.inReview += 1;
      else if (t.status === 'ON_HOLD' && t.waitingOn === 'CLIENT') r.segments.waitingOnClient += 1;
    }
  }
  for (const t of doneLastWeek) for (const dept of deptsOf(t)) rowFor(dept).doneLastWeek += 1;
  for (const u of over) rowFor(u.departmentId ?? '').overAllocatedPeople += 1;

  return [...rows.values()]
    .filter((r) => r.active + r.overdue + r.dueThisWeek + r.doneLastWeek + r.waitingOnClient + r.inReview + r.overAllocatedPeople > 0)
    .sort((a, b) => book.rank(a.departmentId ?? '') - book.rank(b.departmentId ?? '') || a.dept.localeCompare(b.dept));
}

/* ─── The brief ────────────────────────────────────────────────────────── */

export async function composeMondayBrief(
  orgId: string,
  opts: {
    /** "Not using Flowzen" — Management only. Never part of the summary's input. */
    includeUsage?: boolean;
    now?: Date;
    /** Who is reading, so a row only links where they can follow. The mail job leaves it out. */
    viewer?: Viewer;
  } = {},
) {
  const now = opts.now ?? new Date();
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true, currency: true, aiApiKey: true },
  });
  const tz = org?.timezone || 'Asia/Kolkata';
  const weeks = weeksFor(tz, now);

  const [board, alerts, ahead, stored, calendar] = await Promise.all([
    scoreboardFor(orgId, weeks.last, tz, now),
    alertRows(orgId, now, opts.viewer),
    comingUp(orgId, weeks, tz, opts.viewer),
    prisma.weeklyBrief.findUnique({
      where: { organizationId_weekStart: { organizationId: orgId, weekStart: asDate(weeks.weekStart) } },
      select: { summary: true, summaryModel: true, generatedAt: true },
    }),
    loadWorkCalendar(orgId),
  ]);
  const team = await teamByDepartment(orgId, weeks, await departmentBook(orgId), board.doneTasks);

  /*
   * "Not using Flowzen" — the one place the brief names people, and apart
   * from the team block. Usage is Management's alone (routes/usage.ts), so it
   * is only put in for them; anybody else granted the brief gets it without.
   */
  // A line about who is using the app must never cost the brief itself.
  const notUsing = opts.includeUsage
    ? await notUsingLastWeek(orgId, now).catch((e) => {
        logger.warn(`Monday brief: usage line skipped: ${e instanceof Error ? e.message : e}`);
        return null;
      })
    : null;

  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    currency: org?.currency || 'INR',
    weeks: {
      last: weeks.last,
      before: weeks.before,
      today: weeks.today,
      comingUntil: weeks.comingUntil,
      weekStart: weeks.weekStart,
      /** This week, Monday to Sunday, for the timeline: which days are worked. */
      days: Array.from({ length: 7 }, (_, i) => {
        const day = addDays(weeks.weekStart, i);
        return { day, working: isWorkingDay(calendar, day) };
      }),
    },
    scoreboard: board.scoreboard,
    needsAction: alerts.needsAction,
    risks: alerts.risks,
    comingUp: { ...ahead, renewals: alerts.renewals },
    team,
    summary: stored?.summary
      ? { text: plainText(stored.summary), generatedAt: stored.generatedAt.toISOString(), model: stored.summaryModel }
      : null,
    /** Whether a summary can be written at all — the screen says so when not. */
    aiConfigured: Boolean(org?.aiApiKey),
    notUsingFlowzen: notUsing
      ? { title: 'Not using Flowzen', from: notUsing.from, to: notUsing.to, people: notUsing.people, line: notUsing.line }
      : null,
  };
}

export type MondayBrief = Awaited<ReturnType<typeof composeMondayBrief>>;

/* ─── Other weeks, trends and the rows behind a number ─────────────────── */

/** How far back the week switcher goes. */
export const WEEKS_BACK = 26;

/**
 * Which week to show: a Monday on the studio's calendar, no later than the
 * current brief's "last week" and no more than 26 weeks before it. Null when
 * the asked-for week is not one of those.
 */
export function resolveWeek(tz: string, now: Date, asked?: unknown) {
  const latest = weeksFor(tz, now).last.from;
  const earliest = addDays(latest, -7 * WEEKS_BACK);
  if (asked === undefined || asked === '') return { from: latest, to: addDays(latest, 6), current: true, latest, earliest };
  if (typeof asked !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asked) || Number.isNaN(asDate(asked).getTime())) return null;
  if (weekdayOf(asked) !== 1 || asked > latest || asked < earliest) return null;
  return { from: asked, to: addDays(asked, 6), current: asked === latest, latest, earliest };
}

/** The Monday of the week a calendar day falls in. */
const mondayOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));

type TrendPoint = { weekStart: string; value: number | null };
const TRENDS_KEEP_MS = 10 * 60_000;
const trendCache = new Map<string, { at: number; trends: Awaited<ReturnType<typeof computeTrends>> }>();

/** For tests: forget the cached trends. */
export const forgetTrends = () => trendCache.clear();

/**
 * Each scoreboard figure for the 8 complete weeks ending at `shownFrom`.
 *
 * One query per figure over the whole stretch, bucketed by the studio's week —
 * not the brief composed eight times. Approval times are the approvals
 * report's own medians, a week at a time, because a median of medians is not
 * one. Held for ten minutes: closed weeks hardly move.
 */
async function computeTrends(orgId: string, shownFrom: string, tz: string, now: Date) {
  const mondays = Array.from({ length: 8 }, (_, i) => addDays(shownFrom, -7 * (7 - i)));
  const span: Week = { from: mondays[0], to: addDays(shownFrom, 6) };
  const [payments, invoices, won, sent, done, approvals] = await Promise.all([
    prisma.payment.findMany({
      where: { receivedAt: daysIn(span), invoice: { organizationId: orgId } },
      select: { amount: true, receivedAt: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId: orgId, raisedAt: daysIn(span), status: { not: 'CANCELLED' } },
      select: { amount: true, raisedAt: true },
    }),
    prisma.proposal.findMany({
      where: { organizationId: orgId, deletedAt: null, outcome: 'WON', wonAt: momentsIn(span, tz) },
      select: { wonAt: true, versions: { orderBy: { n: 'desc' }, take: 1, select: { value: true } } },
    }),
    prisma.proposalVersion.findMany({
      where: { sentAt: momentsIn(span, tz), proposal: { organizationId: orgId, deletedAt: null } },
      select: { sentAt: true },
    }),
    prisma.task.findMany({
      where: { organizationId: orgId, deletedAt: null, status: 'DONE', completedAt: momentsIn(span, tz) },
      select: { completedAt: true },
    }),
    Promise.all(mondays.map((m) => composeApprovalsReport(orgId, reportRange({ from: m, to: addDays(m, 6) }, tz), now))),
  ]);

  /** Sum values into the week each one falls in. */
  const series = <T>(rows: T[], dayOfRow: (r: T) => string | null, valueOf: (r: T) => number): TrendPoint[] => {
    const totals = new Map(mondays.map((m) => [m, 0]));
    for (const r of rows) {
      const d = dayOfRow(r);
      if (!d) continue;
      const m = mondayOf(d);
      if (totals.has(m)) totals.set(m, totals.get(m)! + valueOf(r));
    }
    return mondays.map((m) => ({ weekStart: m, value: totals.get(m)! }));
  };
  const local = (d: Date | null) => (d ? localDayAndTime(d, tz).date : null);

  // Approval groups as the shown week has them, matched across weeks by their task types.
  const shownGroups = approvals[approvals.length - 1].byType;
  return {
    cashCollected: series(payments, (p) => dayOf(p.receivedAt), (p) => num(p.amount)),
    invoiced: series(invoices, (i) => dayOf(i.raisedAt), (i) => num(i.amount)),
    dealsWon: series(won, (p) => local(p.wonAt), (p) => num(p.versions[0]?.value)),
    proposalsSent: series(sent, (v) => local(v.sentAt), () => 1),
    tasksDone: series(done, (t) => local(t.completedAt), () => 1),
    approvals: shownGroups.map((g) => ({
      group: groupLabel(g),
      points: mondays.map((m, i) => ({
        weekStart: m,
        value: approvals[i].byType.find((b) => groupKey(b.taskTypes) === groupKey(g.taskTypes))?.medianDecisionMinutes ?? null,
      })),
    })),
  };
}

export async function trendsFor(orgId: string, shownFrom: string, tz: string, now: Date) {
  const key = `${orgId}|${shownFrom}`;
  const hit = trendCache.get(key);
  if (hit && now.getTime() - hit.at < TRENDS_KEEP_MS) return hit.trends;
  const trends = await computeTrends(orgId, shownFrom, tz, now);
  trendCache.set(key, { at: now.getTime(), trends });
  return trends;
}

/**
 * A past week: its scoreboard and its stored summary. What needs action, the
 * week ahead, risks and the team describe NOW, so they are not given for a
 * week that has gone.
 */
async function pastWeek(orgId: string, shown: Week, now: Date) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true, currency: true, aiApiKey: true },
  });
  const tz = org?.timezone || 'Asia/Kolkata';
  // The brief written for the Monday after that week is the one about it.
  const writtenFor = addDays(shown.from, 7);
  const [board, stored] = await Promise.all([
    scoreboardFor(orgId, shown, tz, now),
    prisma.weeklyBrief.findUnique({
      where: { organizationId_weekStart: { organizationId: orgId, weekStart: asDate(writtenFor) } },
      select: { summary: true, summaryModel: true, generatedAt: true },
    }),
  ]);
  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    currency: org?.currency || 'INR',
    weeks: { last: shown, before: board.before, weekStart: writtenFor },
    scoreboard: board.scoreboard,
    summary: stored?.summary
      ? { text: plainText(stored.summary), generatedAt: stored.generatedAt.toISOString(), model: stored.summaryModel }
      : null,
    aiConfigured: Boolean(org?.aiApiKey),
    needsAction: null,
    risks: null,
    comingUp: null,
    team: null,
    notUsingFlowzen: null,
  };
}

const NOT_A_WEEK = `Pick a Monday within the last ${WEEKS_BACK} weeks.`;

/**
 * GET /api/brief/monday[?week=YYYY-MM-DD] — the brief, as it stands now, or
 * the scoreboard and summary of one of the 26 weeks before. Never calls the
 * model: the summary is the one already written for that week, if any.
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
      const orgId = req.user!.organizationId;
      const now = new Date();
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
      const tz = org?.timezone || 'Asia/Kolkata';
      const week = resolveWeek(tz, now, req.query.week);
      if (!week) {
        res.status(400).json({ success: false, error: NOT_A_WEEK });
        return;
      }
      const [brief, trends] = await Promise.all([
        week.current
          ? composeMondayBrief(orgId, { includeUsage: req.user!.preset === 'MANAGEMENT', viewer: req.user, now })
          : pastWeek(orgId, week, now),
        trendsFor(orgId, week.from, tz, now),
      ]);
      res.json({
        success: true,
        ...brief,
        trends,
        week: { shown: week.from, current: week.current, latest: week.latest, earliest: week.earliest },
      });
    } catch (e) {
      next(e);
    }
  },
);

const METRICS = ['cash', 'invoiced', 'deals', 'proposals', 'tasks'] as const;
type Metric = (typeof METRICS)[number];
const DETAIL_ROWS = 100;

/**
 * What is behind one number on the scoreboard, for that number's week — every
 * row with a link. Tasks are given by department only: no names, no list.
 */
export async function briefDetails(orgId: string, metric: Metric, shown: Week, viewer?: Viewer) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  const tz = org?.timezone || 'Asia/Kolkata';
  const linkTo = (entityType: string, entityId: string) =>
    viewer ? linkForUser(entityType, entityId, viewer) : rawLinkFor(entityType, entityId);
  const capped = <T>(rows: T[]) => ({ rows: rows.slice(0, DETAIL_ROWS), more: rows.length > DETAIL_ROWS });

  switch (metric) {
    case 'cash': {
      const rows = await prisma.payment.findMany({
        where: { receivedAt: daysIn(shown), invoice: { organizationId: orgId } },
        select: { id: true, amount: true, receivedAt: true, invoice: { select: { id: true, number: true, company: { select: { name: true } } } } },
        orderBy: { receivedAt: 'asc' },
        take: DETAIL_ROWS + 1,
      });
      return capped(rows.map((p) => ({
        id: p.id,
        date: dayOf(p.receivedAt),
        clientName: p.invoice.company.name,
        number: p.invoice.number,
        amount: num(p.amount),
        link: linkTo('Invoice', p.invoice.id),
      })));
    }
    case 'invoiced': {
      const rows = await prisma.invoice.findMany({
        where: { organizationId: orgId, raisedAt: daysIn(shown), status: { not: 'CANCELLED' } },
        select: { id: true, number: true, amount: true, raisedAt: true, company: { select: { name: true } } },
        orderBy: { raisedAt: 'asc' },
        take: DETAIL_ROWS + 1,
      });
      return capped(rows.map((i) => ({
        id: i.id,
        date: dayOf(i.raisedAt),
        number: i.number,
        clientName: i.company.name,
        amount: num(i.amount),
        link: linkTo('Invoice', i.id),
      })));
    }
    case 'deals': {
      const rows = await prisma.proposal.findMany({
        where: { organizationId: orgId, deletedAt: null, outcome: 'WON', wonAt: momentsIn(shown, tz) },
        select: {
          id: true,
          wonAt: true,
          company: { select: { name: true } },
          owner: { select: { name: true } },
          versions: { orderBy: { n: 'desc' }, take: 1, select: { value: true } },
        },
        orderBy: { wonAt: 'asc' },
        take: DETAIL_ROWS + 1,
      });
      return capped(rows.map((p) => ({
        id: p.id,
        date: p.wonAt ? localDayAndTime(p.wonAt, tz).date : null,
        clientName: p.company.name,
        value: num(p.versions[0]?.value),
        ownerName: p.owner.name,
        link: linkTo('Proposal', p.id),
      })));
    }
    case 'proposals': {
      const rows = await prisma.proposalVersion.findMany({
        where: { sentAt: momentsIn(shown, tz), proposal: { organizationId: orgId, deletedAt: null } },
        select: { id: true, n: true, value: true, sentAt: true, proposal: { select: { id: true, company: { select: { name: true } } } } },
        orderBy: { sentAt: 'asc' },
        take: DETAIL_ROWS + 1,
      });
      return capped(rows.map((v) => ({
        id: v.id,
        date: localDayAndTime(v.sentAt, tz).date,
        clientName: v.proposal.company.name,
        version: v.n,
        value: num(v.value),
        link: linkTo('Proposal', v.proposal.id),
      })));
    }
    case 'tasks': {
      // Departments only — no names and no task list (decision 4).
      const done = await prisma.task.findMany({
        where: { organizationId: orgId, deletedAt: null, status: 'DONE', completedAt: momentsIn(shown, tz) },
        select: {
          completedAt: true,
          dueDate: true,
          ...DEPT_OF_PEOPLE,
        },
      });
      const book = await departmentBook(orgId);
      const byDept = new Map<string, { departmentId: string | null; dept: string; done: number; onTime: number }>();
      for (const t of done) {
        const onTime = Boolean(t.completedAt && localDayAndTime(t.completedAt, tz).date <= dayOf(t.dueDate));
        for (const id of deptsOf(t)) {
          const row = byDept.get(id) ?? { departmentId: id || null, dept: book.name(id), done: 0, onTime: 0 };
          row.done += 1;
          if (onTime) row.onTime += 1;
          byDept.set(id, row);
        }
      }
      const rank = (r: { departmentId: string | null }) => book.rank(r.departmentId ?? '');
      return {
        rows: [...byDept.values()].sort((a, b) => rank(a) - rank(b) || a.dept.localeCompare(b.dept)),
        more: false,
        // The tile's own number: each task once, however many departments it touched.
        total: { done: done.length, onTime: done.filter((t) => t.completedAt && localDayAndTime(t.completedAt, tz).date <= dayOf(t.dueDate)).length },
      };
    }
  }
}

/** GET /api/brief/monday/details?metric=cash|invoiced|deals|proposals|tasks&week=YYYY-MM-DD */
briefRouter.get(
  '/monday/details',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const metric = req.query.metric;
      if (typeof metric !== 'string' || !(METRICS as readonly string[]).includes(metric)) {
        res.status(400).json({ success: false, error: `metric must be one of ${METRICS.join(', ')}.` });
        return;
      }
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
      const week = resolveWeek(org?.timezone || 'Asia/Kolkata', new Date(), req.query.week);
      if (!week) {
        res.status(400).json({ success: false, error: NOT_A_WEEK });
        return;
      }
      const details = await briefDetails(orgId, metric as Metric, week, req.user);
      res.json({ success: true, metric, week: { from: week.from, to: week.to }, ...details });
    } catch (e) {
      next(e);
    }
  },
);

/** A summary is not rewritten more often than this. */
const REWRITE_AFTER_MS = 10 * 60_000;

/**
 * POST /api/brief/monday/summary — write this week's summary again, from the
 * numbers as they are now.
 */
briefRouter.post(
  '/monday/summary',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const now = new Date();
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { aiApiKey: true, timezone: true } });
      if (!org?.aiApiKey) {
        res.status(409).json({ success: false, error: "AI isn't set up. Add a key in Settings → Zen.", code: 'NO_KEY' });
        return;
      }
      const weekStart = weeksFor(org.timezone || 'Asia/Kolkata', now).weekStart;
      const existing = await prisma.weeklyBrief.findUnique({
        where: { organizationId_weekStart: { organizationId: orgId, weekStart: asDate(weekStart) } },
        select: { summary: true, generatedAt: true },
      });
      if (existing?.summary && now.getTime() - existing.generatedAt.getTime() < REWRITE_AFTER_MS) {
        const wait = Math.ceil((REWRITE_AFTER_MS - (now.getTime() - existing.generatedAt.getTime())) / 60_000);
        res.status(429).json({
          success: false,
          error: `The summary was written a few minutes ago. Try again in ${wait} ${wait === 1 ? 'minute' : 'minutes'}.`,
        });
        return;
      }
      // Written for every reader of the brief, so never from the usage block.
      const brief = await composeMondayBrief(orgId, { now });
      const written = await generateBriefSummary(orgId, brief);
      if (!written) {
        res.status(502).json({ success: false, error: 'The summary could not be written just now. Try again later.' });
        return;
      }
      res.json({ success: true, summary: { text: written.text, generatedAt: written.generatedAt.toISOString(), model: written.model } });
    } catch (e) {
      next(e);
    }
  },
);
