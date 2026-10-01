import { TASK_PEOPLE } from '../services/taskPeople.js';
import { createTaskRecord } from '../services/taskCreate.js';
import { dayOf, ruleFromDueDate, withRepeatNext } from '../services/taskRepeat.js';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, hasPermission, type AuthRequest } from '../middleware/auth.js';
import { loadWorkCalendar, workingMinutesOn } from '../utils/workCalendar.js';
import { computeTaskTypeMedians, taskTypeGroupKey } from '../utils/taskTypeMedian.js';
import { defaultProjectId } from '../services/retainerProjects.js';
import { TaskStatus, TaskWorkType, WaitingOn, Priority, TaskType, ReviewDecision, RepeatFrequency } from '@prisma/client';
import {
  approvalFlagRefusal,
  approvalType,
  approveRefusal,
  addChangesRefusal,
  approverFor,
  approverIds,
  elapsedEnd,
  escalateFor,
  escalationNamesByType,
  TASK_TYPE_LABEL,
  type LastReview,
} from '../services/taskApprovals.js';
import { CHASER_RULES } from '../workers/approvalChaser.cron.js';

/**
 * "Escalated to Akmal" — the escalation people's names on each escalated
 * round, for the editor's side of a task list. One query for the whole list.
 */
async function withEscalatedTo<T extends { taskType: TaskType | null; lastReview: LastReview | null }>(
  orgId: string,
  rows: T[],
): Promise<(T & { lastReview: (LastReview & { escalatedTo: { id: string; name: string }[] }) | null })[]> {
  const escalatedTypes = rows.filter((r) => r.lastReview?.escalatedAt).map((r) => r.taskType);
  const names = await escalationNamesByType(orgId, escalatedTypes);
  return rows.map((r) => ({
    ...r,
    lastReview: r.lastReview
      ? {
          ...r.lastReview,
          escalatedTo: r.lastReview.escalatedAt && r.taskType ? (names.get(r.taskType) ?? []) : [],
        }
      : null,
  }));
}

// Same 540-min-per-working-day math as calculateWorkingMinutes, just applied
// to a raw minute count (a median) instead of a from/to timestamp pair.
function formatWorkingMinutes(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / 540);
  const hours = Math.floor((totalMinutes % 540) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ''}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  return `${minutes}m`;
}
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';

export const tasksRouter = Router();

export { TASK_PEOPLE } from '../services/taskPeople.js';

/**
 * Flattens the join rows, so the wire carries people rather than link records.
 *
 * `Omit` in the return type is load-bearing: a plain spread keeps the source's
 * `assignees` type, so the flattened array still looked like `{ user }[]` to
 * every caller and the CSV column reading `a.name` failed to compile.
 */
export type TaskPerson = { id: string; name: string; designation: string | null; dept?: string };

export function withPeople<T extends { assignees: { user: TaskPerson }[]; reviews?: LastReview[] }>(task: T) {
  const { reviews, ...rest } = task;
  return { ...rest, assignees: task.assignees.map((a) => a.user), lastReview: reviews?.[0] ?? null } as Omit<
    T,
    'assignees' | 'reviews'
  > & {
    assignees: TaskPerson[];
    lastReview: LastReview | null;
  };
}



tasksRouter.use(authenticate);

// ── 1. Personal Daily Cockpit Tasks (/api/tasks/my) ─────────────────────────

tasksRouter.get('/my', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;

    const allMyTasks = await prisma.task.findMany({
      where: {
        organizationId: orgId,
        // Every task this person is on, not only the ones they lead. Three
        // people sharing a task are three people who have to do something
        // about it, and My Work showing it to one of them is how the other two
        // find out too late.
        assignees: { some: { userId } },
        deletedAt: null,
        // Cancelled work isn't "done", but it doesn't belong in any of this
        // screen's buckets either — it's not pending and it wasn't finished.
        status: { not: TaskStatus.CANCELLED },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        monthCard: {
          include: { retainer: { include: { company: true } } },
        },
        project: {
          include: { company: true },
        },
        // An internal task has no client to be labelled by, so without this
        // every one of them reads as nothing at all on this screen.
        internalProject: { select: { id: true, name: true } },
        // A follow-up hangs off the client directly — no project, no month —
        // and read as "Internal" until this was included.
        company: { select: { name: true } },
        ...TASK_PEOPLE,
      },
    });

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const endOfWeek = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    // Brief §8/§11.4: "Elapsed is shown against the median for that task
    // type" — same grouping the TASK_AGING alert rule uses, computed once
    // for every task type these buckets touch.
    const medianByGroup = await computeTaskTypeMedians(orgId);
    const calendar = await loadWorkCalendar(orgId);

    const formattedTasks = allMyTasks.map((t) => {
      const clientName =
        t.monthCard?.retainer.company.name || t.project?.company.name || t.company?.name || 'Internal';
      const lastReview = t.reviews[0] ?? null;
      // In review, the clock stops at the moment it was sent — an approver's
      // time is not this person's.
      const workingHours = workingMinutesOn(calendar, t.assignedAt, elapsedEnd(t, lastReview, now), t.waitingTotalMinutes);
      const typeMedianMinutes = medianByGroup.get(taskTypeGroupKey(t)) ?? null;

      /*
       * Waiting on an approver is its own group, below the active work.
       *
       * It is still open, but it is not this person's to move, and a video late
       * only because nobody has approved it is not their overdue.
       */
      const isInReview = t.status === 'IN_REVIEW';
      const dueStr = new Date(t.dueDate).toISOString().slice(0, 10);
      const isOverdue = !isInReview && t.status !== 'DONE' && dueStr < todayStr;
      const isToday = !isInReview && t.status !== 'DONE' && dueStr === todayStr;
      const isThisWeek = !isInReview && t.status !== 'DONE' && !isOverdue && !isToday && new Date(t.dueDate) <= endOfWeek;
      const isDone = t.status === 'DONE';
      // Anything open and due beyond the 7-day window still needs a bucket —
      // a retainer's template tasks are created a month out, and a task that
      // fits none of overdue/today/thisWeek/done was silently disappearing
      // from the one screen ~25 people rely on to see their work.
      const isLater = !isInReview && !isOverdue && !isToday && !isThisWeek && !isDone;

      return {
        id: t.id,
        title: t.title,
        workType: t.workType,
        workId: t.workId,
        status: t.status,
        priority: t.priority,
        waitingOn: t.waitingOn,
        waitingSince: t.waitingSince,
        waitingTotalMinutes: t.waitingTotalMinutes,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        assignedAt: t.assignedAt,
        completedAt: t.completedAt,
        reopenCount: t.reopenCount,
        notes: t.notes,
        /*
         * The people, and the piece of work.
         *
         * `TASK_PEOPLE` has been in this query's include since multi-assignee
         * landed, and every one of those rows was dropped on the floor right
         * here — the screen asked the database for who else is on a task and
         * who handed it over, and then returned none of it. So the one screen
         * ~25 people open every day was the only place a task could not say.
         *
         * Same field names as every other task endpoint, so the shared drawer
         * reads this without a translation layer.
         */
        taskType: t.taskType,
        assignee: t.assignee,
        assignees: t.assignees.map((a) => a.user),
        assignedBy: t.assignedBy,
        creator: t.creator,
        reviewer: t.reviewer,
        clientName,
        // Which job it hangs off. A month card's task never has a project and
        // a project's task never has a month card, so exactly one of these is
        // ever set. Formatted on the web, the way the retainer screen already
        // does it — "2026-09" is a key, not a label.
        monthCardMonth: t.monthCard?.month ?? null,
        projectName: t.project?.name ?? t.internalProject?.name ?? null,
        // The drawer reads this to show what the task is already filed under.
        // Without it, opening a filed task would show "Not part of anything"
        // and saving would clear it. (workType is already above.)
        internalProjectId: t.internalProjectId,
        internalProjectName: t.internalProject?.name ?? null,
        workingHoursText: workingHours.formatted,
        workingMinutes: workingHours.totalMinutes,
        typeMedianMinutes,
        typeMedianText: typeMedianMinutes != null ? formatWorkingMinutes(typeMedianMinutes) : null,
        needsApproval: t.needsApproval,
        // The repeat, if it is a copy in one; `nextDue` is added below.
        repeat: t.repeat,
        lastReview,
        // How long the waiting round has waited, in working time — what
        // "No answer for 2h 10m" reads on the editor's row.
        reviewWaitingText:
          isInReview && lastReview && lastReview.decision == null
            ? formatWorkingMinutes(workingMinutesOn(calendar, lastReview.submittedAt, now).totalMinutes)
            : null,
        isOverdue,
        isToday,
        isThisWeek,
        isLater,
        isInReview,
        isDone,
      };
    });

    /*
     * The order this person has arranged their own desk into.
     *
     * Read off their own assignee rows — not the task, since three people on
     * one task each have their own order. A separate query because Prisma
     * cannot include the same relation twice, and TASK_PEOPLE already takes
     * `assignees` for the list of names.
     */
    const places = await prisma.taskAssignee.findMany({
      where: { userId, taskId: { in: allMyTasks.map((t) => t.id) } },
      select: { taskId: true, sortOrder: true },
    });
    const placeOf = new Map(places.map((p) => [p.taskId, p.sortOrder]));
    const placed = (await withRepeatNext(orgId, await withEscalatedTo(orgId, formattedTasks))).map((t) => ({
      ...t,
      sortOrder: placeOf.get(t.id) ?? null,
    }));

    /*
     * Arranged tasks in the order given; anything not yet arranged FIRST.
     *
     * First, not last: a task that arrives after somebody has put their day in
     * order is new work, and filing it under the list they already arranged is
     * how it goes unseen until it is late. Among themselves the unarranged
     * keep the query's order — due date, then newest — because the sort is
     * stable and they compare equal.
     */
    const inTheirOrder = <T extends { sortOrder: number | null }>(list: T[]): T[] =>
      [...list].sort((a, b) => {
        if (a.sortOrder == null && b.sortOrder == null) return 0;
        if (a.sortOrder == null) return -1;
        if (b.sortOrder == null) return 1;
        return a.sortOrder - b.sortOrder;
      });

    const today = inTheirOrder(placed.filter((t) => t.isToday));
    const overdue = inTheirOrder(placed.filter((t) => t.isOverdue));
    const thisWeek = inTheirOrder(placed.filter((t) => t.isThisWeek));
    const later = inTheirOrder(placed.filter((t) => t.isLater));
    // Waiting on an approver, longest-waiting first.
    const inReview = placed
      .filter((t) => t.isInReview)
      .sort((a, b) => (a.lastReview?.submittedAt?.getTime() ?? 0) - (b.lastReview?.submittedAt?.getTime() ?? 0));
    // History, not a plan — it stays in the order it was finished.
    const completed = placed.filter((t) => t.isDone);

    res.json({
      success: true,
      counts: {
        today: today.length,
        overdue: overdue.length,
        thisWeek: thisWeek.length,
        later: later.length,
        inReview: inReview.length,
        completed: completed.length,
      },
      tasks: {
        today,
        overdue,
        thisWeek,
        later,
        inReview,
        completed,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── 1b. Waiting for my approval (/api/tasks/approvals) ──────────────────────
//
// The approver's side of My Work: every task sent for approval in a type this
// person approves, oldest first — the one that has waited longest is the one
// somebody is chasing on WhatsApp. Their own work is left out, because nobody
// approves that. Empty rather than refused for everybody else, so My Work can
// ask without knowing who is looking.

/** Where a task sits, for the approval screens: its client, and its piece of work. */
const TASK_PLACE = {
  monthCard: { select: { month: true, retainer: { select: { company: { select: { name: true } } } } } },
  project: { select: { name: true, company: { select: { name: true } } } },
  company: { select: { name: true } },
  internalProject: { select: { name: true } },
  retainerProject: { select: { name: true } },
} as const;

function placeOf(t: {
  monthCard: { retainer: { company: { name: string } } } | null;
  project: { name: string; company: { name: string } } | null;
  company: { name: string } | null;
  internalProject: { name: string } | null;
  retainerProject: { name: string } | null;
}) {
  return {
    clientName: t.monthCard?.retainer.company.name || t.project?.company.name || t.company?.name || 'Internal',
    projectName: t.project?.name ?? t.retainerProject?.name ?? t.internalProject?.name ?? null,
  };
}

/** Who sent a round, and who decided it. */
const REVIEW_PEOPLE = {
  submittedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  // Changes the other approvers added after it was sent back.
  notes: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, feedback: true, createdAt: true, author: { select: { id: true, name: true } } },
  },
} as const;

/** How long a sent-back task stays in the other approvers' "add your changes" list. */
const SENT_BACK_DAYS = 7;

tasksRouter.get('/approvals', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const me = req.user!.userId;

    const [types, escalationTypes] = await Promise.all([approverFor(orgId, me), escalateFor(orgId, me)]);
    if (types.length === 0 && escalationTypes.length === 0) {
      res.json({ success: true, items: [], sentBack: [] });
      return;
    }

    /*
     * Sent back, and still with the editor — where the other approvers add
     * their changes. One approver is enough to approve, but a request for
     * changes should not be the last word of the first person to open it. For
     * a week after it was sent back, or until the editor sends it again.
     */
    const since = new Date(Date.now() - SENT_BACK_DAYS * 24 * 60 * 60 * 1000);
    const sentBackTasks = await prisma.task.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        needsApproval: true,
        status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD] },
        taskType: { in: [...new Set([...types, ...escalationTypes])] },
        NOT: { assignees: { some: { userId: me } } },
        reviews: { some: { decision: ReviewDecision.CHANGES_REQUESTED, decidedAt: { gte: since } } },
      },
      include: {
        ...TASK_PLACE,
        ...TASK_PEOPLE,
        reviews: { orderBy: { round: 'desc' }, take: 1, include: REVIEW_PEOPLE },
      },
    });
    const sentBack = sentBackTasks
      .filter((t) => t.reviews[0]?.decision === ReviewDecision.CHANGES_REQUESTED)
      .map((t) => {
        const r = t.reviews[0];
        return {
          id: t.id,
          title: t.title,
          taskType: t.taskType,
          taskTypeLabel: t.taskType ? TASK_TYPE_LABEL[t.taskType] : null,
          ...placeOf(t),
          assignees: t.assignees.map((a) => a.user),
          review: {
            id: r.id,
            round: r.round,
            link: r.link,
            decidedBy: r.decidedBy,
            decidedAt: r.decidedAt,
            feedback: r.feedback,
            notes: r.notes,
          },
        };
      })
      .sort((a, b) => (b.review.decidedAt?.getTime() ?? 0) - (a.review.decidedAt?.getTime() ?? 0));

    const tasks = await prisma.task.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: TaskStatus.IN_REVIEW,
        NOT: { assignees: { some: { userId: me } } },
        OR: [
          // Theirs to approve.
          ...(types.length > 0 ? [{ taskType: { in: types } }] : []),
          // Escalated to them — only once the waiting round has escalated.
          ...(escalationTypes.length > 0
            ? [
                {
                  taskType: { in: escalationTypes },
                  reviews: { some: { decision: null, escalatedAt: { not: null } } },
                },
              ]
            : []),
        ],
      },
      include: {
        ...TASK_PLACE,
        ...TASK_PEOPLE,
        // The round that is waiting, not the last one decided.
        reviews: { where: { decision: null }, orderBy: { round: 'desc' }, take: 1, include: REVIEW_PEOPLE },
      },
    });

    const calendar = await loadWorkCalendar(orgId);
    const now = new Date();
    const items = tasks
      .filter((t) => t.reviews.length > 0)
      .map((t) => {
        const r = t.reviews[0];
        // Working time, the same clock every other elapsed figure reads.
        const waitingMinutes = workingMinutesOn(calendar, r.submittedAt, now).totalMinutes;
        return {
          id: t.id,
          title: t.title,
          taskType: t.taskType,
          taskTypeLabel: t.taskType ? TASK_TYPE_LABEL[t.taskType] : null,
          priority: t.priority,
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          ...placeOf(t),
          assignees: t.assignees.map((a) => a.user),
          creator: t.creator,
          review: {
            id: r.id,
            round: r.round,
            link: r.link,
            note: r.note,
            submittedAt: r.submittedAt,
            submittedBy: r.submittedBy,
            remindedAt: r.remindedAt,
            escalatedAt: r.escalatedAt,
          },
          // Here because it escalated to them, not because they approve the type.
          asEscalation: !(t.taskType && types.includes(t.taskType)),
          waitingMinutes,
          waitingText: formatWorkingMinutes(waitingMinutes),
        };
      })
      .sort((a, b) => a.review.submittedAt.getTime() - b.review.submittedAt.getTime());

    res.json({ success: true, items, sentBack });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/tasks/my/order — the order of one group on the caller's own desk.
 *
 * Sent as the whole group, top to bottom, after a drag. The whole group rather
 * than "move X above Y" because that is what the screen holds, and replaying
 * a single move against a list that changed underneath it is how two orders
 * end up disagreeing.
 *
 * It only ever writes the caller's OWN assignee rows. A task somebody shares
 * with two colleagues is theirs to place on their desk and theirs alone — and
 * an id that is not on this person's desk is refused rather than skipped, so
 * a stale screen cannot quietly half-apply.
 */
const orderSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, 'Nothing to arrange').max(500, 'Too many tasks at once'),
});

tasksRouter.put('/my/order', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const userId = req.user!.userId;
    const ids = [...new Set(parsed.data.taskIds)];

    const mine = await prisma.taskAssignee.findMany({
      where: { userId, taskId: { in: ids }, task: { organizationId: req.user!.organizationId } },
      select: { taskId: true },
    });
    if (mine.length !== ids.length) {
      res.status(400).json({
        success: false,
        error: 'Some of those tasks are no longer on your list. Refresh and arrange them again.',
      });
      return;
    }

    await prisma.$transaction(
      ids.map((taskId, index) =>
        prisma.taskAssignee.update({
          where: { taskId_userId: { taskId, userId } },
          data: { sortOrder: index },
        }),
      ),
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── Everything, for the people who run the work ─────────────────────────────
//
// `/my` answers "what am I doing", and every screen after it answers "what is
// happening on this one job". Neither answers the question a head of department
// or the management actually asks: what is the whole team carrying right now,
// who is behind, and what is stuck waiting on somebody else.
//
// It was reachable only by opening fourteen people's drawers one at a time, or
// by asking. `work.all` is exactly the right gate — it is what Head and
// Management hold and nobody else does, and it is the same switch that lets
// them open Live work and a project.

/**
 * GET /api/tasks/targets — everything a task form has to offer.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * The task forms built their pickers out of three endpoints: `/companies` and
 * `/companies/:id`, both gated on `company.read`, and `/internal-projects`,
 * gated on `work.all`. Nobody but Management holds all three — an EMPLOYEE
 * holds `work.own` and nothing else, a HEAD has no `company.read`, BD and
 * ACCOUNTS have no `work.all` — so on My Work everybody except Management met
 * an empty Company list, an empty job list, or both, and could not write down
 * a task at all.
 *
 * The permissions were not wrong. `company.read` opens the client book —
 * owners, statuses, verticals, the pipeline behind it — and that is a
 * commercial view an employee has no business in. What a task form needs is
 * far smaller: the NAMES of things work can be filed against. So that is all
 * this returns — ids and labels, no values, no owners, no statuses, nothing
 * that could be totalled — and it is gated on `work.own`, because anybody who
 * can hold a task can write one down.
 *
 * It is also one request where there were N+1: the forms used to fetch the
 * company list, then fetch a whole company detail payload again every time the
 * picker changed.
 */
tasksRouter.get('/targets', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const thisMonth = new Date().toISOString().slice(0, 7);

    const [companies, internalProjects] = await Promise.all([
      prisma.company.findMany({
        // Somewhere work can actually be filed: a prospect has nothing to do
        // for yet, and the server would refuse the task anyway.
        where: {
          organizationId: orgId,
          OR: [
            { retainers: { some: { status: 'ACTIVE' } } },
            { projects: { some: { status: 'LIVE', deletedAt: null } } },
          ],
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          retainers: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              // The month being worked. A retainer task must sit on the month
              // that pays for it, so a retainer with no open card has nothing
              // to offer yet.
              monthCards: { where: { month: thisMonth }, select: { id: true, month: true } },
              projects: {
                where: { status: 'ACTIVE' },
                orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
                select: { id: true, name: true },
              },
            },
          },
          projects: {
            where: { status: 'LIVE', deletedAt: null },
            orderBy: { name: 'asc' },
            // Sample work is offered too — it is where real effort and real
            // cost go, and tasks are how that gets recorded. It is labelled,
            // so nobody files billable work against something unbilled.
            select: { id: true, name: true, isSample: true },
          },
        },
      }),
      prisma.internalProject.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        orderBy: [{ name: 'asc' }],
        select: { id: true, name: true },
      }),
    ]);

    /*
     * The jobs, already flattened the way the picker shows them.
     *
     * A retainer contributes one option per piece of work inside it, not one
     * for the retainer: "Retainer — 2026-09" is a month, and a month is not a
     * job. The month rides along on the option so the task still lands on the
     * card that bills it.
     */
    const shaped = companies
      .map((c) => {
        const jobs: Record<string, unknown>[] = [];

        for (const r of c.retainers) {
          const card = r.monthCards[0];
          if (!card) continue;
          if (r.projects.length === 0) {
            jobs.push({
              key: card.id,
              label: `Retainer — ${card.month}`,
              workType: 'RETAINER',
              monthCardId: card.id,
              month: card.month,
            });
            continue;
          }
          for (const rp of r.projects) {
            jobs.push({
              key: rp.id,
              label: `Retainer — ${rp.name}`,
              workType: 'RETAINER',
              monthCardId: card.id,
              retainerProjectId: rp.id,
              month: card.month,
            });
          }
        }

        for (const pr of c.projects) {
          jobs.push({
            key: pr.id,
            label: pr.isSample ? `Sample — ${pr.name}` : `Project — ${pr.name}`,
            workType: 'PROJECT',
            projectId: pr.id,
          });
        }

        return { id: c.id, name: c.name, jobs };
      })
      // A client whose only retainer has no open month yet would otherwise sit
      // in the list offering nothing.
      .filter((c) => c.jobs.length > 0);

    res.json({ success: true, companies: shaped, internalProjects });
  } catch (error) {
    next(error);
  }
});

/**
 * The columns All tasks can be sorted by, and the order statuses sort in: the
 * order work moves through, not the alphabet.
 */
const ALL_SORTS = ['assigned', 'task', 'for', 'who', 'due', 'status', 'elapsed'] as const;
type AllSort = (typeof ALL_SORTS)[number];
const STATUS_SORT_ORDER: string[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.IN_REVIEW,
  TaskStatus.ON_HOLD,
  TaskStatus.DONE,
  TaskStatus.CANCELLED,
];

tasksRouter.get('/all', requirePermission('work.all'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { assigneeId, dept, status, overdue, q, companyId, project } = req.query;
    const wantsCsv = req.query.format === 'csv';
    /*
     * Which column the list is sorted by — due date, oldest first, unless a
     * header was clicked. Sorted here rather than in the browser because the
     * list is capped: the database has to hand back the RIGHT 500, and the CSV
     * has to come out in the order on screen.
     */
    const sortBy: AllSort = ALL_SORTS.includes(req.query.sort as AllSort) ? (req.query.sort as AllSort) : 'due';
    const sortDir: 'asc' | 'desc' = req.query.dir === 'desc' ? 'desc' : 'asc';

    /*
     * Filters that stack rather than overwrite each other.
     *
     * Person and department both narrow by who is ON the task, so writing both
     * onto `where.assignees` would silently drop the first — an AND array is
     * the only shape that means "both".
     */
    /*
     * Each filter takes a list, comma separated.
     *
     * One value each was the wrong shape for the question: "how are Design and
     * Content doing this week" and "what are these two carrying between them"
     * are the normal asks, and a single-value filter makes somebody run the
     * screen twice and add up in their head.
     */
    const list = (v: unknown): string[] =>
      typeof v === 'string' && v.trim()
        ? v.split(',').map((x) => x.trim()).filter(Boolean)
        : [];

    const and: any[] = [];
    const people = list(assigneeId);
    const depts = list(dept);
    if (people.length > 0) and.push({ assignees: { some: { userId: { in: people } } } });
    if (depts.length > 0) and.push({ assignees: { some: { user: { dept: { in: depts } } } } });
    if (typeof q === 'string' && q.trim()) and.push({ title: { contains: q.trim(), mode: 'insensitive' } });
    /*
     * Clients, with `INTERNAL` among them.
     *
     * Work with no project and no month card is the studio's own — the showreel,
     * the website, the thing nobody is billed for — and it is labelled Internal
     * everywhere it is shown. It is the one "client" that is not a row in the
     * companies table, so it is a value in this filter rather than a separate
     * switch: "Internal and Carlton Wellness" is one question, and two controls
     * would make it two.
     */
    const clients = list(companyId);
    if (clients.length > 0) {
      const named = clients.filter((c) => c !== 'INTERNAL');
      const or: any[] = [];
      if (named.length > 0) {
        or.push({ project: { companyId: { in: named } } });
        or.push({ monthCard: { retainer: { companyId: { in: named } } } });
        // A follow-up belongs to its client without a project or a month.
        or.push({ companyId: { in: named } });
      }
      if (clients.includes('INTERNAL')) {
        or.push({ AND: [{ projectId: null }, { monthCardId: null }, { companyId: null }] });
      }
      and.push({ OR: or });
    }

    /*
     * Projects, of all three kinds, in one list.
     *
     * A task sits in a one-off project, in a project inside a retainer, or in
     * an internal project — three columns — and "the website redo and the
     * Carlton reels" is one question whichever kinds they are. Each value says
     * which column it is: `P:` a project, `RP:` a retainer's project, `IP:` an
     * internal one.
     */
    const projects = list(project);
    if (projects.length > 0) {
      const of = (prefix: string) =>
        projects.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length)).filter(Boolean);
      const or: any[] = [];
      if (of('P:').length) or.push({ projectId: { in: of('P:') } });
      if (of('RP:').length) or.push({ retainerProjectId: { in: of('RP:') } });
      if (of('IP:').length) or.push({ internalProjectId: { in: of('IP:') } });
      // Nothing recognisable asked for: match nothing, rather than everything.
      and.push(or.length > 0 ? { OR: or } : { id: { in: [] } });
    }

    /*
     * `UNFINISHED` is not a status, it is the question.
     *
     * Sorted by due date and including everything, the screen opened on work
     * delivered in June — true, and not what somebody running a team came to
     * find out. "Not done and not cancelled" spans three statuses, so it cannot
     * be a value in the column, and asking the browser to filter it would make
     * the counts describe a different list than the one on screen.
     */
    /*
     * `UNFINISHED` stands for the three statuses that mean "still owed", so it
     * expands rather than filtering on a column — and it can be picked
     * alongside, say, Done, which is how "everything except cancelled" is
     * asked for.
     */
    const statuses = list(status).flatMap((v) =>
      // In review is still owed — just not by its assignee.
      v === 'UNFINISHED'
        ? [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.ON_HOLD]
        : [v as TaskStatus],
    );
    const statusWhere = statuses.length > 0 ? { status: { in: Array.from(new Set(statuses)) } } : {};

    const where: any = {
      organizationId: orgId,
      deletedAt: null,
      ...statusWhere,
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const tasks = await prisma.task.findMany({
      where,
      // Oldest due first: the point of the screen is what is late, and a list
      // that opens on next month's work buries it. A column the database holds
      // is sorted by it here, so the cap keeps the right rows; the worked-out
      // ones (client, person, status order, elapsed) are sorted below.
      orderBy:
        sortBy === 'assigned'
          ? [{ assignedAt: sortDir }, { dueDate: 'asc' }]
          : sortBy === 'task'
            ? [{ title: sortDir }, { dueDate: 'asc' }]
            : [{ dueDate: sortBy === 'due' ? sortDir : 'asc' }, { createdAt: 'desc' }],
      take: wantsCsv ? 5000 : 500,
      include: {
        monthCard: { include: { retainer: { include: { company: true } } } },
        project: { include: { company: true } },
        /*
         * A retainer task's project.
         *
         * `projectId` is the one-off kind; a task inside a retainer month
         * carries `retainerProjectId` alongside its month card instead. Reading
         * only the first left every retainer row labelled "2026-09", which is
         * the month it is billed in, not the work it is.
         */
        retainerProject: { select: { id: true, name: true } },
        /*
         * And the internal kind. An internal task has no client to be labelled
         * by, so without this every one of them read as "Internal" and nothing
         * else — the studio's website refresh and a hiring round looked like
         * the same row.
         */
        internalProject: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
        ...TASK_PEOPLE,
      },
    });

    const calendar = await loadWorkCalendar(orgId);
    const now = new Date();
    /*
     * The calendar day, not the UTC one.
     *
     * `toISOString().slice(0, 10)` is yesterday until half past five each
     * morning in IST, which would mark a day's work overdue before anybody
     * started it. Same fix as zenDraft.ts.
     */
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const formatted = tasks.map((t) => {
      const due = new Date(t.dueDate);
      const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
      const settled = t.status === TaskStatus.DONE || t.status === TaskStatus.CANCELLED;
      const lastReview = t.reviews[0] ?? null;
      // Waiting on an approver is not the assignee's overdue, and its clock
      // stops at the moment it was sent.
      const notTheirs = settled || t.status === TaskStatus.IN_REVIEW;
      const workingHours = workingMinutesOn(calendar, t.assignedAt, elapsedEnd(t, lastReview, now), t.waitingTotalMinutes);

      return {
        id: t.id,
        title: t.title,
        workType: t.workType,
        workId: t.workId,
        status: t.status,
        priority: t.priority,
        taskType: t.taskType,
        waitingOn: t.waitingOn,
        waitingSince: t.waitingSince,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
        assignedAt: t.assignedAt,
        completedAt: t.completedAt,
        reopenCount: t.reopenCount,
        notes: t.notes,
        assignee: t.assignee,
        assignees: t.assignees.map((a) => a.user),
        assignedBy: t.assignedBy,
        creator: t.creator,
        reviewer: t.reviewer,
        // What it is for, in the words the rest of the app uses.
        clientName: t.monthCard?.retainer.company.name || t.project?.company.name || t.company?.name || 'Internal',
        companyId: t.monthCard?.retainer.companyId || t.project?.companyId || t.companyId || null,
        projectId: t.projectId,
        // Whichever kind of project it is — a one-off, or a stream of work
        // inside a retainer.
        projectName: t.project?.name ?? t.retainerProject?.name ?? t.internalProject?.name ?? null,
        retainerProjectId: t.retainerProjectId,
        internalProjectId: t.internalProjectId,
        internalProjectName: t.internalProject?.name ?? null,
        monthCardMonth: t.monthCard?.month ?? null,
        retainerId: t.monthCard?.retainerId ?? null,
        workingHoursText: workingHours.formatted,
        workingMinutes: workingHours.totalMinutes,
        needsApproval: t.needsApproval,
        // The repeat, if it is a copy in one; `nextDue` is added below.
        repeat: t.repeat,
        lastReview,
        isOverdue: !notTheirs && dueStr < today,
        isToday: !notTheirs && dueStr === today,
      };
    });

    // Applied after formatting, because "overdue" is a question about the
    // calendar and the status together rather than a column to filter on.
    const withEscalation = await withRepeatNext(orgId, await withEscalatedTo(orgId, formatted));
    const filteredRows = overdue === '1' || overdue === 'true' ? withEscalation.filter((t) => t.isOverdue) : withEscalation;

    // The clicked column, then due date and title so equal rows keep a steady
    // order. Blanks (nobody on it, never assigned) go last either way.
    const sortValue = (t: (typeof filteredRows)[number]): string | number | null => {
      switch (sortBy) {
        case 'assigned':
          return t.assignedAt ? new Date(t.assignedAt).getTime() : null;
        case 'task':
          return t.title.toLowerCase();
        case 'for':
          return `${t.clientName} ${t.projectName ?? ''}`.toLowerCase();
        case 'who':
          return t.assignees[0]?.name.toLowerCase() ?? null;
        case 'status':
          return STATUS_SORT_ORDER.indexOf(t.status);
        case 'elapsed':
          return t.workingMinutes;
        default:
          return new Date(t.dueDate).getTime();
      }
    };
    const sign = sortDir === 'desc' ? -1 : 1;
    const rows = [...filteredRows].sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (va !== vb) {
        if (va == null) return 1;
        if (vb == null) return -1;
        const byColumn = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number);
        if (byColumn !== 0) return byColumn * sign;
      }
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() || a.title.localeCompare(b.title);
    });

    if (wantsCsv) {
      const csv = toCsv(rows, [
        { label: 'Task', value: (t) => t.title },
        { label: 'For', value: (t) => t.clientName },
        { label: 'Project', value: (t) => t.projectName ?? '' },
        { label: 'Assigned to', value: (t) => t.assignees.map((a) => a.name).join(', ') },
        { label: 'Designation', value: (t) => t.assignees.map((a) => a.designation ?? '').join(', ') },
        { label: 'Status', value: (t) => t.status },
        { label: 'Assigned on', value: (t) => t.assignedAt.toISOString().slice(0, 10) },
        { label: 'Due', value: (t) => t.dueDate.toISOString().slice(0, 10) },
        { label: 'Due time', value: (t) => t.dueTime ?? '' },
        { label: 'Overdue', value: (t) => (t.isOverdue ? 'yes' : '') },
        { label: 'Elapsed', value: (t) => t.workingHoursText },
      ]);
      sendCsv(res, `all-tasks-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    /*
     * What the filter can offer, from EVERY task rather than the filtered ones.
     *
     * Derived from `rows`, choosing one client would rebuild the dropdown with
     * one option in it and there would be no way to get to a second without
     * clearing first — the same fault the team screen's department filter had.
     */
    const withTasks = { some: { deletedAt: null } };
    const [projectClients, retainerClients, followUpClients, internalCount, retainerProjects, internalProjects] =
      await Promise.all([
        /*
         * Projects still running, and any finished one that still has tasks.
         *
         * Only projects with tasks were offered, so a project set up this
         * morning — internal ones especially, which start empty — could not
         * be found in the list at all, and picking its client showed "No
         * results". A live project with nothing in it is still a project
         * somebody is about to fill; a delivered one with no tasks is not
         * worth a row.
         */
        prisma.project.findMany({
          where: { organizationId: orgId, OR: [{ status: 'LIVE' }, { tasks: withTasks }] },
          select: {
            id: true,
            name: true,
            isSample: true,
            company: { select: { id: true, name: true } },
            _count: { select: { tasks: { where: { deletedAt: null } } } },
          },
        }).then((rows) => rows.map((r) => ({ ...r, hasTasks: r._count.tasks > 0 }))),
        prisma.monthCard.findMany({
          where: { retainer: { organizationId: orgId }, tasks: withTasks },
          select: { retainer: { select: { company: { select: { id: true, name: true } } } } },
        }),
        prisma.company.findMany({
          where: { organizationId: orgId, tasks: withTasks },
          select: { id: true, name: true },
        }),
        prisma.task.count({
          where: { organizationId: orgId, deletedAt: null, projectId: null, monthCardId: null, companyId: null },
        }),
        prisma.retainerProject.findMany({
          where: {
            retainer: { organizationId: orgId },
            OR: [{ status: 'ACTIVE', retainer: { status: 'ACTIVE' } }, { tasks: withTasks }],
          },
          select: { id: true, name: true, retainer: { select: { company: { select: { id: true, name: true } } } } },
        }),
        prisma.internalProject.findMany({
          where: { organizationId: orgId, OR: [{ status: 'ACTIVE' }, { tasks: withTasks }] },
          select: { id: true, name: true },
        }),
      ]);

    const byId = new Map<string, string>();
    for (const pr of projectClients.filter((x) => x.hasTasks)) byId.set(pr.company.id, pr.company.name);
    for (const mc of retainerClients) byId.set(mc.retainer.company.id, mc.retainer.company.name);
    for (const c of followUpClients) byId.set(c.id, c.name);

    /*
     * Every project that has work in it, whatever kind, with the client it is
     * for — so the screen can narrow this list to the clients already chosen.
     */
    const projectOptions = [
      ...projectClients.map((pr) => ({
        value: `P:${pr.id}`,
        name: pr.isSample ? `${pr.name} (sample)` : pr.name,
        client: pr.company.name,
        companyId: pr.company.id as string | null,
      })),
      ...retainerProjects.map((rp) => ({
        value: `RP:${rp.id}`,
        name: rp.name,
        client: rp.retainer.company.name,
        companyId: rp.retainer.company.id as string | null,
      })),
      ...internalProjects.map((ip) => ({
        value: `IP:${ip.id}`,
        name: ip.name,
        client: 'Internal',
        companyId: null as string | null,
      })),
    ].sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name));

    res.json({
      success: true,
      tasks: rows,
      clients: Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      hasInternal: internalCount > 0,
      projects: projectOptions,
      counts: {
        total: rows.length,
        // Open is "not finished with", not a single status: TODO and
        // IN_PROGRESS are both work somebody still owes.
        open: rows.filter((t) => t.status === TaskStatus.TODO || t.status === TaskStatus.IN_PROGRESS).length,
        waiting: rows.filter((t) => t.status === TaskStatus.ON_HOLD).length,
        overdue: rows.filter((t) => t.isOverdue).length,
        unassigned: rows.filter((t) => t.assignees.length === 0).length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. List Tasks with Filters ──────────────────────────────────────────────

tasksRouter.get('/', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { workType, workId, monthCardId, projectId, assigneeId, status } = req.query;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    /*
     * Narrowed to what this person may see.
     *
     * This was organisation-scoped and nothing else: `GET /tasks` is gated on
     * `work.own`, which every employee holds, and it returned EVERY task in the
     * agency to any of them. The screens all pass a filter, so nobody noticed —
     * but the endpoint is the boundary, not the screen that happens to call it.
     * Everything for `work.all`, your own otherwise.
     */
    const seesEverything = (req.user!.permissions ?? []).includes('work.all');

    const where: any = {
      organizationId: orgId,
      deletedAt: null,
      ...(seesEverything ? {} : { OR: [{ assignees: { some: { userId: req.user!.userId } } }, { createdById: req.user!.userId }] }),
    };
    if (workType && typeof workType === 'string') where.workType = workType as TaskWorkType;
    if (workId && typeof workId === 'string') where.workId = workId;
    if (monthCardId && typeof monthCardId === 'string') where.monthCardId = monthCardId;
    if (projectId && typeof projectId === 'string') where.projectId = projectId;
    // Anybody on it, so filtering by a person finds the work they share.
    if (assigneeId && typeof assigneeId === 'string') where.assignees = { some: { userId: assigneeId } };
    if (status && typeof status === 'string') where.status = status as TaskStatus;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: { dueDate: 'asc' },
        skip,
        take,
        include: TASK_PEOPLE,
      }),
      prisma.task.count({ where }),
    ]);

    const calendar = await loadWorkCalendar(orgId);

    const formatted = tasks.map((t) => {
      const workingHours = workingMinutesOn(
        calendar,
        t.assignedAt,
        elapsedEnd(t, t.reviews[0], new Date()),
        t.waitingTotalMinutes,
      );
      return {
        ...withPeople(t),
        workingHoursText: workingHours.formatted,
        workingMinutes: workingHours.totalMinutes,
      };
    });

    const listed = await withRepeatNext(orgId, await withEscalatedTo(orgId, formatted));

    if (wantsCsv) {
      const csv = toCsv(listed, [
        { label: 'Title', value: (t) => t.title },
        { label: 'Work type', value: (t) => t.workType },
        { label: 'Assigned to', value: (t) => t.assignees.map((a) => a.name).join(', ') },
        // Two questions, two columns: who wanted it, and who typed it.
        { label: 'Assigned by', value: (t) => t.assignedBy?.name ?? t.creator.name },
        { label: 'Added by', value: (t) => t.creator.name },
        { label: 'Reviewer', value: (t) => t.reviewer?.name ?? '' },
        { label: 'Type', value: (t) => t.taskType ?? '' },
        { label: 'Status', value: (t) => t.status },
        { label: 'Due date', value: (t) => t.dueDate.toISOString().slice(0, 10) },
        { label: 'Elapsed', value: (t) => t.workingHoursText },
        { label: 'Reopen count', value: (t) => t.reopenCount },
      ]);
      sendCsv(res, `tasks-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      tasks: listed,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 3. Create Task ──────────────────────────────────────────────────────────

/**
 * The optional due time: "17:30", 24-hour, office time. An empty string clears
 * it, which is what a cleared time field sends.
 */
const dueTimeSchema = z.preprocess(
  (v) => (v === '' ? null : v),
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Give the due time as hours and minutes, like 17:30.')
    .nullable()
    .optional(),
);

const taskCreateSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  workType: z.nativeEnum(TaskWorkType).default(TaskWorkType.INTERNAL),
  workId: z.string().optional().nullable(),
  monthCardId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  /** Which piece of retainer work this is part of. Set alongside the month card, never instead of it. */
  retainerProjectId: z.string().optional().nullable(),
  /** Which piece of the studio's own work this is part of. Internal tasks only, and always optional. */
  internalProjectId: z.string().optional().nullable(),
  /**
   * Which client this task is ABOUT — chasing them, mostly.
   *
   * Internal tasks only. A month-card or project task already knows its client
   * through the work it sits on, and a second answer is a second thing that
   * can disagree with the first.
   */
  companyId: z.string().optional().nullable(),
  assigneeId: z.string().optional(),
  /** Everybody on it. The first is the lead; `assigneeId` still works on its own. */
  assigneeIds: z.array(z.string().min(1)).min(1).max(20).optional(),
  /** Who asked for the work. Defaults to whoever is typing. */
  assignedById: z.string().min(1).optional(),
  reviewerId: z.string().min(1).nullable().optional(),
  taskType: z.nativeEnum(TaskType).nullable().optional(),
  /** Needs an approver's sign-off before it is done. Off unless ticked. */
  needsApproval: z.boolean().optional(),
  dueDate: z.string().min(1, 'Due date is required'),
  dueTime: dueTimeSchema,
  priority: z.nativeEnum(Priority).optional(),
  notes: z.string().optional().nullable(),
  /**
   * Repeat it: just the word. The weekday or day of the month comes from the
   * due date (services/taskRepeat). Null or absent is "doesn't repeat".
   */
  repeat: z.nativeEnum(RepeatFrequency).nullable().optional(),
});

/**
 * Everybody named on a task must be on this team and still here.
 *
 * One query for the whole set rather than one per person, and it doubles as
 * the de-duplicator: `findMany` over a Set returns each id once, so a form
 * that submits the same person twice cannot make two rows the unique index
 * would then reject with a 500.
 */
async function resolvePeople(orgId: string, ids: string[]): Promise<string[] | null> {
  const wanted = [...new Set(ids)];
  const found = await prisma.user.findMany({
    where: { id: { in: wanted }, organizationId: orgId, active: true },
    select: { id: true },
  });
  if (found.length !== wanted.length) return null;
  // Caller's order, so "the first is the lead" survives the round trip.
  return wanted;
}

/**
 * Whether this caller may put work on somebody else's plate.
 *
 * §9 spells the two switches out: `work.own` is "see and complete work assigned
 * to me, create my own tasks", and `work.team` is "see and **assign** work for
 * my people". So handing a task to another person is a work.team act, and
 * doing it across the company is a work.all one.
 *
 * Nothing checked this. POST /tasks asks only for work.own, and `assigneeIds`
 * was taken at face value — so anybody signed in could put a task on anybody
 * else's My Work, and stamp a third person as the one who asked for it. That
 * is not a data leak; it is worse in its way, because the person it lands on
 * has no reason to doubt it.
 */
const mayAssignOthers = (req: AuthRequest): boolean =>
  hasPermission(req.user!, 'work.team') || hasPermission(req.user!, 'work.all');

/**
 * The rule, as one sentence: someone who can only manage their own work may
 * name only themselves — as the person doing it, and as the person who asked.
 *
 * Returns the refusal to send, or null when the request is allowed.
 */
function assignmentRefusal(
  req: AuthRequest,
  people: string[] | null,
  assignedById: string | undefined,
  /** For an edit: what the task already says, which they are allowed to leave alone. */
  existingPeople?: string[],
): string | null {
  if (mayAssignOthers(req)) return null;
  const me = req.user!.userId;

  if (people) {
    const others = people.filter((id) => id !== me);
    // Leaving an existing set untouched is not assigning. Without this, a
    // person could not edit the title of a task a manager put them on with a
    // colleague, because the form sends the assignees back as they are.
    const unchanged =
      existingPeople !== undefined &&
      people.length === existingPeople.length &&
      people.every((id) => existingPeople.includes(id));
    if (others.length > 0 && !unchanged) {
      return 'You can only assign work to yourself. Ask a head or management to put it on somebody else.';
    }
  }

  if (assignedById && assignedById !== me) {
    return 'You can only record yourself as the person who asked for this.';
  }

  return null;
}

tasksRouter.post('/', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const { title, workType, workId, monthCardId, projectId, retainerProjectId, internalProjectId, companyId, assigneeId, assigneeIds, assignedById, reviewerId, taskType, needsApproval, dueDate, dueTime, priority, notes, repeat } =
      parsed.data;

    // Approval needs somebody to approve it. No type picked is fine: the task
    // is filed as Other, which has the same approvers as all work.
    const approvalRefused = await approvalFlagRefusal(orgId, taskType, needsApproval ?? false);
    if (approvalRefused) {
      res.status(400).json({ success: false, error: approvalRefused });
      return;
    }

    // `assigneeIds` wins when both arrive; `assigneeId` alone still means a
    // task with one person on it, which is what every existing caller sends.
    const people = await resolvePeople(orgId, assigneeIds ?? [assigneeId || req.user!.userId]);
    if (!people) {
      res.status(400).json({ success: false, error: 'One of those people is not on the team' });
      return;
    }

    // §9: putting work on somebody else's plate is a work.team act.
    const refusal = assignmentRefusal(req, people, assignedById);
    if (refusal) {
      res.status(403).json({ success: false, error: refusal });
      return;
    }
    if (reviewerId) {
      const reviewer = await resolvePeople(orgId, [reviewerId]);
      if (!reviewer) {
        res.status(400).json({ success: false, error: 'That reviewer is not on the team' });
        return;
      }
    }
    if (assignedById) {
      const assigner = await resolvePeople(orgId, [assignedById]);
      if (!assigner) {
        res.status(400).json({ success: false, error: 'That person is not on the team' });
        return;
      }
    }

    const resolvedMonthCardId = monthCardId || (workType === 'MONTH_CARD' ? workId : null);

    /*
     * A closed month does not lock its tasks.
     *
     * It did: adding, editing, finishing, deleting or sending a task for
     * approval on a closed month was refused ("September 2026 is closed…"),
     * so work that ran past the 1st — a video still being approved, a task
     * somebody forgot to tick — could not be touched without reopening the
     * month. A task carries no money; the month's profit is its fee and its
     * costs, and the cost routes keep their lock.
     */

    /*
     * A task's project and its month card have to belong to the same retainer.
     *
     * Without this a Carlton task could be filed under a VOSO campaign — which
     * reads as nonsense on the board and, worse, moves work between two
     * clients' month lists. The database enforces it too (a trigger added with
     * the retainer_projects migration); this is the check that produces a
     * sentence somebody can act on rather than a 500.
     */
    /*
     * A task on a month card names a project. Always.
     *
     * Optional grouping that most work skipped was not grouping — it was a
     * second list called "Not in a project" holding two thirds of the work.
     * A caller that does not choose gets the retainer's default rather than a
     * refusal: the rule is about where the task ENDS UP, and making every
     * existing caller pick would break four forms to enforce a filing decision
     * the app can make correctly on its own.
     *
     * The database agrees — `tasks_month_card_needs_project` is a CHECK, so
     * this is a friendly path to the same guarantee, not the guarantee itself.
     */
    let resolvedProjectId = retainerProjectId ?? null;
    if (resolvedMonthCardId && !resolvedProjectId) {
      const card = await prisma.monthCard.findFirst({
        where: { id: resolvedMonthCardId, retainer: { organizationId: orgId } },
        select: { retainer: { select: { id: true, ownerId: true } } },
      });
      if (!card) {
        res.status(400).json({ success: false, error: 'That month card is not one of yours' });
        return;
      }
      resolvedProjectId = await defaultProjectId(card.retainer);
    }

    /*
     * The studio's own work, if it was named.
     *
     * No default to fall back on, unlike the retainer side: a retainer task
     * must name a project because the database says so, and most internal work
     * genuinely belongs to nothing. An empty bucket per loose task would be
     * worse than no bucket at all.
     */
    if (companyId) {
      if (workType !== TaskWorkType.INTERNAL) {
        res.status(400).json({
          success: false,
          error: 'Only an internal task names the client it is about — work on a retainer or a project already knows.',
        });
        return;
      }
      const owned = await prisma.company.findFirst({
        where: { id: companyId, organizationId: orgId },
        select: { id: true },
      });
      if (!owned) {
        res.status(404).json({ success: false, error: 'Company not found' });
        return;
      }
    }

    if (internalProjectId) {
      if (workType !== TaskWorkType.INTERNAL) {
        res.status(400).json({
          success: false,
          error: 'Only an internal task can belong to a piece of internal work.',
        });
        return;
      }
      const owned = await prisma.internalProject.findFirst({
        where: { id: internalProjectId, organizationId: orgId },
        select: { id: true },
      });
      if (!owned) {
        res.status(400).json({ success: false, error: 'That internal project is not one of yours.' });
        return;
      }
    }

    if (retainerProjectId) {
      if (!resolvedMonthCardId) {
        res.status(400).json({
          success: false,
          error: 'A task on a retainer project has to sit on one of that retainer\u2019s months.',
        });
        return;
      }
      const pairing = await prisma.retainerProject.findFirst({
        where: {
          id: retainerProjectId,
          retainer: { organizationId: orgId, monthCards: { some: { id: resolvedMonthCardId } } },
        },
        select: { id: true },
      });
      if (!pairing) {
        res.status(400).json({
          success: false,
          error: 'That project and that month belong to different retainers.',
        });
        return;
      }
    }

    /*
     * Written through the shared create (services/taskCreate) — the repeat
     * job makes its copies with the same function, so a copy is a task like
     * any other. A repeating task gets its rule first, in the same
     * transaction, with the day taken from the due date.
     *
     * "Assigned by" is nobody unless somebody was named; `createdById` always
     * records who typed it, and the drawer falls back to it.
     */
    const task = await prisma.$transaction(async (tx) => {
      const series = repeat
        ? await tx.taskRepeat.create({
            data: {
              organizationId: orgId,
              ...ruleFromDueDate(repeat, dayOf(new Date(dueDate))),
              createdById: req.user!.userId,
            },
          })
        : null;
      return createTaskRecord(tx, {
        orgId,
        createdById: req.user!.userId,
        actorId: req.user!.userId,
        title,
        workType,
        workId,
        monthCardId: resolvedMonthCardId,
        projectId,
        retainerProjectId: resolvedProjectId,
        internalProjectId,
        companyId,
        people,
        assignedById,
        reviewerId,
        taskType,
        needsApproval,
        dueDate: new Date(dueDate),
        dueTime,
        priority,
        notes,
        repeatId: series?.id ?? null,
      });
    });

    // The people on the way back out, in the same shape as every task endpoint.
    res.status(201).json({ success: true, task: withPeople(task) });
  } catch (error) {
    next(error);
  }
});

// ── 3b. Edit a Task ──────────────────────────────────────────────────────────
//
// This accepted `notes` and nothing else, so a task created with the wrong due
// date or pointed at the wrong person could never be corrected — the only way
// out was to cancel it and type it again, losing the thread. Every field here
// is optional, so the notes-only call My Work has always made still works
// unchanged.
//
// `work.own`, matching creation: POST already lets anybody with that
// permission create a task assigned to anybody, so refusing to let them move
// it afterwards would be a door with no wall beside it. Status has its own
// route below and is deliberately not settable here.

const taskEditSchema = z
  .object({
    title: z.string().min(1, 'Task title cannot be empty').max(300).optional(),
    assigneeId: z.string().min(1).optional(),
    assigneeIds: z.array(z.string().min(1)).min(1).max(20).optional(),
    assignedById: z.string().min(1).optional(),
    reviewerId: z.string().min(1).nullable().optional(),
    taskType: z.nativeEnum(TaskType).nullable().optional(),
    needsApproval: z.boolean().optional(),
    dueDate: z.string().min(1).optional(),
    dueTime: dueTimeSchema,
    priority: z.nativeEnum(Priority).optional(),
    notes: z.string().max(4000).nullable().optional(),
    /** Start, change or (null) stop the repeat — see the edit route. */
    repeat: z.nativeEnum(RepeatFrequency).nullable().optional(),
    /** Move it to a different piece of retainer work, or null to ungroup it. */
    retainerProjectId: z.string().min(1).nullable().optional(),
    /**
     * File an internal task under a piece of the studio's own work, or null to
     * take it back out.
     *
     * This is the path that matters most for internal projects: nothing is
     * backfilled when a bucket is created, so every task that already exists
     * gets filed by editing it.
     */
    internalProjectId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

tasksRouter.patch('/:id', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = taskEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const existing = await prisma.task.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const { title, assigneeId, assigneeIds, assignedById, reviewerId, taskType, needsApproval, dueDate, dueTime, priority, notes, repeat } =
      parsed.data;

    /*
     * Approval, on an edit.
     *
     *   · Neither the flag nor the type moves while the task is waiting on an
     *     approver — the round in flight was sent to that type's approvers.
     *   · Ticked (or kept ticked on a new type), it needs a type with approvers.
     *   · Taking it off is for whoever created the task, one of its approvers,
     *     or a Head — not for the person whose work it would stop checking.
     */
    const typeChanging = taskType !== undefined && taskType !== existing.taskType;
    const approvalChanging = needsApproval !== undefined && needsApproval !== existing.needsApproval;
    if (existing.status === TaskStatus.IN_REVIEW && (typeChanging || approvalChanging)) {
      res.status(400).json({
        success: false,
        error: "This task is waiting for approval. Its type and approval can't change until it's decided.",
      });
      return;
    }
    const nextNeedsApproval = needsApproval ?? existing.needsApproval;
    // Needing approval with no type picked is filed as Other.
    const pickedType = taskType !== undefined ? taskType : existing.taskType;
    const nextType = nextNeedsApproval ? approvalType(pickedType) : pickedType;
    if (nextNeedsApproval && (typeChanging || approvalChanging)) {
      const refused = await approvalFlagRefusal(orgId, nextType, true);
      if (refused) {
        res.status(400).json({ success: false, error: refused });
        return;
      }
    }
    if (approvalChanging && needsApproval === false) {
      const me = req.user!.userId;
      const pool = await approverIds(orgId, existing.taskType);
      const allowed =
        existing.createdById === me || pool.includes(me) || hasPermission(req.user!, 'work.team');
      if (!allowed) {
        res.status(403).json({
          success: false,
          error: 'Only whoever created this task, one of its approvers, or a Head can take approval off it.',
        });
        return;
      }
    }

    // Everybody named has to be on this team and still here — without it the
    // contents of a picker are the only thing standing between a typo and a
    // task assigned into another company.
    const people = assigneeIds ?? (assigneeId ? [assigneeId] : null);
    if (people) {
      const ok = await resolvePeople(orgId, people);
      if (!ok) {
        res.status(400).json({ success: false, error: 'One of those people is not on the team' });
        return;
      }
    }
    if (reviewerId) {
      const ok = await resolvePeople(orgId, [reviewerId]);
      if (!ok) {
        res.status(400).json({ success: false, error: 'That reviewer is not on the team' });
        return;
      }
    }
    if (assignedById) {
      const ok = await resolvePeople(orgId, [assignedById]);
      if (!ok) {
        res.status(400).json({ success: false, error: 'That person is not on the team' });
        return;
      }
    }

    /*
     * The same §9 rule as create, with one difference that matters: an edit is
     * compared against what the task already says. Somebody a manager put on a
     * shared task must still be able to fix its title, and the form sends the
     * assignees back untouched when they do — refusing that would lock them
     * out of their own work.
     */
    if (people || assignedById) {
      const current = await prisma.taskAssignee.findMany({ where: { taskId: id }, select: { userId: true } });
      const refusal = assignmentRefusal(req, people, assignedById, (current ?? []).map((a) => a.userId));
      if (refusal) {
        res.status(403).json({ success: false, error: refusal });
        return;
      }
    }

    if (parsed.data.internalProjectId) {
      if (existing.workType !== TaskWorkType.INTERNAL) {
        res.status(400).json({
          success: false,
          error: 'Only an internal task can belong to a piece of internal work.',
        });
        return;
      }
      const owned = await prisma.internalProject.findFirst({
        where: { id: parsed.data.internalProjectId, organizationId: orgId },
        select: { id: true },
      });
      if (!owned) {
        res.status(400).json({ success: false, error: 'That internal project is not one of yours.' });
        return;
      }
    }

    // Same pairing rule as create: a task cannot be moved onto a project
    // belonging to a different retainer than the month it is billed in.
    if (parsed.data.retainerProjectId) {
      if (!existing.monthCardId) {
        res.status(400).json({
          success: false,
          error: 'Only a task on a retainer month can belong to a retainer project.',
        });
        return;
      }
      const pairing = await prisma.retainerProject.findFirst({
        where: {
          id: parsed.data.retainerProjectId,
          retainer: { organizationId: orgId, monthCards: { some: { id: existing.monthCardId } } },
        },
        select: { id: true },
      });
      if (!pairing) {
        res.status(400).json({
          success: false,
          error: 'That project and that month belong to different retainers.',
        });
        return;
      }
    }

    const nextPeople = people ? [...new Set(people)] : null;

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        // The lead follows the first name in the list, so the two can never
        // disagree about who is answerable for the task.
        ...(nextPeople ? { assigneeId: nextPeople[0] } : {}),
        ...(assignedById !== undefined ? { assignedById } : {}),
        ...(reviewerId !== undefined ? { reviewerId } : {}),
        ...(taskType !== undefined || nextType !== existing.taskType ? { taskType: nextType } : {}),
        ...(needsApproval !== undefined ? { needsApproval } : {}),
        ...(dueDate !== undefined ? { dueDate: new Date(dueDate) } : {}),
        ...(dueTime !== undefined ? { dueTime } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(parsed.data.retainerProjectId !== undefined
          ? { retainerProjectId: parsed.data.retainerProjectId }
          : {}),
        ...(parsed.data.internalProjectId !== undefined
          ? { internalProjectId: parsed.data.internalProjectId }
          : {}),
        ...(nextPeople
          ? {
              // Replace rather than merge: the form sends the whole set, and a
              // merge would make removing somebody impossible.
              assignees: {
                deleteMany: { userId: { notIn: nextPeople } },
                upsert: nextPeople.map((userId) => ({
                  where: { taskId_userId: { taskId: id, userId } },
                  create: { userId },
                  update: {},
                })),
              },
            }
          : {}),
      },
    });

    // What actually moved, not what was submitted. An edit form posts every
    // field it holds, so logging the payload would record five changes for a
    // one-word fix and make the trail useless for answering "who moved this".
    const changed: Record<string, { from: string | boolean | null; to: string | boolean | null }> = {};
    if (title !== undefined && task.title !== existing.title) {
      changed.title = { from: existing.title, to: task.title };
    }
    if (nextPeople && task.assigneeId !== existing.assigneeId) {
      changed.assignee = { from: existing.assigneeId, to: task.assigneeId };
    }
    if (reviewerId !== undefined && task.reviewerId !== existing.reviewerId) {
      changed.reviewer = { from: existing.reviewerId, to: task.reviewerId };
    }
    if (assignedById !== undefined && task.assignedById !== existing.assignedById) {
      changed.assignedBy = { from: existing.assignedById, to: task.assignedById };
    }
    if (taskType !== undefined && task.taskType !== existing.taskType) {
      changed.taskType = { from: existing.taskType, to: task.taskType };
    }
    if (needsApproval !== undefined && task.needsApproval !== existing.needsApproval) {
      changed.needsApproval = { from: existing.needsApproval, to: task.needsApproval };
    }
    if (dueTime !== undefined && task.dueTime !== existing.dueTime) {
      changed.dueTime = { from: existing.dueTime, to: task.dueTime };
    }
    if (dueDate !== undefined && task.dueDate.getTime() !== existing.dueDate.getTime()) {
      changed.dueDate = {
        from: existing.dueDate.toISOString().slice(0, 10),
        to: task.dueDate.toISOString().slice(0, 10),
      };
    }
    if (priority !== undefined && task.priority !== existing.priority) {
      changed.priority = { from: existing.priority, to: task.priority };
    }
    if (notes !== undefined && task.notes !== existing.notes) {
      changed.notes = { from: Boolean(existing.notes), to: Boolean(task.notes) };
    }

    /*
     * The repeat. Anyone who can edit the task can change or stop it.
     *
     *   · a value on a task with no live repeat starts one;
     *   · a different value changes the rule — future copies use it, and the
     *     day of the task's current due date;
     *   · null stops it, saying who. Copies already made are never touched.
     *
     * The same value again changes nothing: the stored day is kept, so a copy
     * that was moved off a holiday does not move every copy after it.
     */
    if (repeat !== undefined) {
      const current = existing.repeatId
        ? await prisma.taskRepeat.findUnique({ where: { id: existing.repeatId } })
        : null;
      const live = current && !current.stoppedAt ? current : null;
      const dueDay = dayOf(task.dueDate);
      if (repeat === null && live) {
        const me = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } });
        await prisma.taskRepeat.update({
          where: { id: live.id },
          data: { stoppedAt: new Date(), stoppedReason: `Stopped by ${me?.name ?? 'someone'}` },
        });
        changed.repeat = { from: live.frequency, to: null };
      } else if (repeat && !live) {
        const series = await prisma.taskRepeat.create({
          data: { organizationId: orgId, ...ruleFromDueDate(repeat, dueDay), createdById: req.user!.userId },
        });
        await prisma.task.update({ where: { id }, data: { repeatId: series.id } });
        changed.repeat = { from: null, to: repeat };
      } else if (repeat && live && live.frequency !== repeat) {
        await prisma.taskRepeat.update({ where: { id: live.id }, data: ruleFromDueDate(repeat, dueDay) });
        changed.repeat = { from: live.frequency, to: repeat };
      }
    }

    if (Object.keys(changed).length > 0) {
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Task',
          entityId: task.id,
          actorId: req.user!.userId,
          verb: 'task_edited',
          payload: { title: task.title, changed },
        },
      });
    }

    res.json({ success: true, task });
  } catch (error) {
    next(error);
  }
});

// ── 3c. Delete a Task ───────────────────────────────────────────────────────
//
// Final, from where anybody using Flowzen stands: there is no restore for a
// task. It is a line of work, not a record anybody needs back, and a "Recently
// deleted" list kept surfacing other people's deleted tasks on My Work. The
// confirm dialog is the guard against a slip.
//
// The row itself stays — `deletedAt` is stamped and every read filters it out
// — because the activity log names the task by its title and says who deleted
// it, and a log that points at nothing reads as a hole.
//
// The guard is the project route's idea applied to a task. One nobody finished
// carries no history — it is a typo or a duplicate and should simply go. A
// FINISHED one is history: `computeTaskTypeMedians` reads it to work out how
// long this kind of work usually takes, the allocation cron counts it towards
// who did what this month, and My Work lists it under "done". Removing one
// silently rewrites figures that have already been reported, so it is refused
// and Cancel is offered instead.
//
// Who: whoever created it, whoever it is assigned to, or anybody with
// `work.all` — a Head or Management. Anyone else gets a 403 rather than a 404,
// because the task plainly exists and pretending otherwise is not security.

const canRemove = (req: AuthRequest, task: { createdById: string; assigneeId: string }) =>
  task.createdById === req.user!.userId ||
  task.assigneeId === req.user!.userId ||
  (req.user!.permissions ?? []).includes('work.all');

tasksRouter.delete('/:id', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const task = await prisma.task.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    if (!canRemove(req, task)) {
      res.status(403).json({
        success: false,
        error: 'Only the person who created this task, the person it is assigned to, or a Head can delete it',
      });
      return;
    }

    if (task.completedAt || task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED) {
      res.status(400).json({
        success: false,
        error:
          'This task has been finished, and how long it took counts towards the timings this team is measured on. Deleting it would change figures already reported.',
      });
      return;
    }

    await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'task_deleted',
        payload: { title: task.title, assigneeId: task.assigneeId },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── 4. Change Task Status ───────────────────────────────────────────────────
//
// DONE and CANCELLED both stop the clock (§11.4: completedAt stops it) —
// neither is "still open" work, and moving out of either back to an active
// status is a reopen, incrementing reopenCount, the same way marking work
// done early and reopening it always has. This used to accept any raw
// string with no validation at all.

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'ON_HOLD', 'DONE', 'CANCELLED'] as const;
const FINISHED_STATUSES: string[] = ['DONE', 'CANCELLED'];

tasksRouter.patch('/:id/status', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const { status } = req.body;

    if (typeof status !== 'string' || !TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) {
      res.status(400).json({ success: false, error: 'Invalid task status' });
      return;
    }

    const task = await prisma.task.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    /*
     * Approval has its own doors, and this is not one of them.
     *
     *   · In review is reached only by "Send for approval", which records the
     *     round and who it went to.
     *   · Out of review is Approve or Request changes — or Cancel, which ends
     *     the task and follows the usual rules below.
     *   · A task that needs approval reaches Done only through Approve.
     */
    if (status === 'IN_REVIEW') {
      res.status(400).json({ success: false, error: "A task goes into review by sending it for approval. Use 'Send for approval'." });
      return;
    }
    if (task.status === TaskStatus.IN_REVIEW && status !== 'CANCELLED') {
      res.status(400).json({
        success: false,
        error: 'This task is waiting for approval. An approver approves it or requests changes — the only other way out is Cancel.',
      });
      return;
    }
    if (status === 'DONE' && task.needsApproval && task.status !== TaskStatus.DONE) {
      res.status(400).json({ success: false, error: "This task needs approval. Use 'Send for approval'." });
      return;
    }

    let completedAt: Date | null = task.completedAt;
    let reopenCount = task.reopenCount;
    const wasFinished = FINISHED_STATUSES.includes(task.status);
    const isFinished = FINISHED_STATUSES.includes(status);

    if (isFinished && !wasFinished) {
      completedAt = new Date();
    } else if (!isFinished && wasFinished) {
      completedAt = null;
      reopenCount += 1;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: status as TaskStatus,
        completedAt,
        reopenCount,
      },
    });

    const verb = isFinished && !wasFinished ? (status === 'DONE' ? 'task_completed' : 'task_cancelled') : !isFinished && wasFinished ? 'task_reopened' : 'task_status_changed';
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: id,
        actorId: req.user!.userId,
        verb,
        payload: { from: task.status, to: status },
      },
    });

    res.json({ success: true, task: updated });
  } catch (error) {
    next(error);
  }
});

// ── 5. Pause Clock on Hold (Waiting On) ─────────────────────────────────────

const waitSchema = z.object({
  waitingOn: z.nativeEnum(WaitingOn),
});

tasksRouter.post('/:id/wait', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = waitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    // Unlike its siblings this update went straight to prisma.task.update by
    // bare id, with no check that the task belongs to the caller's org — a
    // tenant-isolation gap the other four task mutations don't have.
    const existing = await prisma.task.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    // Waiting on an approver is not waiting on the client: that clock is the
    // review's, and the round decides what happens next.
    if (existing.status === TaskStatus.IN_REVIEW) {
      res.status(400).json({ success: false, error: "This task is waiting for approval, so it can't be put on hold." });
      return;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: TaskStatus.ON_HOLD,
        waitingOn: parsed.data.waitingOn,
        waitingSince: new Date(),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'task_waiting',
        payload: { waitingOn: parsed.data.waitingOn },
      },
    });

    res.json({ success: true, task: updated });
  } catch (error) {
    next(error);
  }
});

// ── 6. Resume Clock from Hold ───────────────────────────────────────────────

tasksRouter.post('/:id/resume', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const task = await prisma.task.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    if (task.status === TaskStatus.IN_REVIEW) {
      res.status(400).json({ success: false, error: 'This task is waiting for approval, not on hold.' });
      return;
    }

    let additionalMinutes = 0;
    if (task.waitingSince) {
      additionalMinutes = Math.max(0, Math.floor((Date.now() - new Date(task.waitingSince).getTime()) / (1000 * 60)));
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: TaskStatus.IN_PROGRESS,
        waitingOn: null,
        waitingSince: null,
        waitingTotalMinutes: task.waitingTotalMinutes + additionalMinutes,
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'task_resumed',
        payload: { waitedMinutes: additionalMinutes },
      },
    });

    res.json({ success: true, task: updated });
  } catch (error) {
    next(error);
  }
});

// ── 7. Approval ─────────────────────────────────────────────────────────────
//
// A task marked "Needs approval" is sent, not marked done. Send for approval
// opens a round and moves it to In review; one approver for its type then
// approves it (Done), or requests changes with written feedback (back to In
// progress, and the next send is the next round). Round by round, so the
// history says how many times a piece of work went back, and why.
//
// The working minutes a round spends waiting on an approver are added to
// `waitingTotalMinutes` when it is decided. Every elapsed and aging figure
// already subtracts that field, so review time never counts against the
// editor. `waitingSince`/`waitingOn` are left alone — they are the ON_HOLD
// flow's, and mixing the two would make each lie about the other.

/** The task, with who is on it and its latest round, for the approval actions. */
const loadForApproval = (orgId: string, id: string) =>
  prisma.task.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    include: {
      assignees: { select: { userId: true } },
      reviews: { orderBy: { round: 'desc' }, take: 1, include: REVIEW_PEOPLE },
    },
  });

/** Somebody else moved the task first — a second approver, or a double send. */
class ApprovalConflict extends Error {}

const submitReviewSchema = z.object({
  link: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Paste the full link, starting with http:// or https://')
    .optional(),
  note: z.string().trim().max(2000, 'Keep the note under 2000 characters').optional(),
});

tasksRouter.post('/:id/submit-review', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = submitReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const me = req.user!.userId;

    const task = await loadForApproval(orgId, id);
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    if (!task.needsApproval) {
      res.status(400).json({ success: false, error: "This task doesn't need approval — mark it Done instead." });
      return;
    }
    const onIt = task.assignees.some((a) => a.userId === me);
    if (!onIt && task.createdById !== me) {
      res.status(403).json({
        success: false,
        error: 'Only the people on this task, or whoever created it, can send it for approval.',
      });
      return;
    }
    if (task.status !== TaskStatus.TODO && task.status !== TaskStatus.IN_PROGRESS) {
      const why =
        task.status === TaskStatus.IN_REVIEW
          ? "It's already waiting for approval."
          : task.status === TaskStatus.ON_HOLD
            ? "It's on hold. Take it off hold first."
            : 'This task is finished.';
      res.status(400).json({ success: false, error: why });
      return;
    }
    // The approvers could have been emptied since the box was ticked.
    const refused = await approvalFlagRefusal(orgId, task.taskType, true);
    if (refused) {
      res.status(400).json({ success: false, error: refused });
      return;
    }

    const round = (task.reviews[0]?.round ?? 0) + 1;
    const link = parsed.data.link || null;
    const note = parsed.data.note || null;

    let review;
    try {
      review = await prisma.$transaction(async (tx) => {
        // Conditional, so two clicks cannot open two rounds: the second finds
        // the task already in review and moves nothing.
        const moved = await tx.task.updateMany({
          where: { id, status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] } },
          data: { status: TaskStatus.IN_REVIEW },
        });
        if (moved.count === 0) throw new ApprovalConflict();
        return tx.taskReview.create({
          data: { organizationId: orgId, taskId: id, round, submittedById: me, link, note },
          include: REVIEW_PEOPLE,
        });
      });
    } catch (e) {
      if (e instanceof ApprovalConflict || (e as { code?: string }).code === 'P2002') {
        res.status(409).json({ success: false, error: 'It was just sent for approval. Refresh to see it.' });
        return;
      }
      throw e;
    }

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: id,
        actorId: me,
        verb: 'task_submitted_for_approval',
        payload: { title: task.title, round, ...(link ? { link } : {}) },
      },
    });

    res.status(201).json({ success: true, status: TaskStatus.IN_REVIEW, review });
  } catch (error) {
    next(error);
  }
});

/**
 * Deciding the open round — Approve, or Request changes.
 *
 * One approver decides it. Two clicking at the same moment both read "In
 * review", so the write is conditional on the task still being there: the
 * first moves it, the second moves nothing and is told who got there first.
 */
async function decideReview(
  req: AuthRequest,
  res: Response,
  decision: ReviewDecision,
  feedback: string | null,
): Promise<void> {
  const orgId = req.user!.organizationId;
  const id = String(req.params.id);
  const me = req.user!.userId;

  const task = await loadForApproval(orgId, id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  const open = task.reviews[0];
  if (task.status !== TaskStatus.IN_REVIEW || !open || open.decision) {
    if (open?.decision) {
      res.status(409).json({ success: false, error: `Already decided by ${open.decidedBy?.name ?? 'someone else'}` });
      return;
    }
    res.status(400).json({ success: false, error: "This task isn't waiting for approval." });
    return;
  }

  const refused = await approveRefusal(
    orgId,
    me,
    { taskType: task.taskType, assigneeIds: task.assignees.map((a) => a.userId) },
    open,
  );
  if (refused) {
    res.status(403).json({ success: false, error: refused });
    return;
  }

  const now = new Date();
  const calendar = await loadWorkCalendar(orgId);
  // The round's wait, in working time — handed back to the editor's clock.
  const reviewMinutes = workingMinutesOn(calendar, open.submittedAt, now).totalMinutes;
  const approved = decision === ReviewDecision.APPROVED;

  try {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.task.updateMany({
        where: { id, status: TaskStatus.IN_REVIEW },
        data: {
          status: approved ? TaskStatus.DONE : TaskStatus.IN_PROGRESS,
          ...(approved ? { completedAt: now } : {}),
          // Changes requested is not a reopen: `reopenCount` counts finished
          // work pulled back, which this never was.
          waitingTotalMinutes: { increment: reviewMinutes },
        },
      });
      if (moved.count === 0) throw new ApprovalConflict();
      const decided = await tx.taskReview.updateMany({
        where: { id: open.id, decision: null },
        data: { decision, decidedById: me, decidedAt: now, feedback },
      });
      if (decided.count === 0) throw new ApprovalConflict();
      // The reminder or escalation in the bell is answered — clear it now,
      // not on the chaser's next tick.
      await tx.alert.updateMany({
        where: { organizationId: orgId, rule: { in: CHASER_RULES }, entityType: 'Task', entityId: id, resolvedAt: null },
        data: { resolvedAt: now },
      });
    });
  } catch (e) {
    if (e instanceof ApprovalConflict) {
      const latest = await prisma.taskReview.findFirst({
        where: { taskId: id },
        orderBy: { round: 'desc' },
        include: { decidedBy: { select: { name: true } } },
      });
      res.status(409).json({ success: false, error: `Already decided by ${latest?.decidedBy?.name ?? 'someone else'}` });
      return;
    }
    throw e;
  }

  await prisma.activity.create({
    data: {
      organizationId: orgId,
      entityType: 'Task',
      entityId: id,
      actorId: me,
      verb: approved ? 'task_approved' : 'task_changes_requested',
      payload: { title: task.title, round: open.round, ...(feedback ? { feedback } : {}) },
    },
  });

  res.json({
    success: true,
    decision,
    round: open.round,
    status: approved ? TaskStatus.DONE : TaskStatus.IN_PROGRESS,
  });
}

tasksRouter.post('/:id/approve', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    await decideReview(req, res, ReviewDecision.APPROVED, null);
  } catch (error) {
    next(error);
  }
});

const requestChangesSchema = z.object({
  feedback: z
    .string()
    .trim()
    .min(1, 'Say what needs changing — the editor works from this.')
    .max(2000, 'Keep the feedback under 2000 characters'),
});

tasksRouter.post('/:id/request-changes', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = requestChangesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    await decideReview(req, res, ReviewDecision.CHANGES_REQUESTED, parsed.data.feedback);
  } catch (error) {
    next(error);
  }
});

const addChangesSchema = z.object({
  feedback: z
    .string()
    .trim()
    .min(1, 'Say what needs changing — the editor works from this.')
    .max(2000, 'Keep the changes under 2000 characters'),
});

/**
 * POST /api/tasks/:id/add-changes — another approver's changes, on a round
 * somebody already sent back.
 *
 * One approver is enough to approve. But the first to press Request changes
 * used to close the round for everybody, so the other approvers' notes went
 * to WhatsApp or nowhere. While the task is back with the editor, any of them
 * can add theirs; the editor gets one list, each note with its author.
 */
tasksRouter.post('/:id/add-changes', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = addChangesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const me = req.user!.userId;

    const task = await loadForApproval(orgId, id);
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const latest = task.reviews[0];
    const refused = await addChangesRefusal(
      orgId,
      me,
      { taskType: task.taskType, status: task.status, assigneeIds: task.assignees.map((a) => a.userId) },
      latest,
    );
    if (refused) {
      res.status(400).json({ success: false, error: refused });
      return;
    }

    const note = await prisma.taskReviewNote.create({
      data: { reviewId: latest.id, authorId: me, feedback: parsed.data.feedback },
      select: { id: true, feedback: true, createdAt: true, author: { select: { id: true, name: true } } },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: id,
        actorId: me,
        verb: 'task_changes_added',
        payload: { title: task.title, round: latest.round, feedback: parsed.data.feedback },
      },
    });

    res.status(201).json({ success: true, note });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/tasks/:id/reviews — one task's approval rounds, and what the
 * person looking can do about it.
 *
 * The WhatsApp link lands here: an approver opens /my-work?task=… on their
 * phone, and the task is usually not on their own list. So this carries
 * enough of the task to draw it, the whole history, and whether this viewer
 * can approve it now — or, when it was already decided, who decided.
 *
 * Seen by the people on the task, whoever created it, the approvers for its
 * type, and Heads.
 */
tasksRouter.get('/:id/reviews', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const me = req.user!.userId;

    const task = await prisma.task.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        ...TASK_PLACE,
        ...TASK_PEOPLE,
        reviews: { orderBy: { round: 'asc' }, include: REVIEW_PEOPLE },
      },
    });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const assigneeIds = task.assignees.map((a) => a.user.id);
    const [types, escalationTypes] = await Promise.all([approverFor(orgId, me), escalateFor(orgId, me)]);
    const isApprover = Boolean(task.taskType && types.includes(task.taskType));
    const isEscalation = Boolean(task.taskType && escalationTypes.includes(task.taskType));
    const onIt = assigneeIds.includes(me);
    if (!onIt && task.createdById !== me && !isApprover && !isEscalation && !hasPermission(req.user!, 'work.team')) {
      res.status(403).json({ success: false, error: "You can't see this task." });
      return;
    }

    const inReview = task.status === TaskStatus.IN_REVIEW;
    const open = inReview ? ([...task.reviews].reverse().find((r) => r.decision == null) ?? null) : null;
    const refusal = inReview ? await approveRefusal(orgId, me, { taskType: task.taskType, assigneeIds }, open) : null;
    // Who it escalated to, when the waiting round has.
    const escalatedTo =
      open?.escalatedAt && task.taskType
        ? ((await escalationNamesByType(orgId, [task.taskType])).get(task.taskType) ?? [])
        : [];

    let waitingMinutes: number | null = null;
    if (open) {
      const calendar = await loadWorkCalendar(orgId);
      waitingMinutes = workingMinutesOn(calendar, open.submittedAt, new Date()).totalMinutes;
    }

    res.json({
      success: true,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        taskType: task.taskType,
        taskTypeLabel: task.taskType ? TASK_TYPE_LABEL[task.taskType] : null,
        needsApproval: task.needsApproval,
        priority: task.priority,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        ...placeOf(task),
        assignees: task.assignees.map((a) => a.user),
        creator: task.creator,
      },
      reviews: task.reviews.map((r) => ({
        id: r.id,
        round: r.round,
        submittedBy: r.submittedBy,
        submittedAt: r.submittedAt,
        link: r.link,
        note: r.note,
        decision: r.decision,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt,
        feedback: r.feedback,
        notes: r.notes,
        remindedAt: r.remindedAt,
        escalatedAt: r.escalatedAt,
      })),
      escalatedTo,
      viewer: {
        isApprover,
        isEscalation,
        canApprove: inReview && refusal == null,
        // Why not, when they are an approver (or escalation person) and still
        // cannot — their own work, or not escalated yet.
        approveRefusal: inReview && (isApprover || isEscalation) ? refusal : null,
        canSubmit:
          task.needsApproval &&
          (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS) &&
          (onIt || task.createdById === me),
        // Sent back, and this approver can add their own changes to it.
        canAddChanges:
          (isApprover || isEscalation) &&
          (await addChangesRefusal(
            orgId,
            me,
            { taskType: task.taskType, status: task.status, assigneeIds },
            task.reviews[task.reviews.length - 1],
          )) == null,
      },
      waitingMinutes,
      waitingText: waitingMinutes != null ? formatWorkingMinutes(waitingMinutes) : null,
    });
  } catch (error) {
    next(error);
  }
});
