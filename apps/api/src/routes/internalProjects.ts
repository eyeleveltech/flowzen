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
 * Gated on `work.all`, the same permission that opens the All tasks page:
 * naming a piece of the studio's own work is organising, not a commercial act.
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { InternalProjectStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { TASK_PEOPLE, withPeople } from './tasks.js';

export const internalProjectsRouter = Router();

// Every route below needs to know who is asking. Mounting the router without
// this left requirePermission reading an undefined user and answering 401 to
// everybody — the same shape every other router here uses.
internalProjectsRouter.use(authenticate);

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  status: z.nativeEnum(InternalProjectStatus).optional(),
});

/** Cancelled work is neither outstanding nor finished. */
const COUNTED = (s: string) => s !== 'CANCELLED';

/**
 * A row, with how its work is going.
 *
 * The same shape wherever one is listed, so a picker and a settings list
 * cannot disagree about how much is still open under a bucket.
 */
function summarise<T extends { tasks: { status: string; dueDate: Date }[] }>(p: T) {
  const today = new Date().toISOString().slice(0, 10);
  const counted = p.tasks.filter((t) => COUNTED(t.status));
  const done = counted.filter((t) => t.status === 'DONE').length;
  const late = counted.filter(
    (t) => t.status !== 'DONE' && new Date(t.dueDate).toISOString().slice(0, 10) < today,
  ).length;
  const { tasks: _dropped, ...rest } = p;
  return {
    ...rest,
    taskCounts: { total: counted.length, done, open: counted.length - done, late },
  };
}

const withTasks = {
  owner: { select: { id: true, name: true } },
  tasks: { where: { deletedAt: null }, select: { status: true, dueDate: true } },
} as const;

/**
 * GET /api/internal-projects
 *
 * `?status=ACTIVE` narrows it. The pickers ask for active ones; the settings
 * screen asks for everything, because a closed bucket still has to be findable
 * to be reopened.
 */
internalProjectsRouter.get(
  '/',
  requirePermission('work.all'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
      const rows = await prisma.internalProject.findMany({
        where: {
          organizationId: req.user!.organizationId,
          ...(status && status in InternalProjectStatus
            ? { status: status as InternalProjectStatus }
            : {}),
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        include: withTasks,
      });
      res.json({ success: true, projects: rows.map(summarise) });
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
      const project = await prisma.internalProject.findFirst({
        where: { id: String(req.params.id), organizationId: req.user!.organizationId },
        include: {
          owner: { select: { id: true, name: true } },
          tasks: {
            where: { deletedAt: null },
            orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
            include: TASK_PEOPLE,
          },
        },
      });
      if (!project) {
        res.status(404).json({ success: false, error: 'Not found' });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const counted = project.tasks.filter((t) => COUNTED(t.status));
      const done = counted.filter((t) => t.status === 'DONE').length;

      res.json({
        success: true,
        project: {
          ...project,
          tasks: project.tasks.map((t) => ({
            ...withPeople(t),
            // The same flag every other task list computes, so a row reads the
            // same here as it does on My Work.
            isOverdue: t.status !== 'DONE' && t.status !== 'CANCELLED' && t.dueDate.toISOString().slice(0, 10) < today,
          })),
          taskCounts: {
            total: counted.length,
            done,
            open: counted.length - done,
            late: counted.filter(
              (t) => t.status !== 'DONE' && t.dueDate.toISOString().slice(0, 10) < today,
            ).length,
          },
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

      const project = await prisma.internalProject.create({
        data: {
          organizationId: orgId,
          name: parsed.data.name,
          description: parsed.data.description || null,
          ownerId: parsed.data.ownerId || null,
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

      res.status(201).json({ success: true, project: summarise(project) });
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
        select: { id: true, name: true, status: true },
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

      const project = await prisma.internalProject.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
          ...(parsed.data.ownerId !== undefined ? { ownerId: parsed.data.ownerId || null } : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
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

      res.json({ success: true, project: summarise(project) });
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
