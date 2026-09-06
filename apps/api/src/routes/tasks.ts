import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { calculateWorkingMinutes } from '../utils/workingHours.js';
import { computeTaskTypeMedians, taskTypeGroupKey } from '../utils/taskTypeMedian.js';
import { TaskStatus, TaskWorkType, WaitingOn, Priority, TaskType } from '@prisma/client';

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

/**
 * The people on a task, in one shape wherever a task is read.
 *
 * `assignee` is the lead and `assignees` is everybody, the lead included, so a
 * caller can render "Janani +2" without joining two lists itself.
 *
 * `assignedBy` and `creator` are two different people asked two different
 * questions: who wanted this done, and who typed it in. They are usually the
 * same, which is why one column pretended to be both for so long — but a
 * manager writing up what a Head asked for in a meeting is exactly the case
 * the product exists to record, and it was the one it got wrong.
 */
export const TASK_PEOPLE = {
  assignee: { select: { id: true, name: true, designation: true, dept: true } },
  assignedBy: { select: { id: true, name: true, designation: true } },
  creator: { select: { id: true, name: true, designation: true } },
  reviewer: { select: { id: true, name: true, designation: true } },
  assignees: {
    orderBy: { assignedAt: 'asc' as const },
    select: { user: { select: { id: true, name: true, designation: true, dept: true } } },
  },
} as const;

/**
 * Flattens the join rows, so the wire carries people rather than link records.
 *
 * `Omit` in the return type is load-bearing: a plain spread keeps the source's
 * `assignees` type, so the flattened array still looked like `{ user }[]` to
 * every caller and the CSV column reading `a.name` failed to compile.
 */
export type TaskPerson = { id: string; name: string; designation: string | null; dept?: string };

export function withPeople<T extends { assignees: { user: TaskPerson }[] }>(task: T) {
  return { ...task, assignees: task.assignees.map((a) => a.user) } as Omit<T, 'assignees'> & {
    assignees: TaskPerson[];
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

    const formattedTasks = allMyTasks.map((t) => {
      const clientName = t.monthCard?.retainer.company.name || t.project?.company.name || 'Internal';
      const workingHours = calculateWorkingMinutes(t.assignedAt, t.completedAt || now, t.waitingTotalMinutes);
      const typeMedianMinutes = medianByGroup.get(taskTypeGroupKey(t)) ?? null;

      const dueStr = new Date(t.dueDate).toISOString().slice(0, 10);
      const isOverdue = t.status !== 'DONE' && dueStr < todayStr;
      const isToday = t.status !== 'DONE' && dueStr === todayStr;
      const isThisWeek = t.status !== 'DONE' && !isOverdue && !isToday && new Date(t.dueDate) <= endOfWeek;
      const isDone = t.status === 'DONE';
      // Anything open and due beyond the 7-day window still needs a bucket —
      // a retainer's template tasks are created a month out, and a task that
      // fits none of overdue/today/thisWeek/done was silently disappearing
      // from the one screen ~25 people rely on to see their work.
      const isLater = !isOverdue && !isToday && !isThisWeek && !isDone;

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
        projectName: t.project?.name ?? null,
        workingHoursText: workingHours.formatted,
        workingMinutes: workingHours.totalMinutes,
        typeMedianMinutes,
        typeMedianText: typeMedianMinutes != null ? formatWorkingMinutes(typeMedianMinutes) : null,
        isOverdue,
        isToday,
        isThisWeek,
        isLater,
        isDone,
      };
    });

    const today = formattedTasks.filter((t) => t.isToday);
    const overdue = formattedTasks.filter((t) => t.isOverdue);
    const thisWeek = formattedTasks.filter((t) => t.isThisWeek);
    const later = formattedTasks.filter((t) => t.isLater);
    const completed = formattedTasks.filter((t) => t.isDone);

    res.json({
      success: true,
      counts: {
        today: today.length,
        overdue: overdue.length,
        thisWeek: thisWeek.length,
        later: later.length,
        completed: completed.length,
      },
      tasks: {
        today,
        overdue,
        thisWeek,
        later,
        completed,
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

    const where: any = { organizationId: orgId, deletedAt: null };
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

    const formatted = tasks.map((t) => {
      const workingHours = calculateWorkingMinutes(t.assignedAt, t.completedAt || new Date(), t.waitingTotalMinutes);
      return {
        ...withPeople(t),
        workingHoursText: workingHours.formatted,
        workingMinutes: workingHours.totalMinutes,
      };
    });

    if (wantsCsv) {
      const csv = toCsv(formatted, [
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
      tasks: formatted,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 3. Create Task ──────────────────────────────────────────────────────────

const taskCreateSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  workType: z.nativeEnum(TaskWorkType).default(TaskWorkType.INTERNAL),
  workId: z.string().optional().nullable(),
  monthCardId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  assigneeId: z.string().optional(),
  /** Everybody on it. The first is the lead; `assigneeId` still works on its own. */
  assigneeIds: z.array(z.string().min(1)).min(1).max(20).optional(),
  /** Who asked for the work. Defaults to whoever is typing. */
  assignedById: z.string().min(1).optional(),
  reviewerId: z.string().min(1).nullable().optional(),
  taskType: z.nativeEnum(TaskType).nullable().optional(),
  dueDate: z.string().min(1, 'Due date is required'),
  priority: z.nativeEnum(Priority).optional(),
  notes: z.string().optional().nullable(),
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

tasksRouter.post('/', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const { title, workType, workId, monthCardId, projectId, assigneeId, assigneeIds, assignedById, reviewerId, taskType, dueDate, priority, notes } =
      parsed.data;

    // `assigneeIds` wins when both arrive; `assigneeId` alone still means a
    // task with one person on it, which is what every existing caller sends.
    const people = await resolvePeople(orgId, assigneeIds ?? [assigneeId || req.user!.userId]);
    if (!people) {
      res.status(400).json({ success: false, error: 'One of those people is not on the team' });
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

    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        title: title.trim(),
        workType,
        workId: workId || null,
        monthCardId: monthCardId || (workType === 'MONTH_CARD' ? workId : null),
        projectId: projectId || (workType === 'PROJECT' ? workId : null),
        assigneeId: people[0],
        // Who typed it, and who asked for it. The first is never chosen — it
        // is what `canRemove` reads — and the second falls back to it, so a
        // form that does not offer the field behaves exactly as before.
        createdById: req.user!.userId,
        assignedById: assignedById || req.user!.userId,
        reviewerId: reviewerId || null,
        taskType: taskType ?? null,
        dueDate: new Date(dueDate),
        assignedAt: new Date(),
        status: TaskStatus.TODO,
        priority: priority ?? Priority.MEDIUM,
        notes: notes || null,
        assignees: { create: people.map((userId) => ({ userId })) },
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: task.id,
        actorId: req.user!.userId,
        verb: 'task_created',
        payload: { title: task.title, workType: task.workType, assigneeIds: people },
      },
    });

    res.status(201).json({ success: true, task });
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
    dueDate: z.string().min(1).optional(),
    priority: z.nativeEnum(Priority).optional(),
    notes: z.string().max(4000).nullable().optional(),
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

    const { title, assigneeId, assigneeIds, assignedById, reviewerId, taskType, dueDate, priority, notes } = parsed.data;

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
        ...(taskType !== undefined ? { taskType } : {}),
        ...(dueDate !== undefined ? { dueDate: new Date(dueDate) } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(notes !== undefined ? { notes } : {}),
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

// ── 3c. Delete a Task, and put it back ──────────────────────────────────────
//
// §16: "Soft delete only. Nothing is ever hard deleted by a user." So this
// stamps `deletedAt`, every read of a Task filters it out, and `restore` below
// is what stops a soft delete from being a hard delete with extra steps.
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

tasksRouter.post('/:id/restore', requirePermission('work.own'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    // Deliberately looks for a DELETED one — the point of this route is to
    // find what every other query in this file is written to hide.
    const task = await prisma.task.findFirst({
      where: { id, organizationId: orgId, deletedAt: { not: null } },
    });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    if (!canRemove(req, task)) {
      res.status(403).json({
        success: false,
        error: 'Only the person who created this task, the person it is assigned to, or a Head can restore it',
      });
      return;
    }

    const restored = await prisma.task.update({ where: { id }, data: { deletedAt: null } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Task',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'task_restored',
        payload: { title: restored.title },
      },
    });

    res.json({ success: true, task: restored });
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

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED'] as const;
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
