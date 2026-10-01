import { RepeatFrequency, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { loadWorkCalendar, todayIn, type WorkCalendar } from '../utils/workCalendar.js';
import { createFrom, dayOf, nextDueFor, type RepeatRule } from '../services/taskRepeat.js';
import { createTaskRecord } from '../services/taskCreate.js';

/**
 * Repeating tasks: the hourly job that makes each next copy.
 *
 * For every series that has not stopped:
 *
 *   1. The anchors. `source` is the latest task still in the series — the copy
 *      is made from it, so a renamed task renames the next. `lastDay` is the
 *      latest due date in the series counting deleted copies, so deleting a
 *      copy does not bring it back.
 *   2. Is the work over? A stopped retainer, a delivered or cancelled project,
 *      a retainer project or internal project marked done — the repeat stops,
 *      saying why. Copies already made are never touched.
 *   3. A daily task waits while its last copy is open: one at a time, no pile.
 *   4. The next date by the rule, off days off, never in the past.
 *   5. Time yet? Daily on the day; weekly and monthly three days ahead.
 *   6. A retainer copy goes on the month card of the month it is due, and
 *      waits for that card — they only appear on the 1st. None made early.
 *   7. Made the way a person makes one (services/taskCreate), with the people
 *      who are still here. Nobody left: the repeat stops.
 *
 * Safe to run twice: one copy per series per date is a unique index, and a
 * second insert is skipped.
 */

type Outcome = 'CREATED' | 'STOPPED' | 'WAITING' | null;

const stop = (id: string, reason: string, now: Date) =>
  prisma.taskRepeat.updateMany({ where: { id, stoppedAt: null }, data: { stoppedAt: now, stoppedReason: reason } });

export async function runTaskRepeats(now = new Date()): Promise<{ created: number; stopped: number; waiting: number }> {
  const counts = { created: 0, stopped: 0, waiting: 0 };
  const series = await prisma.taskRepeat.findMany({
    where: { stoppedAt: null },
    select: { id: true, organizationId: true, frequency: true, weekday: true, dayOfMonth: true },
  });

  const byOrg = new Map<string, typeof series>();
  for (const s of series) byOrg.set(s.organizationId, [...(byOrg.get(s.organizationId) ?? []), s]);

  for (const [orgId, list] of byOrg) {
    try {
      const [calendar, org] = await Promise.all([
        loadWorkCalendar(orgId),
        prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      ]);
      const today = todayIn(org?.timezone ?? 'Asia/Kolkata', now);
      for (const s of list) {
        try {
          const outcome = await repeatOne(s, calendar, today, now);
          if (outcome === 'CREATED') counts.created++;
          if (outcome === 'STOPPED') counts.stopped++;
          if (outcome === 'WAITING') counts.waiting++;
        } catch (err) {
          logger.error(`Task repeat ${s.id} failed: ${err}`);
        }
      }
    } catch (err) {
      logger.error(`Task repeats for org ${orgId} failed: ${err}`);
    }
  }
  return counts;
}

async function repeatOne(
  s: { id: string; organizationId: string } & RepeatRule,
  calendar: WorkCalendar,
  today: string,
  now: Date,
): Promise<Outcome> {
  // 1. The latest copy still standing — what the next is made from.
  const source = await prisma.task.findFirst({
    where: { repeatId: s.id, deletedAt: null },
    orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
    include: {
      assignees: { orderBy: { assignedAt: 'asc' }, select: { user: { select: { id: true, active: true } } } },
      assignedBy: { select: { id: true, active: true } },
      reviewer: { select: { id: true, active: true } },
      monthCard: { select: { retainerId: true, retainer: { select: { status: true } } } },
      project: { select: { status: true, deletedAt: true } },
      retainerProject: { select: { status: true } },
      internalProject: { select: { status: true } },
    },
  });
  if (!source) {
    await stop(s.id, 'No task left to copy', now);
    return 'STOPPED';
  }
  // Deleted copies count, so a deleted one is not made again.
  const last = await prisma.task.findFirst({
    where: { repeatId: s.id, deletedAt: undefined },
    orderBy: { dueDate: 'desc' },
    select: { dueDate: true },
  });
  const lastDay = dayOf(last?.dueDate ?? source.dueDate);

  // 2. The work it belongs to is over.
  const over =
    source.monthCard?.retainer.status === 'STOPPED'
      ? 'Retainer stopped'
      : source.projectId && (!source.project || source.project.deletedAt)
        ? 'Project removed'
        : source.project?.status === 'DELIVERED'
          ? 'Project delivered'
          : source.project?.status === 'CANCELLED'
            ? 'Project cancelled'
            : source.retainerProject?.status === 'DONE'
              ? 'Retainer project done'
              : source.internalProject?.status === 'DONE'
                ? 'Internal project done'
                : null;
  if (over) {
    await stop(s.id, over, now);
    return 'STOPPED';
  }

  // 3. Daily: one open copy at a time.
  const finished = source.status === TaskStatus.DONE || source.status === TaskStatus.CANCELLED;
  if (s.frequency === RepeatFrequency.DAILY && !finished) return null;

  // 4 – 5. The next date, and whether it is time to make it.
  const nextDue = nextDueFor(s, calendar, lastDay, today);
  if (!nextDue || today < createFrom(s, nextDue)) return null;

  // 6. A retainer copy waits for its month's card.
  let monthCardId: string | null = null;
  if (source.monthCardId && source.monthCard) {
    const card = await prisma.monthCard.findFirst({
      where: { retainerId: source.monthCard.retainerId, month: nextDue.slice(0, 7) },
      select: { id: true },
    });
    if (!card) return 'WAITING';
    monthCardId = card.id;
  }

  // 7. The people still here.
  const people = source.assignees.filter((a) => a.user.active).map((a) => a.user.id);
  if (people.length === 0) {
    await stop(s.id, 'Nobody active to assign', now);
    return 'STOPPED';
  }

  try {
    await createTaskRecord(prisma, {
      orgId: s.organizationId,
      createdById: source.createdById,
      actorId: null,
      verb: 'task_repeated',
      repeatId: s.id,
      title: source.title,
      workType: source.workType,
      workId: source.workType === 'MONTH_CARD' ? monthCardId : source.workId,
      monthCardId,
      projectId: source.projectId,
      retainerProjectId: source.retainerProjectId,
      internalProjectId: source.internalProjectId,
      companyId: source.companyId,
      people,
      assignedById: source.assignedBy?.active ? source.assignedById : null,
      reviewerId: source.reviewer?.active ? source.reviewerId : null,
      taskType: source.taskType,
      needsApproval: source.needsApproval,
      dueDate: new Date(`${nextDue}T00:00:00Z`),
      dueTime: source.dueTime,
      priority: source.priority,
      notes: source.notes,
    });
  } catch (err) {
    // Another run made this date already — the unique index said so.
    if ((err as { code?: string }).code === 'P2002') return null;
    throw err;
  }
  return 'CREATED';
}

/** Hourly: a copy appears within the hour of the day it is due to. */
export function startTaskRepeatScheduler(intervalMs = 60 * 60 * 1000) {
  if (process.env.NODE_ENV !== 'test') {
    runTaskRepeats().catch((e) => logger.error(`Initial task repeat error: ${e}`));
    setInterval(() => {
      runTaskRepeats().catch((e) => logger.error(`Periodic task repeat error: ${e}`));
    }, intervalMs);
  }
}
