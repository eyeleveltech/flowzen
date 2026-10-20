/**
 * The studio's own work, in named pieces.
 *
 * An internal task carried `workType: INTERNAL` and nothing else — no month
 * card, no project, no bucket of any kind — so the website refresh, a hiring
 * round, GST filing prep and an office Wi-Fi renewal all sat in one flat list,
 * told apart only by whoever happened to be holding them.
 *
 * This is `RetainerProject` with the retainer taken off: a bucket that groups
 * tasks and holds no money. There is no company on it, no value, no invoice,
 * and no cost column points at it — so it cannot drift into being something
 * that gets billed. That is the whole point of it, and the schema is what
 * keeps it true rather than a rule somebody has to remember.
 *
 * Since the Internal work plan a project can also carry optional start and
 * target dates and an owning department, and every read says how it is going:
 * % done, open and overdue, the next task due, who is on it, and the days to
 * its target (services/internalWork.ts). A one-off internal job needs none of
 * this — it is filed under "No project" instead.
 *
 * Gated on `work.all`, the same permission that opens the All tasks page:
 * naming a piece of the studio's own work is organising, not a commercial act.
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { InternalProjectStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { TASK_PEOPLE, withPeople } from './tasks.js';
import { taskHasClient, waitingOnShown } from '../services/taskWaiting.js';
import { withRepeatNext } from '../services/taskRepeat.js';
import { taskInScope } from '../services/teamScope.js';
import { isLate, NO_PROJECT_WHERE, projectProgress, UNFINISHED } from '../services/internalWork.js';
import { asStoredDay, moneyClock, orgToday } from '../utils/moneyDates.js';

export const internalProjectsRouter = Router();

// Every route below needs to know who is asking. Mounting the router without
// this left requirePermission reading an undefined user and answering 401 to
// everybody — the same shape every other router here uses.
internalProjectsRouter.use(authenticate);

/** A calendar day, "2026-10-20", or null to clear it. */
const dayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
  .nullable()
  .optional();

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  status: z.nativeEnum(InternalProjectStatus).optional(),
  startDate: dayField,
  targetDate: dayField,
  departmentId: z.string().min(1).optional().nullable(),
});
type Body = z.infer<typeof bodySchema>;

/** The studio's today — where it is, not where the server is. */
const studioToday = async (orgId: string) => orgToday((await moneyClock(orgId)).timezone);

/**
 * A row, with how its work is going.
 *
 * The same shape wherever one is listed, so a picker and the Live work list
 * cannot disagree about how much is still open under a bucket. `taskCounts` is
 * kept for the screens that read it; `progress` is the fuller answer.
 */
function summarise<T extends { status: string; targetDate: Date | null; tasks: Parameters<typeof projectProgress>[1] }>(
  p: T,
  today: string,
) {
  const progress = projectProgress(p, p.tasks, today);
  const { tasks: _dropped, ...rest } = p;
  return {
    ...rest,
    taskCounts: { total: progress.total, done: progress.done, open: progress.open, late: progress.overdue },
    progress,
  };
}

const withTasks = {
  owner: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  tasks: {
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      assignees: { select: { user: { select: { id: true, name: true } } } },
    },
  },
} as const;

/**
 * The dates and the department, checked. Null when they are fine, otherwise
 * the sentence to answer with.
 */
async function fieldsRefusal(
  orgId: string,
  data: Partial<Body>,
  existing?: { startDate: Date | null; targetDate: Date | null },
): Promise<string | null> {
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const start = data.startDate !== undefined ? data.startDate : day(existing?.startDate);
  const target = data.targetDate !== undefined ? data.targetDate : day(existing?.targetDate);
  if (start && target && target < start) return "The target date can't be before the start date.";
  if (data.departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: data.departmentId, organizationId: orgId, archivedAt: null },
      select: { id: true },
    });
    if (!dept) return 'That department is not one of yours.';
  }
  return null;
}

/** The optional fields, as written to the row. */
const optionalFields = (data: Partial<Body>) => ({
  ...(data.startDate !== undefined ? { startDate: data.startDate ? asStoredDay(data.startDate) : null } : {}),
  ...(data.targetDate !== undefined ? { targetDate: data.targetDate ? asStoredDay(data.targetDate) : null } : {}),
  ...(data.departmentId !== undefined ? { departmentId: data.departmentId || null } : {}),
});

/**
 * GET /api/internal-projects
 *
 * `?status=ACTIVE` narrows it. The pickers ask for active ones; the settings
 * screen asks for everything, because a closed bucket still has to be findable
 * to be reopened.
 */
/*
 * Reading the list needs only `work.own`.
 *
 * It was `work.all`, which is Head and Management — so the required "Which
 * work" picker on every task form came back empty for everybody else, and once
 * that field was required they could not write down an internal task at all.
 *
 * A bucket is a name. There is no client on it, no value, no invoice, and no
 * cost can point at one, so there is nothing here to protect: anybody who can
 * hold a task can see what the studio's own work is called. MAKING and
 * CHANGING them stays `work.all` — every route below this one.
 *
 * `general` is the open and overdue count of internal tasks filed under no
 * project — the pinned "General — no project" card on Live work. Counted
 * within the caller's scope, so it matches the All work list it opens.
 */
internalProjectsRouter.get(
  '/',
  requirePermission('work.own'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
      const [rows, today] = await Promise.all([
        prisma.internalProject.findMany({
          where: {
            organizationId: orgId,
            ...(status && status in InternalProjectStatus ? { status: status as InternalProjectStatus } : {}),
          },
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
          include: withTasks,
        }),
        studioToday(orgId),
      ]);
      const general = await prisma.task.findMany({
        where: await taskInScope(req.user!, {
          organizationId: orgId,
          deletedAt: null,
          ...NO_PROJECT_WHERE,
          status: { in: [...UNFINISHED] },
        }),
        select: { status: true, dueDate: true },
      });
      res.json({
        success: true,
        today,
        projects: rows.map((r) => summarise(r, today)),
        general: { open: general.length, overdue: general.filter((t) => isLate(t, today)).length },
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * GET /api/internal-projects/:id
 *
 * One bucket and everything filed under it. The list endpoint carries counts;
 * this carries the tasks themselves, because the page it feeds is where the
 * work is actually read and added to.
 */
internalProjectsRouter.get(
  '/:id',
  requirePermission('work.all'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const [project, today] = await Promise.all([
        prisma.internalProject.findFirst({
          where: { id: String(req.params.id), organizationId: orgId },
          include: {
            owner: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
            tasks: {
              where: { deletedAt: null },
              orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
              include: TASK_PEOPLE,
            },
          },
        }),
        studioToday(orgId),
      ]);
      if (!project) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }

      const progress = projectProgress(project, project.tasks, today);

      res.json({
        success: true,
        today,
        project: {
          ...project,
          tasks: await withRepeatNext(
            orgId,
            project.tasks.map((t) => ({
              ...withPeople(t),
              // The same flag every other task list computes, so a row reads the
              // same here as it does on My Work.
              isOverdue: isLate(t, today),
              // Internal work: an old "waiting on the client" hold shows as plain On hold (QA19, F06).
              waitingOn: waitingOnShown(t),
              hasClient: taskHasClient(t),
            })),
          ),
          taskCounts: { total: progress.total, done: progress.done, open: progress.open, late: progress.overdue },
          progress,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

internalProjectsRouter.post(
  '/',
  requirePermission('work.all'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;

      // Answered here rather than as a unique-constraint 500: two buckets with
      // the same name are indistinguishable in every picker that lists them.
      const clash = await prisma.internalProject.findFirst({
        where: { organizationId: orgId, name: parsed.data.name },
        select: { id: true },
      });
      if (clash) {
        res.status(409).json({ success: false, error: `There is already one called '${parsed.data.name}'.` });
        return;
      }
      const refused = await fieldsRefusal(orgId, parsed.data);
      if (refused) {
        res.status(400).json({ success: false, error: refused });
        return;
      }

      const project = await prisma.internalProject.create({
        data: {
          organizationId: orgId,
          name: parsed.data.name,
          description: parsed.data.description || null,
          ownerId: parsed.data.ownerId || null,
          ...optionalFields(parsed.data),
        },
        include: withTasks,
      });

      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'InternalProject',
          entityId: project.id,
          actorId: req.user!.userId,
          verb: 'internal_project_created',
          payload: { name: project.name },
        },
      });

      res.status(201).json({ success: true, project: summarise(project, await studioToday(orgId)) });
    } catch (e) {
      next(e);
    }
  },
);

internalProjectsRouter.patch(
  '/:id',
  requirePermission('work.all'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = bodySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);

      const existing = await prisma.internalProject.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, name: true, status: true, startDate: true, targetDate: true },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }

      if (parsed.data.name && parsed.data.name !== existing.name) {
        const clash = await prisma.internalProject.findFirst({
          where: { organizationId: orgId, name: parsed.data.name, id: { not: id } },
          select: { id: true },
        });
        if (clash) {
          res.status(409).json({ success: false, error: `There is already one called '${parsed.data.name}'.` });
          return;
        }
      }
      const refused = await fieldsRefusal(orgId, parsed.data, existing);
      if (refused) {
        res.status(400).json({ success: false, error: refused });
        return;
      }

      const project = await prisma.internalProject.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
          ...(parsed.data.ownerId !== undefined ? { ownerId: parsed.data.ownerId || null } : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          ...optionalFields(parsed.data),
        },
        include: withTasks,
      });

      if (parsed.data.status && parsed.data.status !== existing.status) {
        await prisma.activity.create({
          data: {
            organizationId: orgId,
            entityType: 'InternalProject',
            entityId: id,
            actorId: req.user!.userId,
            verb: 'internal_project_status_changed',
            payload: { name: project.name, from: existing.status, to: parsed.data.status },
          },
        });
      }

      res.json({ success: true, project: summarise(project, await studioToday(orgId)) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * DELETE /api/internal-projects/:id
 *
 * Only an empty one. A bucket with work under it is closed (status DONE), not
 * deleted: the foreign key is SetNull, so deleting one would quietly unfile
 * every task that had been put in it and there would be no way to tell that
 * from tasks that were never filed. Closing keeps the answer.
 */
internalProjectsRouter.delete(
  '/:id',
  requirePermission('work.all'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const id = String(req.params.id);

      const existing = await prisma.internalProject.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, name: true, _count: { select: { tasks: true } } },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }
      if (existing._count.tasks > 0) {
        res.status(400).json({
          success: false,
          error: `${existing.name} has ${existing._count.tasks} task(s) under it. Mark it done instead — deleting it would unfile them with no record of where they had been.`,
        });
        return;
      }

      await prisma.internalProject.delete({ where: { id } });
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'InternalProject',
          entityId: id,
          actorId: req.user!.userId,
          verb: 'internal_project_deleted',
          payload: { name: existing.name },
        },
      });

      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  },
);
