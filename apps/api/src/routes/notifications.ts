import { Router, type Response, type NextFunction } from 'express';
import { TaskStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, type AuthRequest, type UserSession } from '../middleware/auth.js';
import type { PermissionKey } from '@flowzen/shared';
import { approverFor, escalateFor } from '../services/taskApprovals.js';
import { CHASER_RULES, EVENT_RULES } from '../services/alertRules.js';
import { linkForUser, taskLink } from '../utils/recordLink.js';
import { teamScope } from '../services/teamScope.js';

/**
 * The bell.
 *
 * ─── What this used to be ───────────────────────────────────────────────────
 *
 * Organisation-scoped and otherwise wide open — the same shape `activities.ts`
 * had before it was fixed, and with the same consequence. Every signed-in
 * person got the same twenty alerts, verified against the live database: the
 * founder, a department head, business development and a designer with nothing
 * but `work.own` all received an identical payload. Among it:
 *
 *   PROJECT_OVER_ESTIMATE  "…has spent past its estimate of 190000."
 *   INVOICE_OVERDUE        client, invoice number, days past due
 *   MEMBER_OVERALLOCATED   who is committed past 100% of their month
 *
 * A designer is refused /money, /forecast and every `money.figures` gate, and
 * could read a project's cost estimate and another person's commitments out of
 * the bell. Every alert rule now names the permission its own SCREEN needs.
 *
 * ─── And read state was shared by the whole company ─────────────────────────
 *
 * `Alert.acknowledgedById` is one column on a row the organisation shares, so
 * the first person to press "Mark all read" cleared the badge for everybody.
 * On the live database 41 of 44 open alerts carried one manager's id — which
 * is why all four roles above reported an unread count of exactly 3. Reading
 * is now per person (`AlertRead`), and acknowledgement stays what it always
 * was: the organisation recording that somebody has taken this on.
 */

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

/**
 * The permission each alert's own screen requires.
 *
 * `undefined` means everybody — the asset register is open to anyone signed
 * in, so an overdue camera is too. A rule NOT in this map is withheld rather
 * than shown: a new rule should stay quiet until somebody decides who it is
 * for, which is the safe direction to fail.
 */
export const RULE_PERMISSION: Record<string, PermissionKey | undefined> = {
  // Somebody else's overdue task is a fact about the team. Your own is a fact
  // about you — see MINE_REGARDLESS below, which lets these three through to
  // the person the task belongs to whatever their permissions say.
  TASK_OVERDUE: 'work.team',
  TASK_AGING: 'work.team',
  TASK_WAITING_HOLD: 'work.team',
  MEMBER_OVERALLOCATED: 'work.team',

  // The work itself.
  PROJECT_BEHIND_SCHEDULE: 'work.all',
  RETAINER_EXPIRING: 'work.all',
  RETAINER_NO_CONTRACT: 'work.all',

  // Names a cost estimate in the message, so it is a figure.
  PROJECT_OVER_ESTIMATE: 'money.figures',

  // Paid / unpaid / overdue is the status gate, not the figures gate.
  INVOICE_OVERDUE: 'money.status',
  INVOICE_AGING_60: 'money.status',
  MONTH_CARD_NOT_INVOICED: 'money.status',
  // Billing the month is Accounts' job, so it reaches them.
  RETAINER_PROFORMA_NOT_RAISED: 'money.status',

  // Selling.
  PROPOSAL_STALLED: 'pipeline.read',
  VERBAL_NO_ADVANCE: 'pipeline.read',
  PROFORMA_EXPIRED: 'pipeline.read',
  PROFORMA_UNPAID: 'pipeline.read',
  CLIENT_QUIET: 'company.read',

  // The month's cost split, which is the Time split screen's own gate.
  ALLOCATIONS_UNCONFIRMED: 'cost.enter',

  // The register is open to everybody signed in, so its alerts are too — a
  // designer needs to know the lens is late back more than anyone.
  ASSET_OVERDUE: undefined,
  ASSET_HELD_BY_INACTIVE_USER: undefined,
  ASSET_REPAIR_STALE: undefined,
  ASSET_WARRANTY_EXPIRING: undefined,
};

/**
 * The rules that reach you about your OWN work, whatever you may see.
 *
 * Six of fourteen people are EMPLOYEE, holding `work.own` and nothing else, so
 * every task rule above was closed to them and their bell was structurally
 * empty — permanently, by construction. Meanwhile the scanner was raising
 * nineteen TASK_OVERDUE alerts, one of which read "Task ... assigned to Sneha
 * (Designer) is overdue", and showing it to everyone except Sneha.
 *
 * The permission is not wrong: somebody else's overdue task IS a fact about
 * the team. It just never asked the other question — whether the task is
 * yours. These three rules all hang off a Task, so that question has an
 * answer.
 *
 * Deliberately only the task rules. MEMBER_OVERALLOCATED is about how work has
 * been shared out, which is a decision somebody else makes and should hear
 * about first.
 */
export const MINE_REGARDLESS = ['TASK_OVERDUE', 'TASK_AGING', 'TASK_WAITING_HOLD'] as const;

/**
 * The approval chaser's alerts this person should see.
 *
 * Not in RULE_PERMISSION on purpose: the audience is people, not a
 * permission. A reminder reaches the task type's approvers; an escalation
 * reaches them and the type's escalation people. Only while the task is still
 * in review, and never about work the person is on — the editor already sees
 * the state on their own My Work, and nobody approves their own task.
 *
 * The bell, "Mark all read", reading one, and the 8am digest all decide a
 * person's alerts through this — one rule, not a copy in each place.
 */
export async function approvalAlertClauses(orgId: string, userId: string): Promise<Prisma.AlertWhereInput[]> {
  const [types, escalationTypes] = await Promise.all([approverFor(orgId, userId), escalateFor(orgId, userId)]);
  if (types.length === 0 && escalationTypes.length === 0) return [];

  const waiting = (taskTypes: typeof types) =>
    taskTypes.length === 0
      ? Promise.resolve([] as string[])
      : prisma.task
          .findMany({
            where: {
              organizationId: orgId,
              deletedAt: null,
              status: TaskStatus.IN_REVIEW,
              taskType: { in: taskTypes },
              NOT: { assignees: { some: { userId } } },
            },
            select: { id: true },
          })
          .then((rows) => rows.map((t) => t.id));
  const [approverTaskIds, escalationTaskIds] = await Promise.all([waiting(types), waiting(escalationTypes)]);

  return [
    ...(approverTaskIds.length > 0
      ? [{ rule: { in: [...CHASER_RULES] }, entityType: 'Task', entityId: { in: approverTaskIds } }]
      : []),
    ...(escalationTaskIds.length > 0
      ? [{ rule: 'APPROVAL_ESCALATED', entityType: 'Task', entityId: { in: escalationTaskIds } }]
      : []),
  ];
}

/**
 * The calendar's alerts this person should see: the morning-of reminder and
 * "booked / moved / cancelled", for events they are on.
 *
 * Like the approval clauses, not a permission: the audience is the event's
 * people. Somebody taken off an event stops seeing its alerts; a cancelled
 * event keeps its people, so its "Cancelled" row still reaches them. Only
 * recent events are looked at — older alerts are resolved by the worker.
 */
export async function eventAlertClauses(orgId: string, userId: string, now = new Date()): Promise<Prisma.AlertWhereInput[]> {
  const since = new Date(now.getTime() - 3 * 86_400_000);
  const rows = await prisma.calendarEventAttendee.findMany({
    where: { userId, event: { organizationId: orgId, endsAt: { gte: since } } },
    select: { eventId: true },
  });
  if (rows.length === 0) return [];
  return [{ rule: { in: EVENT_RULES }, entityType: 'CalendarEvent', entityId: { in: rows.map((r) => r.eventId) } }];
}

/** Everything reaching a person by who they are rather than what they may see. */
export async function peopleAlertClauses(orgId: string, userId: string): Promise<Prisma.AlertWhereInput[]> {
  const [approvals, events] = await Promise.all([approvalAlertClauses(orgId, userId), eventAlertClauses(orgId, userId)]);
  return [...approvals, ...events];
}

/**
 * The rules about the team rather than the work. A Head hears them only about
 * the people of the departments they lead (Departments Plan 3).
 */
export const TEAM_RULES = ['TASK_OVERDUE', 'TASK_AGING', 'TASK_WAITING_HOLD', 'MEMBER_OVERALLOCATED'] as const;

/**
 * Every alert a person should be told about, as the OR of a where clause.
 *
 * The bell, "Mark all read", reading one, and the 8am digest all ask this,
 * so what a person is mailed and what their bell shows are one rule:
 *
 *   - the rules their permissions open (RULE_PERMISSION);
 *   - for a Head, the team rules only about their own people — an overdue task
 *     somebody in another department is on is that department's business;
 *   - the task rules about their own tasks, whatever their permissions
 *     (MINE_REGARDLESS);
 *   - approvals waiting on them and today's events they are on.
 *
 * An empty list means there is nothing this person may be told.
 */
export async function alertClausesFor(user: UserSession): Promise<Prisma.AlertWhereInput[]> {
  const orgId = user.organizationId;
  const userId = user.userId;

  const allowedRules = Object.keys(RULE_PERMISSION).filter((rule) => {
    const needed = RULE_PERMISSION[rule];
    return needed === undefined || hasPermission(user, needed);
  });

  const scope = await teamScope(user);
  const isTeamRule = (rule: string) => (TEAM_RULES as readonly string[]).includes(rule);
  const openRules = scope.all ? allowedRules : allowedRules.filter((r) => !isTeamRule(r));

  /*
   * A Head's team rules, narrowed to their people (and themselves). Looked up
   * from the open alerts rather than from every task those people were ever
   * on, so the list stays the size of what is actually raised.
   */
  const scoped: Prisma.AlertWhereInput[] = [];
  if (!scope.all) {
    const people = [...scope.peopleIds, userId];
    const taskRules = allowedRules.filter((r) => isTeamRule(r) && r !== 'MEMBER_OVERALLOCATED');
    if (taskRules.length > 0) {
      const raised = await prisma.alert.findMany({
        where: { organizationId: orgId, resolvedAt: null, rule: { in: taskRules }, entityType: 'Task' },
        select: { entityId: true },
      });
      const theirs =
        raised.length === 0
          ? []
          : await prisma.task.findMany({
              where: {
                id: { in: Array.from(new Set(raised.map((a) => a.entityId))) },
                organizationId: orgId,
                assignees: { some: { userId: { in: people } } },
              },
              select: { id: true },
            });
      if (theirs.length > 0) {
        scoped.push({ rule: { in: taskRules }, entityType: 'Task', entityId: { in: theirs.map((t) => t.id) } });
      }
    }
    if (allowedRules.includes('MEMBER_OVERALLOCATED')) {
      scoped.push({ rule: 'MEMBER_OVERALLOCATED', entityType: 'User', entityId: { in: people } });
    }
  }

  /*
   * Everything about a task this person is actually on, so the rules above
   * reach the one person who can do something about them even when the team
   * view is closed to them. Only asked for when the permission has not
   * already let those rules through, so nobody pays for a query they do not
   * need.
   */
  const missingTaskRules = MINE_REGARDLESS.filter((r) => !allowedRules.includes(r));
  const myTaskIds =
    missingTaskRules.length > 0
      ? (
          await prisma.task.findMany({
            where: { organizationId: orgId, deletedAt: null, assignees: { some: { userId } } },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [];
  const mine: Prisma.AlertWhereInput[] =
    myTaskIds.length > 0 ? [{ rule: { in: [...missingTaskRules] }, entityType: 'Task', entityId: { in: myTaskIds } }] : [];

  const approvals = await peopleAlertClauses(orgId, userId);

  return [...(openRules.length > 0 ? [{ rule: { in: openRules } }] : []), ...scoped, ...mine, ...approvals];
}

/**
 * What corner of the business a notification is about.
 *
 * The rows said what had happened and never what KIND of thing it was, so a
 * bell holding forty-four of them read as one undifferentiated column: an
 * overdue invoice, a lens that has not come back and an over-committed month all
 * looked alike until you had read the sentence.
 *
 * Taken from the entity type rather than the rule, because that is the same
 * thing `linkFor` uses to decide where the row opens — so the label a person
 * reads and the screen they land on can never drift apart.
 */
const SOURCE: Record<string, string> = {
  Task: 'Tasks',
  User: 'Team',
  Project: 'Projects',
  Retainer: 'Retainers',
  Company: 'Clients',
  Proposal: 'Pipeline',
  Proforma: 'Pipeline',
  Invoice: 'Money',
  MonthCard: 'Money',
  Asset: 'Assets',
  Organization: 'Time split',
  CalendarEvent: 'Calendar',
};

/** Where a row opens: utils/recordLink, shared with the calendar. */
/**
 * The link, but only if this person can follow it (see utils/recordLink).
 *
 * Three rules told somebody about something and then sent them nowhere: a Head
 * and a BD both receive INVOICE_OVERDUE, which lands on /money and needs
 * `money.figures` neither of them has; Accounts receives PROJECT_OVER_ESTIMATE,
 * which lands on a project page behind `work.all`. The rule map decides what a
 * person is TOLD; this decides whether the row is also a way there.
 */
const linkFor = (
  entityType: string,
  entityId: string,
  user: AuthRequest['user'],
  rule?: string,
): string | null => {
  // A stuck approval opens the task itself, where Approve is.
  if (rule && (CHASER_RULES as readonly string[]).includes(rule)) return taskLink(entityId);
  return linkForUser(entityType, entityId, user);
};

/** How many alerts the bell carries. More than a glance, less than a report. */
const FEED_LIMIT = 50;

/**
 * GET /api/notifications — what this person is allowed to be told.
 */
notificationsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;

    const clauses = await alertClausesFor(req.user!);
    if (clauses.length === 0) {
      res.json({ success: true, notifications: [], unreadCount: 0, total: 0 });
      return;
    }

    const where: Prisma.AlertWhereInput = { organizationId: orgId, resolvedAt: null, OR: clauses };

    const [alerts, total, myReads] = await Promise.all([
      prisma.alert.findMany({
        where,
        // Worst first, then newest. A bell that orders purely by time buries
        // an overdue invoice under six task reminders raised a minute later.
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        take: FEED_LIMIT,
      }),
      prisma.alert.count({ where }),
      prisma.alertRead.findMany({ where: { userId }, select: { alertId: true } }),
    ]);

    const readIds = new Set(myReads.map((r) => r.alertId));

    const notifications = alerts.map((a) => ({
      id: a.id,
      type: a.rule,
      title: a.message,
      message: a.message,
      severity: a.severity,
      /** "Money", "Tasks", "Pipeline" — what this is about, at a glance. */
      source: SOURCE[a.entityType] ?? 'Other',
      link: linkFor(a.entityType, a.entityId, req.user, a.rule),
      read: readIds.has(a.id),
      createdAt: a.createdAt,
    }));

    // Counted across everything this person may see, not across the page just
    // fetched — a badge computed from a slice under-reports the moment there
    // are more unread alerts than the slice holds.
    const unreadCount = await prisma.alert.count({
      where: { ...where, reads: { none: { userId } } },
    });

    res.json({ success: true, notifications, unreadCount, total });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/notifications/read-all — clear MY badge.
 *
 * Declared before `/:id/read` so "read-all" is never captured as an id.
 */
notificationsRouter.patch('/read-all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;

    // Only what this person can see. Marking an alert read that they were
    // never shown would be a strange thing for a button to do.
    const clauses = await alertClausesFor(req.user!);

    const unread =
      clauses.length === 0
        ? []
        : await prisma.alert.findMany({
            where: { organizationId: orgId, resolvedAt: null, OR: clauses, reads: { none: { userId } } },
            select: { id: true },
          });

    if (unread.length > 0) {
      await prisma.alertRead.createMany({
        data: unread.map((a) => ({ alertId: a.id, userId })),
        skipDuplicates: true,
      });
    }

    res.json({ success: true, marked: unread.length });
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/notifications/:id/read — clear one, for me. */
notificationsRouter.patch('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;

    // Prove it is this organisation's alert before writing a row that points
    // at it, and that this person was allowed to be told about it at all.
    const alert = await prisma.alert.findFirst({
      where: { id: String(id), organizationId: orgId },
      select: { id: true, rule: true },
    });
    if (!alert) {
      res.status(404).json({ success: false, error: 'That notification does not exist.' });
      return;
    }

    // Theirs when it would reach them — the same clauses the bell used. Only
    // the clauses that name this rule can match it; a clause that is the rule
    // and nothing else matches outright, the rest are asked of the database.
    const clauses = (await alertClausesFor(req.user!)).filter((c) => {
      const rule = c.rule as string | { in: string[] };
      return typeof rule === 'string' ? rule === alert.rule : rule.in.includes(alert.rule);
    });
    const readable =
      clauses.some((c) => Object.keys(c).length === 1) ||
      (clauses.length > 0 && (await prisma.alert.count({ where: { id: alert.id, OR: clauses } })) > 0);
    if (!readable) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    await prisma.alertRead.upsert({
      where: { alertId_userId: { alertId: alert.id, userId } },
      create: { alertId: alert.id, userId },
      update: {},
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
