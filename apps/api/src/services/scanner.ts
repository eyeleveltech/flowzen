/**
 * The daily scanner.
 *
 * Every morning, in the organisation's timezone, this walks the list of signals
 * defined in the master plan §4.12 and upserts one notification per person per
 * signal. The deduplication key `(userId, dedupeKey)` ensures that a scanner
 * running twice — or a signal remaining true across days — updates the existing
 * row rather than adding a second. Without that discipline the bell fills with
 * thirty identical "invoice #123 overdue" lines in a month, and the day that
 * starts is the day people stop reading it.
 *
 * Each signal is its own function so that it can be tested in isolation.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { endOfDay, isBeforeToday, daysBetween } from '../utils/orgDay.js';
import { isRotting } from './stageRules.js';
import { isOverdue } from './invoice.service.js';
import { findAwaitingReply } from './quote.service.js';
import { logger } from '../utils/logger.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type NotificationRow = {
  userId: string;
  type: string;
  title: string;
  message: string;
  link: string;
  dedupeKey: string;
};

/**
 * Upsert on (userId, dedupeKey). The row is created if absent and updated if
 * already there, so the notification stays current rather than duplicating.
 *
 * `readAt` is NOT cleared on update — if the person saw it once, re-surfacing
 * it as unread would be noise. The timestamp and message are updated so the
 * bell shows the latest wording.
 */
const upsertNotifications = async (rows: NotificationRow[]): Promise<number> => {
  let written = 0;
  for (const row of rows) {
    try {
      await prisma.notification.upsert({
        where: {
          userId_dedupeKey: { userId: row.userId, dedupeKey: row.dedupeKey },
        },
        update: {
          title: row.title,
          message: row.message,
          link: row.link,
          type: row.type,
          updatedAt: new Date(),
        },
        create: {
          userId: row.userId,
          type: row.type,
          title: row.title,
          message: row.message,
          link: row.link,
          dedupeKey: row.dedupeKey,
        },
      });
      written++;
    } catch (e) {
      // A missing user (deleted between query and upsert) is not an error worth
      // stopping the scan for. Log it and continue.
      logger.warn(`[scanner] Failed to upsert notification for ${row.dedupeKey}: ${(e as Error).message}`);
    }
  }
  return written;
};

// ─── Signal: follow-ups due ──────────────────────────────────────────────────

export const scanFollowUps = async (orgId: string, timezone: string): Promise<NotificationRow[]> => {
  const todayEnd = endOfDay(new Date(), timezone);
  const deals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      isOnHold: false,
      followUpDate: { not: null, lte: todayEnd },
      stage: { kind: 'OPEN' },
      ownerId: { not: null },
    },
    select: {
      id: true,
      title: true,
      ownerId: true,
      followUpDate: true,
      company: { select: { name: true } },
    },
  });

  return deals.map((d) => ({
    userId: d.ownerId!,
    type: 'FOLLOW_UP_DUE',
    title: `Follow up with ${d.company.name}`,
    message: `${d.title ?? d.company.name} — follow-up was due ${d.followUpDate!.toISOString().slice(0, 10)}.`,
    link: `/pipeline/${d.id}`,
    dedupeKey: `followup:${d.id}`,
  }));
};

// ─── Signal: deals gone quiet (rotting) ──────────────────────────────────────

export const scanRottingDeals = async (orgId: string, timezone: string): Promise<NotificationRow[]> => {
  const now = new Date();
  const deals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      isOnHold: false,
      stage: { kind: 'OPEN' },
      ownerId: { not: null },
    },
    select: {
      id: true,
      title: true,
      ownerId: true,
      createdAt: true,
      company: { select: { name: true } },
      stage: { select: { name: true, kind: true, rottingDays: true } },
      stageHistory: { orderBy: { enteredAt: 'desc' as const }, take: 1 },
    },
  });

  const rows: NotificationRow[] = [];
  for (const d of deals) {
    const enteredAt = d.stageHistory[0]?.enteredAt ?? d.createdAt;
    const daysInStage = daysBetween(now, enteredAt, timezone);
    if (isRotting({ kind: d.stage.kind, rottingDays: d.stage.rottingDays }, daysInStage)) {
      rows.push({
        userId: d.ownerId!,
        type: 'DEAL_ROTTING',
        title: `${d.company.name} has gone quiet`,
        message: `${d.title ?? d.company.name} has been in "${d.stage.name}" for ${daysInStage} days.`,
        link: `/pipeline/${d.id}`,
        dedupeKey: `rotting:${d.id}`,
      });
    }
  }
  return rows;
};

// ─── Signal: quotes with no reply ────────────────────────────────────────────

export const scanQuotesAwaitingReply = async (orgId: string): Promise<NotificationRow[]> => {
  const quotes = await findAwaitingReply(orgId, 7);
  return quotes
    .filter((q) => q.deal.ownerId)
    .map((q) => ({
      userId: q.deal.ownerId!,
      type: 'QUOTE_NO_REPLY',
      title: `No reply on ${q.number}`,
      message: `Quotation ${q.number} for ${q.company.name} has had no reply since it was sent.`,
      link: `/quotations?highlight=${q.id}`,
      dedupeKey: `quote-no-reply:${q.id}`,
    }));
};

// ─── Signal: engagements due for review ──────────────────────────────────────

export const scanReviewsDue = async (orgId: string): Promise<NotificationRow[]> => {
  const horizon = new Date(Date.now() + 30 * 86_400_000);
  const engagements = await prisma.engagement.findMany({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      endDate: null, // rolling only — fixed-term expiry is a different signal
      nextReviewDate: { not: null, lte: horizon },
    },
    select: {
      id: true,
      nextReviewDate: true,
      company: { select: { id: true, name: true, ownerId: true } },
    },
  });

  return engagements
    .filter((e) => e.company.ownerId)
    .map((e) => ({
      userId: e.company.ownerId!,
      type: 'REVIEW_DUE',
      title: `Review ${e.company.name}'s terms`,
      message: `The engagement with ${e.company.name} is due for a price review.`,
      link: `/clients/${e.company.id}`,
      dedupeKey: `review-due:${e.id}`,
    }));
};

// ─── Signal: fixed-term engagements expiring ─────────────────────────────────

export const scanExpiringEngagements = async (orgId: string): Promise<NotificationRow[]> => {
  const horizon = new Date(Date.now() + 30 * 86_400_000);
  const engagements = await prisma.engagement.findMany({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      endDate: { not: null, lte: horizon },
    },
    select: {
      id: true,
      endDate: true,
      company: { select: { id: true, name: true, ownerId: true } },
    },
  });

  return engagements
    .filter((e) => e.company.ownerId)
    .map((e) => ({
      userId: e.company.ownerId!,
      type: 'ENGAGEMENT_EXPIRING',
      title: `${e.company.name}'s engagement is ending`,
      message: `The engagement with ${e.company.name} ends on ${e.endDate!.toISOString().slice(0, 10)}. Renew or not?`,
      link: `/clients/${e.company.id}`,
      dedupeKey: `expiring:${e.id}`,
    }));
};

// ─── Signal: invoices overdue ────────────────────────────────────────────────

export const scanOverdueInvoices = async (orgId: string): Promise<NotificationRow[]> => {
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: orgId,
      status: { in: ['SENT', 'PARTIALLY_PAID'] },
      dueDate: { lt: now },
    },
    select: {
      id: true,
      number: true,
      total: true,
      dueDate: true,
      company: { select: { id: true, name: true, ownerId: true } },
    },
  });

  // Overdue invoices go to the company owner AND all admins, because money is
  // the admin's domain (§3.10).
  const admins = await prisma.userRole.findMany({
    where: { organizationId: orgId, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { userId: true },
  });
  const adminIds = new Set(admins.map((a) => a.userId));

  const rows: NotificationRow[] = [];
  for (const inv of invoices) {
    // Notify company owner
    if (inv.company.ownerId) {
      rows.push({
        userId: inv.company.ownerId,
        type: 'INVOICE_OVERDUE',
        title: `Invoice ${inv.number} is overdue`,
        message: `${inv.company.name} — ${inv.number} for ${inv.total.toString()} was due ${inv.dueDate.toISOString().slice(0, 10)}.`,
        link: `/revenue?tab=invoices&highlight=${inv.id}`,
        dedupeKey: `overdue-invoice:${inv.id}:${inv.company.ownerId}`,
      });
    }
    // Notify admins (skip if they are already the owner)
    for (const adminId of adminIds) {
      if (adminId === inv.company.ownerId) continue;
      rows.push({
        userId: adminId,
        type: 'INVOICE_OVERDUE',
        title: `Invoice ${inv.number} is overdue`,
        message: `${inv.company.name} — ${inv.number} for ${inv.total.toString()} was due ${inv.dueDate.toISOString().slice(0, 10)}.`,
        link: `/revenue?tab=invoices&highlight=${inv.id}`,
        dedupeKey: `overdue-invoice:${inv.id}:${adminId}`,
      });
    }
  }
  return rows;
};

// ─── Signal: billing due ─────────────────────────────────────────────────────

export const scanBillingDue = async (orgId: string, timezone: string): Promise<NotificationRow[]> => {
  const todayEnd = endOfDay(new Date(), timezone);
  const engagements = await prisma.engagement.findMany({
    where: {
      organizationId: orgId,
      status: 'ACTIVE',
      nextBillingDate: { not: null, lte: todayEnd },
    },
    select: {
      id: true,
      amount: true,
      company: { select: { id: true, name: true } },
    },
  });

  // Billing notifications go to admins — they are the ones who raise invoices.
  const admins = await prisma.userRole.findMany({
    where: { organizationId: orgId, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { userId: true },
  });

  const rows: NotificationRow[] = [];
  for (const eng of engagements) {
    for (const admin of admins) {
      rows.push({
        userId: admin.userId,
        type: 'BILLING_DUE',
        title: `Invoice due for ${eng.company.name}`,
        message: `An invoice for ${eng.amount.toString()} is due to be raised for ${eng.company.name}.`,
        link: `/revenue?tab=billing`,
        dedupeKey: `billing-due:${eng.id}:${admin.userId}`,
      });
    }
  }
  return rows;
};

// ─── Signal: tasks overdue / due today ───────────────────────────────────────

export const scanTasks = async (orgId: string, timezone: string): Promise<NotificationRow[]> => {
  const now = new Date();
  const todayEnd = endOfDay(now, timezone);

  const tasks = await prisma.task.findMany({
    where: {
      organizationId: orgId,
      status: { not: 'DONE' },
      assigneeId: { not: null },
      dueDate: { not: null, lte: todayEnd },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assigneeId: true,
      project: { select: { id: true, name: true } },
    },
  });

  return tasks.map((t) => {
    const overdue = isBeforeToday(t.dueDate!, timezone, now);
    return {
      userId: t.assigneeId!,
      type: overdue ? 'TASK_OVERDUE' : 'TASK_DUE_TODAY',
      title: overdue ? `"${t.title}" is overdue` : `"${t.title}" is due today`,
      message: t.project
        ? `${t.title} on ${t.project.name} — due ${t.dueDate!.toISOString().slice(0, 10)}.`
        : `${t.title} — due ${t.dueDate!.toISOString().slice(0, 10)}.`,
      link: t.project ? `/projects/${t.project.id}` : `/tasks`,
      dedupeKey: `task-${overdue ? 'overdue' : 'due-today'}:${t.id}`,
    };
  });
};

// ─── The daily scan ──────────────────────────────────────────────────────────

/**
 * Run every signal for one organisation.
 *
 * Returns the total count of notifications written. Each signal is independent:
 * one failing does not stop the rest, so a broken query does not silence the
 * entire bell.
 */
export const runDailyScan = async (organizationId: string): Promise<{ written: number; errors: string[] }> => {
  const org = await getOrgConfig(organizationId);
  const tz = org.timezone;
  const errors: string[] = [];
  let totalWritten = 0;

  const signals: Array<{ name: string; fn: () => Promise<NotificationRow[]> }> = [
    { name: 'follow-ups', fn: () => scanFollowUps(organizationId, tz) },
    { name: 'rotting', fn: () => scanRottingDeals(organizationId, tz) },
    { name: 'quotes-no-reply', fn: () => scanQuotesAwaitingReply(organizationId) },
    { name: 'reviews-due', fn: () => scanReviewsDue(organizationId) },
    { name: 'expiring', fn: () => scanExpiringEngagements(organizationId) },
    { name: 'overdue-invoices', fn: () => scanOverdueInvoices(organizationId) },
    { name: 'billing-due', fn: () => scanBillingDue(organizationId, tz) },
    { name: 'tasks', fn: () => scanTasks(organizationId, tz) },
  ];

  for (const signal of signals) {
    try {
      const rows = await signal.fn();
      if (rows.length > 0) {
        const written = await upsertNotifications(rows);
        totalWritten += written;
        logger.info(`[scanner] ${signal.name}: ${written} notifications for org ${organizationId}`);
      }
    } catch (e) {
      const msg = `[scanner] ${signal.name} failed for org ${organizationId}: ${(e as Error).message}`;
      logger.error(msg);
      errors.push(msg);
    }
  }

  return { written: totalWritten, errors };
};

/**
 * Run the daily scan for ALL organisations.
 *
 * For a single-org install this is one call. When there are many, each runs
 * independently so one failing organisation does not silence another's bell.
 */
export const runDailyScanAll = async (): Promise<void> => {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  logger.info(`[scanner] Starting daily scan for ${orgs.length} organisation(s)`);

  for (const org of orgs) {
    const start = Date.now();
    const result = await runDailyScan(org.id);
    const elapsed = Date.now() - start;
    logger.info(
      `[scanner] Finished ${org.name}: ${result.written} notifications in ${elapsed}ms` +
        (result.errors.length > 0 ? `, ${result.errors.length} error(s)` : ''),
    );
  }
};

// ─── Event-driven notifications (not daily) ──────────────────────────────────

/**
 * Notify someone that a task was assigned to them.
 *
 * Called from the task-update route, not from the scanner. A notification that
 * waits until tomorrow to say "you have a new task" is a notification that
 * arrives after the standup where it mattered.
 */
export const notifyTaskAssigned = async (task: {
  id: string;
  title: string;
  assigneeId: string;
  projectId?: string | null;
  projectName?: string | null;
}): Promise<void> => {
  await upsertNotifications([
    {
      userId: task.assigneeId,
      type: 'TASK_ASSIGNED',
      title: `You've been assigned "${task.title}"`,
      message: task.projectName
        ? `${task.title} on ${task.projectName} has been assigned to you.`
        : `${task.title} has been assigned to you.`,
      link: task.projectId ? `/projects/${task.projectId}` : `/tasks`,
      dedupeKey: `task-assigned:${task.id}`,
    },
  ]);
};

/**
 * Notify a reviewer that a task is ready for their review.
 */
export const notifyTaskInReview = async (task: {
  id: string;
  title: string;
  reviewerId: string;
  projectId?: string | null;
  projectName?: string | null;
}): Promise<void> => {
  await upsertNotifications([
    {
      userId: task.reviewerId,
      type: 'TASK_IN_REVIEW',
      title: `"${task.title}" needs your review`,
      message: task.projectName
        ? `${task.title} on ${task.projectName} is waiting for your review.`
        : `${task.title} is waiting for your review.`,
      link: task.projectId ? `/projects/${task.projectId}` : `/tasks`,
      dedupeKey: `task-review:${task.id}`,
    },
  ]);
};
