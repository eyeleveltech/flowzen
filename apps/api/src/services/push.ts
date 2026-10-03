import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { resolvePermissions, type UserSession } from '../middleware/auth.js';
import { alertClausesFor } from '../routes/notifications.js';
import { EXTERNAL_RULES } from './alertRules.js';
import { approvalType, approverIds } from './taskApprovals.js';
import { linkForUser, taskLink } from '../utils/recordLink.js';
import { addDays, isWorkingDay, loadWorkCalendar, nextWorkingDay, type WorkCalendar } from '../utils/workCalendar.js';
import { localDayAndTime, zonedToUtc } from '../utils/zonedTime.js';

/**
 * Phone notifications (Web Push) — deciding who is told, and when.
 *
 * Nothing here sends. A push is a row in `PushOutbox`; workers/push.cron.ts
 * sends what is due every minute. So a push service that is slow, down or
 * answering errors can never hold up a request, and never undo the thing the
 * push is about.
 *
 * Every helper below is called from the place the thing already happens (the
 * approval routes, the chaser, the calendar's booking mails, the task routes,
 * the scanner), as one line. Each one swallows its own errors: telling people
 * is best effort, and the save it follows has already committed.
 *
 * The rules, in the order `queuePushFor` applies them:
 *
 *   · the server has VAPID keys, and the organisation's switch is on;
 *   · never the person who caused it — booking yourself tells nobody;
 *   · the person is active, has at least one device, and wants this kind;
 *   · outside working hours it waits for the next working morning's start;
 *   · `(userId, sourceKey)` is unique, so one event is one push however many
 *     times, or by however many paths, it is queued.
 */

export type PushKind = 'APPROVALS' | 'CALENDAR' | 'TASKS' | 'BELL' | 'SUMMARY' | 'TEST';

/** Which preference switch each kind answers to. A summary or a test answers to none. */
const PREF_FIELD = {
  APPROVALS: 'pushApprovals',
  CALENDAR: 'pushCalendar',
  TASKS: 'pushTasks',
  BELL: 'pushBell',
} as const;

export type PushPreferences = { pushApprovals: boolean; pushCalendar: boolean; pushTasks: boolean; pushBell: boolean };

/** The schema's own defaults, for a person who has never changed them (no row). */
export const DEFAULT_PREFERENCES: PushPreferences = {
  pushApprovals: true,
  pushCalendar: true,
  pushTasks: true,
  pushBell: false,
};

/** All three keys are in the server's environment. Without them, nothing here runs. */
export const pushConfigured = (): boolean =>
  Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim() && process.env.VAPID_SUBJECT?.trim());

export const vapidPublicKey = (): string | null => process.env.VAPID_PUBLIC_KEY?.trim() || null;

/** Where a summary, or a push with nowhere better to go, opens: the bell, on My Work. */
export const BELL_URL = '/my-work?bell=1';

// ── What a lock screen may show ──────────────────────────────────────────────

const CURRENCY = /₹|\bRs\.?\s?\d|\bINR\b|\brupees?\b|\blakhs?\b|\bcrores?\b/i;
/** 1,90,000 or 190,000 — a grouped figure is money far more often than not. */
const GROUPED_FIGURE = /\b\d{1,3}(?:,\d{2,3})+\b/;

/**
 * The text without its money.
 *
 * A phone shows a notification to whoever is holding it, locked or not. A
 * sentence carrying a figure is dropped whole rather than having the figure
 * cut out of it ("At this rate it finishes at ." reads as a bug); if every
 * sentence carried one, the figures themselves go.
 */
export function withoutMoney(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !CURRENCY.test(s) && !GROUPED_FIGURE.test(s));
  const out = kept.length
    ? kept.join(' ')
    : text
        .replace(/₹\s?[\d,]+(?:\.\d+)?/g, '')
        .replace(/\b(?:Rs\.?|INR)\s?[\d,]+(?:\.\d+)?/gi, '')
        .replace(/\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

/** Short: a title and one line. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Only a path inside Flowzen. Anything else opens My Work. */
export function internalUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return '/my-work';
  return url;
}

/** "Fri 10 Oct", for a due date stored as a calendar day. */
export const dayWords = (day: Date | string): string => {
  const iso = typeof day === 'string' ? day.slice(0, 10) : day.toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
};

// ── When ─────────────────────────────────────────────────────────────────────

const hhmm = (hour: number) => `${String(Math.min(Math.max(hour, 0), 23)).padStart(2, '0')}:00`;

/**
 * When a push made now may be sent: now, inside working hours on a working
 * day; otherwise the start of the next working morning. A holiday is not a
 * working day, so Diwali's pushes arrive the morning after.
 */
export function pushDueAt(calendar: WorkCalendar, timezone: string, now: Date): Date {
  const { date, time } = localDayAndTime(now, timezone);
  const [h, m] = time.split(':').map(Number);
  const minutes = h * 60 + m;
  if (isWorkingDay(calendar, date)) {
    if (minutes >= calendar.startHour * 60 && minutes < calendar.endHour * 60) return now;
    if (minutes < calendar.startHour * 60) return zonedToUtc(date, hhmm(calendar.startHour), timezone);
  }
  return zonedToUtc(nextWorkingDay(calendar, addDays(date, 1)), hhmm(calendar.startHour), timezone);
}

// ── Queuing ──────────────────────────────────────────────────────────────────

export interface PushTarget {
  organizationId: string;
  userId: string;
  /** Whoever caused it. Never told about their own doing. */
  actorId?: string | null;
}

export interface QueueOptions {
  /** Skip working hours — a test the person just asked for. */
  immediate?: boolean;
  now?: Date;
}

/**
 * Queue one push for each of these people who should get it. Returns how many
 * rows were written — 0 for every reason not to, including a duplicate.
 */
export async function queuePushFor(
  organizationId: string,
  userIds: string[],
  actorId: string | null,
  kind: PushKind,
  sourceKey: string,
  title: string,
  body: string,
  url: string,
  opts: QueueOptions = {},
): Promise<number> {
  try {
    if (!pushConfigured()) return 0;
    const ids = [...new Set(userIds)].filter((id) => id && id !== actorId);
    if (ids.length === 0) return 0;

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pushEnabled: true, timezone: true },
    });
    if (!org?.pushEnabled) return 0;

    const people = await prisma.user.findMany({
      where: { id: { in: ids }, organizationId, active: true, pushSubscriptions: { some: {} } },
      select: { id: true, notificationPreference: true },
    });
    const field = kind in PREF_FIELD ? PREF_FIELD[kind as keyof typeof PREF_FIELD] : null;
    const wanted = people.filter((p) => !field || (p.notificationPreference ?? DEFAULT_PREFERENCES)[field]);
    if (wanted.length === 0) return 0;

    const now = opts.now ?? new Date();
    const dueAt = opts.immediate
      ? now
      : pushDueAt(await loadWorkCalendar(organizationId), org.timezone || 'Asia/Kolkata', now);

    const written = await prisma.pushOutbox.createMany({
      data: wanted.map((p) => ({
        organizationId,
        userId: p.id,
        kind,
        sourceKey: clip(sourceKey, 200),
        title: clip(withoutMoney(title), 70) || 'Flowzen',
        body: clip(withoutMoney(body), 140),
        url: internalUrl(url),
        dueAt,
      })),
      skipDuplicates: true,
    });
    return written.count;
  } catch (e) {
    logger.warn(`Push not queued (${kind} ${sourceKey}): ${e instanceof Error ? e.message : e}`);
    return 0;
  }
}

/** One person. */
export const queuePush = (
  user: PushTarget,
  kind: PushKind,
  sourceKey: string,
  title: string,
  body: string,
  url: string,
  opts: QueueOptions = {},
): Promise<number> =>
  queuePushFor(user.organizationId, [user.userId], user.actorId ?? null, kind, sourceKey, title, body, url, opts);

// ── The moments, one helper each ─────────────────────────────────────────────

type Actor = Pick<UserSession, 'userId' | 'organizationId' | 'name'>;

/** Sent for approval: the type's approvers, never the people on the task. */
export async function pushReviewSubmitted(
  actor: Actor,
  task: { id: string; title: string; taskType: Parameters<typeof approvalType>[0]; assignees: { userId: string }[] },
  reviewId: string,
): Promise<void> {
  try {
    const onIt = new Set(task.assignees.map((a) => a.userId));
    const approvers = (await approverIds(actor.organizationId, approvalType(task.taskType))).filter((id) => !onIt.has(id));
    await queuePushFor(
      actor.organizationId,
      approvers,
      actor.userId,
      'APPROVALS',
      `review:${reviewId}:submitted`,
      'Waiting for your approval',
      `${task.title} · from ${actor.name}`,
      taskLink(task.id),
    );
  } catch (e) {
    logger.warn(`Approval push not queued for ${task.id}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Approved, or changes requested: whoever sent it for approval. */
export function pushReviewDecided(
  actor: Actor,
  task: { id: string; title: string },
  review: { id: string; submittedById: string },
  approved: boolean,
  feedback: string | null,
): Promise<number> {
  return queuePushFor(
    actor.organizationId,
    [review.submittedById],
    actor.userId,
    'APPROVALS',
    `review:${review.id}:decided`,
    `${approved ? 'Approved' : 'Changes requested'}: ${task.title}`,
    feedback ? `${actor.name}: ${feedback}` : `by ${actor.name}`,
    taskLink(task.id),
  );
}

/** The chaser's reminder and escalation, to the people it mails. */
export function pushApprovalChase(
  organizationId: string,
  people: string[],
  round: { id: string; task: { id: string; title: string } },
  what: 'REMINDER' | 'ESCALATED',
  waited: string,
): Promise<number> {
  return queuePushFor(
    organizationId,
    people,
    null,
    'APPROVALS',
    `review:${round.id}:${what === 'ESCALATED' ? 'escalated' : 'reminded'}`,
    what === 'ESCALATED' ? 'Approval escalated' : 'Still waiting for your approval',
    `${round.task.title} · waited ${waited}`,
    taskLink(round.task.id),
  );
}

/**
 * The calendar's booking mails — booked, removed, moved, cancelled — as a
 * push. The mail's subject is the title; the rest of its sentence, the line.
 * The people are already "not the person who did it".
 */
export function pushCalendarChange(
  organizationId: string,
  userIds: string[],
  eventId: string,
  subject: string,
  sentence: string,
  url: string,
): Promise<number> {
  const rest = sentence.startsWith(subject)
    ? sentence
        .slice(subject.length)
        .replace(/^[\s,]+/, '')
        .replace(/^\((.*)\)\.?$/, '$1')
    : sentence;
  const line = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : sentence;
  return queuePushFor(organizationId, userIds, null, 'CALENDAR', `event:${eventId}:${Date.now()}`, subject, line, url);
}

/** The morning-of reminder, once per event per day, to the people on it. */
export async function pushEventToday(
  organizationId: string,
  ev: { id: string; title: string },
  today: string,
  message: string,
  url: string,
): Promise<void> {
  try {
    const on = await prisma.calendarEventAttendee.findMany({ where: { eventId: ev.id }, select: { userId: true } });
    const line = message.replace(` · ${ev.title}`, '');
    await queuePushFor(
      organizationId,
      on.map((a) => a.userId),
      null,
      'CALENDAR',
      `event:${ev.id}:today:${today}`,
      `Today: ${ev.title}`,
      line,
      url,
    );
  } catch (e) {
    logger.warn(`Today push not queued for ${ev.id}: ${e instanceof Error ? e.message : e}`);
  }
}

/** A new task: everybody on it except whoever made it. */
export function pushTaskAssigned(
  actor: Actor,
  task: { id: string; title: string; dueDate: Date },
  people: string[],
): Promise<number> {
  return queuePushFor(
    actor.organizationId,
    people,
    actor.userId,
    'TASKS',
    `task:${task.id}:assigned`,
    'New task for you',
    `${task.title} · due ${dayWords(task.dueDate)} · from ${actor.name}`,
    taskLink(task.id),
  );
}

/**
 * An edit: people newly put on the task, and — if the due date moved — the
 * people already on it. `before` is null when the edit did not touch the
 * people. Somebody both added and moved hears once, as added.
 */
export async function pushTaskEdited(
  actor: Actor,
  task: { id: string; title: string; dueDate: Date },
  before: string[] | null,
  newDue: string | null,
): Promise<void> {
  try {
    if (!before && !newDue) return;
    const after = (await prisma.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map(
      (a) => a.userId,
    );
    const added = before ? after.filter((id) => !before.includes(id)) : [];
    const stamp = Date.now();
    if (added.length) {
      await queuePushFor(
        actor.organizationId,
        added,
        actor.userId,
        'TASKS',
        `task:${task.id}:assigned:${stamp}`,
        'New task for you',
        `${task.title} · due ${dayWords(task.dueDate)} · from ${actor.name}`,
        taskLink(task.id),
      );
    }
    if (newDue) {
      await queuePushFor(
        actor.organizationId,
        after.filter((id) => !added.includes(id)),
        actor.userId,
        'TASKS',
        `task:${task.id}:due:${stamp}`,
        `Due date moved: ${task.title}`,
        `Now due ${dayWords(newDue)} · changed by ${actor.name}`,
        taskLink(task.id),
      );
    }
  } catch (e) {
    logger.warn(`Task push not queued for ${task.id}: ${e instanceof Error ? e.message : e}`);
  }
}

// ── Everything in my bell ────────────────────────────────────────────────────

/** A lock-screen title per rule — what kind of thing, never a figure. */
export const RULE_TITLE: Record<string, string> = {
  TASK_OVERDUE: 'Task overdue',
  TASK_AGING: 'Task taking a while',
  TASK_WAITING_HOLD: 'Waiting on the client',
  MEMBER_OVERALLOCATED: 'Over-committed',
  PROJECT_BEHIND_SCHEDULE: 'Project behind schedule',
  PROJECT_OVER_ESTIMATE: 'Project cost to watch',
  RETAINER_EXPIRING: 'Retainer renewing',
  RETAINER_NO_CONTRACT: 'Retainer with no signed term',
  INVOICE_OVERDUE: 'Invoice overdue',
  INVOICE_AGING_60: 'Invoice 60+ days overdue',
  MONTH_CARD_NOT_INVOICED: 'Month not invoiced',
  RETAINER_PROFORMA_NOT_RAISED: 'Proforma not raised',
  PROPOSAL_STALLED: 'Proposal stalled',
  VERBAL_NO_ADVANCE: 'Verbal yes, no advance',
  PROFORMA_EXPIRED: 'Proforma expired',
  PROFORMA_UNPAID: 'Proforma unpaid',
  CLIENT_QUIET: 'Client gone quiet',
  ALLOCATIONS_UNCONFIRMED: 'Time split not confirmed',
  ASSET_OVERDUE: 'Gear overdue',
  ASSET_HELD_BY_INACTIVE_USER: 'Gear with a former member',
  ASSET_REPAIR_STALE: 'Gear stuck at repair',
  ASSET_WARRANTY_EXPIRING: 'Warranty ending',
};

/**
 * New bell alerts, for each person with "Everything in my bell" on — exactly
 * the alerts their bell would show them (`alertClausesFor`), less the
 * approval and calendar ones, which have kinds of their own.
 */
export async function pushNewAlerts(organizationId: string, alertIds: string[]): Promise<void> {
  try {
    if (alertIds.length === 0 || !pushConfigured()) return;
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { pushEnabled: true } });
    if (!org?.pushEnabled) return;

    const people = await prisma.user.findMany({
      where: {
        organizationId,
        active: true,
        pushSubscriptions: { some: {} },
        notificationPreference: { is: { pushBell: true } },
      },
      select: { id: true, email: true, name: true, preset: true, permissions: true },
    });

    for (const p of people) {
      const session: UserSession = {
        userId: p.id,
        organizationId,
        email: p.email,
        name: p.name,
        preset: p.preset,
        permissions: resolvePermissions(p.preset, p.permissions),
        active: true,
      };
      const clauses = await alertClausesFor(session);
      if (clauses.length === 0) continue;
      const alerts = await prisma.alert.findMany({
        where: {
          id: { in: alertIds },
          organizationId,
          rule: { notIn: EXTERNAL_RULES },
          OR: clauses,
        },
        select: { id: true, rule: true, message: true, entityType: true, entityId: true },
      });
      for (const a of alerts) {
        await queuePushFor(
          organizationId,
          [p.id],
          null,
          'BELL',
          `alert:${a.id}`,
          RULE_TITLE[a.rule] ?? 'Flowzen',
          a.message,
          linkForUser(a.entityType, a.entityId, session) ?? BELL_URL,
        );
      }
    }
  } catch (e) {
    logger.warn(`Bell pushes not queued for ${organizationId}: ${e instanceof Error ? e.message : e}`);
  }
}
