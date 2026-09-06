import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, type AuthRequest } from '../middleware/auth.js';
import type { PermissionKey } from '@flowzen/shared';

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
 *   PERSON_UNDERLOADED     "Akmal (Founder) is at 20% of a normal load."
 *
 * A designer is refused /money, /forecast and every `money.figures` gate, and
 * could read a project's cost estimate and the founder's utilisation out of
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
const RULE_PERMISSION: Record<string, PermissionKey | undefined> = {
  // Somebody else's overdue task is a fact about the team. Your own is a fact
  // about you — see MINE_REGARDLESS below, which lets these three through to
  // the person the task belongs to whatever their permissions say.
  TASK_OVERDUE: 'work.team',
  TASK_AGING: 'work.team',
  TASK_WAITING_HOLD: 'work.team',
  PERSON_OVERLOADED: 'work.team',
  PERSON_UNDERLOADED: 'work.team',
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
 * Deliberately only the task rules. PERSON_OVERLOADED and PERSON_UNDERLOADED
 * are about how work has been shared out, which is a decision somebody else
 * makes and should hear about first.
 */
const MINE_REGARDLESS = ['TASK_OVERDUE', 'TASK_AGING', 'TASK_WAITING_HOLD'] as const;

/**
 * What corner of the business a notification is about.
 *
 * The rows said what had happened and never what KIND of thing it was, so a
 * bell holding forty-four of them read as one undifferentiated column: an
 * overdue invoice, a lens that has not come back and somebody's workload all
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
};

/**
 * Where a notification actually goes.
 *
 * The link used to be built as `/${entityType.toLowerCase()}s/${entityId}`,
 * which produced a real page for exactly two of the eight entity types in use.
 * `Company` became `/companys/…`; Task, Proforma, User, Proposal and Invoice
 * have no detail page at all. Thirty-six of the forty-four open alerts led to
 * a hard 404 — verified by following each one.
 *
 * So: a record with a page opens that record, and a record without one opens
 * the screen where you can actually deal with it. `null` means the row is not
 * a link, which is honest and better than a dead one.
 */
/**
 * What each landing screen asks for, so a row is only a link when it opens.
 *
 * Mirrors config/navigation.ts on the web and the route guards behind it.
 * `null` means the screen is open to anybody signed in.
 */
const SCREEN_PERMISSION: Record<string, PermissionKey | null> = {
  '/my-work': null,
  '/assets': null,
  '/members': 'work.team',
  '/companies': 'company.read',
  '/quotations': 'pipeline.read',
  '/live-work': 'work.all',
  '/projects': 'work.all',
  '/retainers': 'work.all',
  '/money': 'money.figures',
  '/allocations': 'cost.enter',
};

const rawLinkFor = (entityType: string, entityId: string): string | null => {
  switch (entityType) {
    case 'Project':
      return `/projects/${entityId}`;
    case 'Retainer':
      return `/retainers/${entityId}`;
    case 'Company':
      return `/companies/${entityId}`;
    case 'Asset':
      return `/assets/${entityId}`;
    // No page of their own — the list that holds them is the useful landing.
    case 'Task':
      return '/my-work';
    case 'User':
      return '/members';
    case 'Invoice':
      return '/money';
    case 'Proposal':
    case 'Proforma':
      return '/quotations';
    case 'MonthCard':
      return '/live-work';
    case 'Organization':
      return '/allocations';
    default:
      return null;
  }
};

/**
 * The link, but only if this person can follow it.
 *
 * Three rules told somebody about something and then sent them nowhere: a Head
 * and a BD both receive INVOICE_OVERDUE, which lands on /money and needs
 * `money.figures` neither of them has; Accounts receives PROJECT_OVER_ESTIMATE,
 * which lands on a project page behind `work.all`. From October, when the month
 * roll starts closing cards, MONTH_CARD_NOT_INVOICED joins them — pointing the
 * one person whose job is invoicing at /live-work, which she cannot open.
 *
 * The rule map above decides what a person is TOLD. It never asked whether
 * they could reach where it was sending them. When they cannot, the row keeps
 * its sentence and loses its link, which the switch's own comment already
 * argues for: "`null` means the row is not a link, which is honest and better
 * than a dead one."
 */
const linkFor = (entityType: string, entityId: string, user: AuthRequest['user']): string | null => {
  const href = rawLinkFor(entityType, entityId);
  if (!href || !user) return href;
  const base = '/' + href.split('/')[1];
  const needed = SCREEN_PERMISSION[base];
  if (needed && !hasPermission(user, needed)) return null;
  return href;
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

    const allowedRules = Object.keys(RULE_PERMISSION).filter((rule) => {
      const needed = RULE_PERMISSION[rule];
      return needed === undefined || hasPermission(req.user!, needed);
    });

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

    const mine =
      myTaskIds.length > 0
        ? [{ rule: { in: [...missingTaskRules] }, entityType: 'Task', entityId: { in: myTaskIds } }]
        : [];

    if (allowedRules.length === 0 && mine.length === 0) {
      res.json({ success: true, notifications: [], unreadCount: 0, total: 0 });
      return;
    }

    const where = {
      organizationId: orgId,
      resolvedAt: null,
      OR: [{ rule: { in: allowedRules } }, ...mine],
    };

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
      link: linkFor(a.entityType, a.entityId, req.user),
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
    const allowedRules = Object.keys(RULE_PERMISSION).filter((rule) => {
      const needed = RULE_PERMISSION[rule];
      return needed === undefined || hasPermission(req.user!, needed);
    });

    const unread = await prisma.alert.findMany({
      where: {
        organizationId: orgId,
        resolvedAt: null,
        rule: { in: allowedRules },
        reads: { none: { userId } },
      },
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

    const needed = RULE_PERMISSION[alert.rule];
    const readable = alert.rule in RULE_PERMISSION && (needed === undefined || hasPermission(req.user!, needed));
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
