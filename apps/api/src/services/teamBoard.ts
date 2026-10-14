import { Priority, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { TASK_PEOPLE } from './taskPeople.js';
import { withRepeatNext } from './taskRepeat.js';
import { FOCUS_STATUSES } from './taskFocus.js';
import { addDays, loadWorkCalendar, todayIn, weekdayOf, workingMinutesOn } from '../utils/workCalendar.js';
import { dayStartUtc } from '../utils/zonedTime.js';

/**
 * Team → Board (Team plan 1).
 *
 * One row per person: the task they said they are working on now, what is
 * next on their own list, and plain counts. Above it, a short "Needs
 * attention" list. That is all.
 *
 * Deliberately nothing else. No "overloaded" or "idle" label — those were
 * taken off the Team screen once already because they misled — no ranking,
 * and no timer: "Now" is what somebody said, not something watched, so no time
 * goes with it. People are in the departments' own order, then by name, never
 * by any of the numbers.
 *
 * The Team screen's route scopes the people (a Head sees the departments they
 * lead); Zen passes everybody. The work is every task any of them is on.
 */

/** What the board needs to know about each person. */
export const BOARD_PERSON_SELECT = {
  id: true,
  name: true,
  designation: true,
  departmentId: true,
  department: { select: { name: true } },
  focusTaskId: true,
} as const;

export type BoardPerson = {
  id: string;
  name: string;
  designation: string | null;
  departmentId: string | null;
  department: { name: string } | null;
  focusTaskId: string | null;
};

/** The counts on each row; each is a list of task ids, so a count opens the tasks behind it. */
export const BOARD_LISTS = ['open', 'dueThisWeek', 'overdue', 'waiting', 'inReview', 'doneThisWeek'] as const;
export type BoardList = (typeof BOARD_LISTS)[number];

/** Why a task is in "Needs attention", in the order the list is read. */
export const ATTENTION_REASONS = ['OVERDUE', 'WAITING_LONG', 'REVIEW_LONG', 'URGENT_NOT_STARTED'] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/** On hold longer than this many working days needs a look. */
export const WAITING_TOO_LONG_DAYS = 3;

const BOARD_TASK_INCLUDE = {
  monthCard: { select: { month: true, retainer: { select: { company: { select: { name: true } } } } } },
  project: { select: { name: true, company: { select: { name: true } } } },
  retainerProject: { select: { name: true } },
  internalProject: { select: { name: true } },
  company: { select: { name: true } },
  ...TASK_PEOPLE,
} as const;

const OPEN: string[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD];
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

type Orderable = { id: string; status: TaskStatus | string; dueDate: Date; createdAt: Date; sortOrder: number | null };

/**
 * A person's open tasks in the order their own My Work shows them.
 *
 * The same rules as GET /tasks/my: Overdue, then Due today, then the rest of
 * the week, then later — each group in the order they arranged it by dragging,
 * anything not yet arranged first, and otherwise by due date (newest first
 * among equals). Sent for approval, done and cancelled are not on the list.
 */
export function inMyWorkOrder<T extends Orderable>(tasks: T[], today: string, now: Date): T[] {
  const endOfWeek = now.getTime() + 7 * 24 * 3600 * 1000;
  const byDue = [...tasks].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
  );
  // Stable, so the unarranged keep their due-date order among themselves.
  const theirOrder = (list: T[]) =>
    [...list].sort((a, b) => {
      if (a.sortOrder == null && b.sortOrder == null) return 0;
      if (a.sortOrder == null) return -1;
      if (b.sortOrder == null) return 1;
      return a.sortOrder - b.sortOrder;
    });
  const open = byDue.filter((t) => OPEN.includes(t.status));
  const later = (t: T) => dayOf(t.dueDate) > today;
  return [
    ...theirOrder(open.filter((t) => dayOf(t.dueDate) < today)),
    ...theirOrder(open.filter((t) => dayOf(t.dueDate) === today)),
    ...theirOrder(open.filter((t) => later(t) && t.dueDate.getTime() <= endOfWeek)),
    ...theirOrder(open.filter((t) => later(t) && t.dueDate.getTime() > endOfWeek)),
  ];
}

/**
 * Next up: the first task in their My Work order they could pick up — not the
 * one they are on now, and not one on hold.
 */
export function nextUpOf<T extends Orderable>(tasks: T[], nowId: string | null, today: string, now: Date): T | null {
  return (
    inMyWorkOrder(tasks, today, now).find((t) => t.id !== nowId && FOCUS_STATUSES.includes(t.status as TaskStatus)) ??
    null
  );
}

export async function composeTeamBoard(orgId: string, people: BoardPerson[], now: Date = new Date()) {
  const [org, calendar] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true, approvalRemindMinutes: true } }),
    loadWorkCalendar(orgId),
  ]);
  const tz = org?.timezone || 'Asia/Kolkata';
  // The approval chaser's own reminder time, so "too long in review" here is
  // the moment the approvers were reminded there.
  const remindAfter = org?.approvalRemindMinutes ?? 120;
  const today = todayIn(tz, now);
  // Monday to Sunday, as the Monday brief counts a week.
  const weekStart = addDays(today, -((weekdayOf(today) + 6) % 7));
  const weekEnd = addDays(weekStart, 6);
  const dayMinutes = Math.max(1, calendar.endHour - calendar.startHour) * 60;

  const ids = people.map((p) => p.id);
  const tasks =
    ids.length === 0
      ? []
      : await prisma.task.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            assignees: { some: { userId: { in: ids } } },
            OR: [
              { status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD, TaskStatus.IN_REVIEW] } },
              // Finished since Monday, at the studio's midnight.
              { status: TaskStatus.DONE, completedAt: { gte: dayStartUtc(weekStart, tz) } },
            ],
          },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
          include: BOARD_TASK_INCLUDE,
        });

  // Each person's own order — off their assignee row, since three people on
  // one task each arrange their own desk.
  const places =
    tasks.length === 0
      ? []
      : await prisma.taskAssignee.findMany({
          where: { userId: { in: ids }, taskId: { in: tasks.map((t) => t.id) } },
          select: { userId: true, taskId: true, sortOrder: true },
        });
  const placeOf = new Map(places.map((p) => [`${p.userId}:${p.taskId}`, p.sortOrder]));

  const isOpen = (t: { status: string }) => OPEN.includes(t.status);
  const isOverdue = (t: { status: string; dueDate: Date }) => isOpen(t) && dayOf(t.dueDate) < today;

  const rows = people.map((p) => {
    const mine = tasks.filter((t) => t.assignees.some((a) => a.user.id === p.id));
    const open = mine.filter(isOpen);
    // Only while it can still be theirs to work on; anything else reads as nothing.
    const nowTask =
      (p.focusTaskId && mine.find((t) => t.id === p.focusTaskId && FOCUS_STATUSES.includes(t.status))) || null;
    const next = nextUpOf(
      mine.map((t) => ({ ...t, sortOrder: placeOf.get(`${p.id}:${t.id}`) ?? null })),
      nowTask?.id ?? null,
      today,
      now,
    );
    const idsOf = (list: typeof mine) => list.map((t) => t.id);
    const lists: Record<BoardList, string[]> = {
      open: idsOf(open),
      dueThisWeek: idsOf(open.filter((t) => dayOf(t.dueDate) >= today && dayOf(t.dueDate) <= weekEnd)),
      overdue: idsOf(open.filter(isOverdue)),
      waiting: idsOf(mine.filter((t) => t.status === TaskStatus.ON_HOLD)),
      inReview: idsOf(mine.filter((t) => t.status === TaskStatus.IN_REVIEW)),
      doneThisWeek: idsOf(mine.filter((t) => t.status === TaskStatus.DONE)),
    };
    return {
      id: p.id,
      name: p.name,
      designation: p.designation,
      departmentId: p.departmentId,
      department: p.department?.name ?? null,
      nowTaskId: nowTask?.id ?? null,
      nextUpTaskId: next?.id ?? null,
      lists,
    };
  });

  const attention = tasks
    .map((t) => {
      const reasons: AttentionReason[] = [];
      if (isOverdue(t)) reasons.push('OVERDUE');
      if (
        t.status === TaskStatus.ON_HOLD &&
        t.waitingSince &&
        workingMinutesOn(calendar, t.waitingSince, now).totalMinutes > WAITING_TOO_LONG_DAYS * dayMinutes
      ) {
        reasons.push('WAITING_LONG');
      }
      const round = t.reviews[0];
      if (
        t.status === TaskStatus.IN_REVIEW &&
        round &&
        !round.decision &&
        workingMinutesOn(calendar, round.submittedAt, now).totalMinutes > remindAfter
      ) {
        reasons.push('REVIEW_LONG');
      }
      if (t.priority === Priority.URGENT && t.status === TaskStatus.TODO) reasons.push('URGENT_NOT_STARTED');
      return { taskId: t.id, reasons, dueDate: t.dueDate };
    })
    .filter((a) => a.reasons.length > 0)
    // By the most pressing reason, then the longest late first.
    .sort(
      (a, b) =>
        ATTENTION_REASONS.indexOf(a.reasons[0]) - ATTENTION_REASONS.indexOf(b.reasons[0]) ||
        a.dueDate.getTime() - b.dueDate.getTime(),
    )
    .map(({ taskId, reasons }) => ({ taskId, reasons }));

  // Ready for the task drawer, in the field names every task list uses.
  const formatted = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    taskType: t.taskType,
    workType: t.workType,
    internalProjectId: t.internalProjectId,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    assignedAt: t.assignedAt,
    completedAt: t.completedAt,
    reopenCount: t.reopenCount,
    notes: t.notes,
    waitingOn: t.waitingOn,
    waitingSince: t.waitingSince,
    needsApproval: t.needsApproval,
    repeat: t.repeat,
    lastReview: t.reviews[0] ?? null,
    assignee: t.assignee,
    assignees: t.assignees.map((a) => a.user),
    assignedBy: t.assignedBy,
    creator: t.creator,
    reviewer: t.reviewer,
    clientName: t.monthCard?.retainer.company.name || t.project?.company.name || t.company?.name || 'Internal',
    projectName: t.project?.name ?? t.retainerProject?.name ?? t.internalProject?.name ?? null,
    monthCardMonth: t.monthCard?.month ?? null,
    overdue: isOverdue(t),
  }));
  const withNext = await withRepeatNext(orgId, formatted);

  return {
    today,
    week: { from: weekStart, to: weekEnd },
    people: rows,
    tasks: Object.fromEntries(withNext.map((t) => [t.id, t])),
    attention,
  };
}
