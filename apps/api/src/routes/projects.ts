/**
 * Projects and tasks.
 *
 * A project belongs to the CLIENT and only to the client. What the client is on —
 * retainer or project, and at what price — is DISPLAYED on the project, read from
 * the company. Context, not a connection, so nothing needs re-pointing when an
 * engagement renews or ends (master plan §3.12).
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, atLeast, param, requireRole, requireModule, type AuthRequest } from '../middleware/auth.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { isBeforeToday, daysBetween } from '../utils/orgDay.js';
import { notifyTaskAssigned, notifyTaskInReview } from '../services/scanner.js';

export const projectsRouter = Router();

projectsRouter.use(authenticate, requireModule('PM'));

export type Health = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';

/**
 * Project health, computed.
 *
 * Never stored. A health flag someone sets by hand is green everywhere forever —
 * nobody remembers to go back and turn their own project amber (§4.8).
 */
export const computeHealth = (
  project: { status: string; dueDate: Date | null },
  openTasks: number,
  overdueTasks: number,
  timezone: string,
  now: Date = new Date(),
): Health => {
  if (project.status === 'COMPLETED' || project.status === 'CANCELLED') return 'ON_TRACK';
  if (project.dueDate && isBeforeToday(project.dueDate, timezone, now)) return 'OFF_TRACK';
  if (overdueTasks > 0) return 'AT_RISK';
  if (project.dueDate && openTasks > 0 && daysBetween(project.dueDate, now, timezone) <= 7) {
    return 'AT_RISK';
  }
  return 'ON_TRACK';
};

projectsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const org = await getOrgConfig(orgId);
    // Sales and above see every project; a Member sees the ones they are on.
    // Written as a rank comparison, not `role === 'MEMBER'` — an exact match on
    // a ladder catches one rung and silently admits every rung above it.
    const onlyTheirs = !atLeast(req.user!.role, 'SALES');

    const projects = await prisma.project.findMany({
      where: {
        organizationId: orgId,
        ...(req.query.companyId ? { companyId: String(req.query.companyId) } : {}),
        // A Member sees the projects they are on, not every project in the agency.
        // Row-level filtering rather than a 403: people should see their own world
        // rather than hit walls (§3.10).
        ...(onlyTheirs
          ? {
              OR: [
                { members: { some: { userId: req.user!.userId } } },
                { ownerId: req.user!.userId },
                // Nobody is added to ProjectMember yet — that endpoint does not
                // exist (backlog item 8) — so an assigned task is the only
                // evidence most people have of being on a project. Without this
                // a Member's project list is empty while their task list is not.
                { tasks: { some: { assigneeId: req.user!.userId } } },
              ],
            }
          : {}),
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            status: true,
            // The amount is not selected, not merely withheld. Fetching a figure
            // you must not send is how it ends up in a response six months later,
            // when somebody spreads the object to add a field.
            engagements: {
              where: { status: 'ACTIVE' },
              select: { id: true, type: true, billingFrequency: true },
            },
          },
        },
        owner: { select: { id: true, name: true, avatar: true } },
        members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        tasks: { select: { id: true, status: true, dueDate: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const now = new Date();

    res.json({
      success: true,
      data: projects.map((p) => {
        const open = p.tasks.filter((t) => t.status !== 'DONE');
        const overdue = open.filter((t) => t.dueDate && isBeforeToday(t.dueDate, org.timezone, now));

        return {
          ...p,
          tasks: undefined,
          taskCount: p.tasks.length,
          openTaskCount: open.length,
          overdueTaskCount: overdue.length,
          health: computeHealth(p, open.length, overdue.length, org.timezone, now),
          // What the client is ON, which is context for delivery: retainer work
          // keeps arriving, project work ends (§3.12). The AMOUNT is deliberately
          // absent for every role — these are the project screens, and a price is
          // not something delivery is deciding. Whoever needs the number opens
          // the client in CRM or Revenue, where the question belongs.
          engagementContext: p.company.engagements.map((e) => ({
            type: e.type,
            billingFrequency: e.billingFrequency,
          })),
          company: { id: p.company.id, name: p.company.name, status: p.company.status },
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

const projectSchema = z.object({
  companyId: z.string().min(1, 'A project belongs to a client.'),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  scope: z.string().optional().nullable(),
  platform: z.string().optional().nullable(),
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  memberIds: z.array(z.string()).optional(),
});

projectsRouter.post('/', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const company = await prisma.company.findFirst({
      where: { id: parsed.data.companyId, organizationId: orgId },
      select: { id: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }

    const { memberIds, ...data } = parsed.data;
    const project = await prisma.project.create({
      data: {
        ...data,
        organizationId: orgId,
        ownerId: data.ownerId ?? req.user!.userId,
        ...(memberIds?.length
          ? { members: { create: memberIds.map((userId) => ({ userId })) } }
          : {}),
      },
    });

    res.status(201).json({ success: true, data: project });
  } catch (e) {
    next(e);
  }
});

projectsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = await getOrgConfig(req.user!.organizationId);
    const project = await prisma.project.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            status: true,
            // The same rule as the list, and it was NOT the same here: this
            // included the whole engagement, so a project page handed every role
            // the retainer amount while the list carefully withheld it. One
            // endpoint enforcing a rule and its neighbour assembling around it
            // is the shape of nearly every leak found so far.
            engagements: {
              where: { status: 'ACTIVE' },
              select: { id: true, type: true, billingFrequency: true, startDate: true, endDate: true },
            },
          },
        },
        owner: { select: { id: true, name: true, avatar: true } },
        members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, avatar: true } },
            reviewer: { select: { id: true, name: true, avatar: true } },
          },
          orderBy: [{ status: 'asc' }, { position: 'asc' }],
        },
        activities: { orderBy: { occurredAt: 'desc' }, take: 50 },
      },
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const now = new Date();
    const open = project.tasks.filter((t) => t.status !== 'DONE');
    const overdue = open.filter((t) => t.dueDate && isBeforeToday(t.dueDate, org.timezone, now));

    res.json({
      success: true,
      data: { ...project, health: computeHealth(project, open.length, overdue.length, org.timezone, now) },
    });
  } catch (e) {
    next(e);
  }
});

// ── Members ──────────────────────────────────────────────────────────────────

const updateProjectSchema = z.object({
  companyId: z.string().optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  scope: z.string().optional().nullable(),
  platform: z.string().optional().nullable(),
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  memberIds: z.array(z.string()).optional(),
});

projectsRouter.patch('/:id', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const project = await prisma.project.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const { memberIds, ...data } = parsed.data;

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...data,
        ...(memberIds !== undefined
          ? {
              members: {
                deleteMany: {},
                ...(memberIds.length ? { create: memberIds.map((userId) => ({ userId })) } : {}),
              },
            }
          : {}),
      },
    });

    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});


projectsRouter.get('/:id/members', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId: param(req, 'id'), project: { organizationId: req.user!.organizationId } },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { addedAt: 'asc' },
    });
    res.json({ success: true, data: members });
  } catch (e) {
    next(e);
  }
});

/**
 * Add a member to a project.
 *
 * Like assigning a task, staffing a project is Manager and above.
 */
projectsRouter.post('/:id/members', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.body ?? {};
    if (!userId) {
      res.status(400).json({ success: false, error: 'A user is required.' });
      return;
    }

    const projectId = param(req, 'id');
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      update: {}, // if already a member, do nothing
      create: { projectId, userId },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    res.status(201).json({ success: true, data: member });
  } catch (e) {
    next(e);
  }
});

projectsRouter.delete('/:id/members/:userId', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = param(req, 'id');
    const userId = param(req, 'userId');
    
    // Ensure project exists and belongs to org
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: req.user!.organizationId },
    });
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    await prisma.projectMember.deleteMany({
      where: { projectId, userId },
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── Tasks ────────────────────────────────────────────────────────────────────

const taskSchema = z
  .object({
    projectId: z.string().optional().nullable(),
    dealId: z.string().optional().nullable(),
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    taskType: z.string().optional().nullable(),
    status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED', 'DONE', 'BLOCKED', 'ON_HOLD']).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    assigneeId: z.string().optional().nullable(),
    /** Separate from the assignee: agency work is checked before a client sees it. */
    reviewerId: z.string().optional().nullable(),
    dueDate: z.coerce.date().optional().nullable(),
    parentTaskId: z.string().optional().nullable(),
    recurrence: z.object({
      frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
      interval: z.number().optional(),
    }).optional().nullable(),
  })
  .refine((v) => Boolean(v.projectId) !== Boolean(v.dealId), {
    message: 'A task belongs to exactly one of a project or a deal — never both, never neither.',
  });

/**
 * Create a task.
 *
 * Anybody may write down their own work. **Giving work to somebody else is
 * staffing**, and staffing is Manager and above (§3.10, "assign people to work").
 * Below that, the task is forced onto the person creating it rather than
 * refused — writing your own to-do is not the thing being restricted, and a 403
 * for leaving a field blank would be a confusing way to say so.
 */
projectsRouter.post('/tasks', requireRole('MEMBER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const canStaff = atLeast(req.user!.role, 'MANAGER');
    if (!canStaff && parsed.data.assigneeId && parsed.data.assigneeId !== req.user!.userId) {
      res.status(403).json({
        success: false,
        error: 'You can only create work for yourself. Ask a manager to assign it to somebody else.',
      });
      return;
    }

    const task = await prisma.task.create({
      data: {
        ...parsed.data,
        assigneeId: canStaff ? parsed.data.assigneeId : req.user!.userId,
        // A reviewer is also a person being given work.
        reviewerId: canStaff ? parsed.data.reviewerId : null,
        organizationId: req.user!.organizationId,
        ...(parsed.data.recurrence !== undefined ? { recurrence: parsed.data.recurrence as any } : {}),
      },
      include: { project: { select: { id: true, name: true } } },
    });

    // Notify immediately — a task notification that waits until tomorrow arrives
    // after the standup where it mattered.
    if (task.assigneeId && task.assigneeId !== req.user!.userId) {
      notifyTaskAssigned({
        id: task.id,
        title: task.title,
        assigneeId: task.assigneeId,
        projectId: task.project?.id,
        projectName: task.project?.name,
      }).catch(() => {}); // fire-and-forget: a failed notification must not fail the create
    }

    res.status(201).json({ success: true, data: task });
  } catch (e) {
    next(e);
  }
});

projectsRouter.get('/tasks/all', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = await getOrgConfig(req.user!.organizationId);
    
    const { companyId, projectId, status, departmentId, assigneeId, priority, taskType } = req.query;

    const parseMultiFilter = (val: unknown) => {
      if (!val) return undefined;
      const list = String(val).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) return undefined;
      if (list.length === 1) return list[0];
      return { in: list };
    };

    const statusFilter = parseMultiFilter(status);
    const taskTypeFilter = parseMultiFilter(taskType);
    const companyFilter = parseMultiFilter(companyId);
    const projectFilter = parseMultiFilter(projectId);
    const departmentFilter = parseMultiFilter(departmentId);
    const assigneeFilter = parseMultiFilter(assigneeId);
    const priorityFilter = parseMultiFilter(priority);

    const whereClause: any = {
      organizationId: req.user!.organizationId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(taskTypeFilter ? { taskType: taskTypeFilter } : {}),
      ...(companyFilter ? { project: { companyId: companyFilter } } : {}),
      ...(projectFilter ? { projectId: projectFilter } : {}),
      ...(departmentFilter ? { departmentId: departmentFilter } : {}),
      ...(assigneeFilter ? { assigneeId: assigneeFilter } : {}),
      ...(priorityFilter ? { priority: priorityFilter } : {}),
    };

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
        deal: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true, avatar: true, designation: true } },
        reviewer: { select: { id: true, name: true, avatar: true, designation: true } },
        department: { select: { id: true, name: true } }
      },
      orderBy: [{ dueDate: 'asc' }],
    });

    const now = new Date();
    res.json({
      success: true,
      data: tasks.map((t) => ({
        ...t,
        isOverdue: Boolean(
          t.dueDate &&
          isBeforeToday(t.dueDate, org.timezone, now) &&
          t.status !== 'DONE' &&
          t.status !== 'ON_HOLD' &&
          t.status !== 'BLOCKED'
        ),
        awaitingMyReview: t.reviewerId === req.user!.userId && t.status === 'IN_REVIEW',
      })),
    });
  } catch (e) {
    next(e);
  }
});

projectsRouter.get('/tasks/mine', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = await getOrgConfig(req.user!.organizationId);
    const tasks = await prisma.task.findMany({
      where: {
        organizationId: req.user!.organizationId,
        status: { not: 'DONE' },
        OR: [{ assigneeId: req.user!.userId }, { reviewerId: req.user!.userId }],
      },
      include: {
        project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
        deal: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true, avatar: true, designation: true } },
        reviewer: { select: { id: true, name: true, avatar: true, designation: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ dueDate: 'asc' }],
    });

    const now = new Date();
    res.json({
      success: true,
      data: tasks.map((t) => ({
        ...t,
        isOverdue: Boolean(
          t.dueDate &&
          isBeforeToday(t.dueDate, org.timezone, now) &&
          t.status !== 'DONE' &&
          t.status !== 'ON_HOLD' &&
          t.status !== 'BLOCKED'
        ),
        // Work sitting with a reviewer is neither done nor in progress.
        awaitingMyReview: t.reviewerId === req.user!.userId && t.status === 'IN_REVIEW',
      })),
    });
  } catch (e) {
    next(e);
  }
});

projectsRouter.patch('/tasks/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.task.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      select: { id: true, assigneeId: true, status: true, reviewerId: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    // Changing somebody else's work is STAFFING, which is Manager and above
    // (§3.10). Sales and Member both get "own" on tasks.
    //
    // This compared `role === 'MEMBER'` — an exact match on a ladder, so it
    // caught the bottom rung and let every rung above it through. A salesperson
    // could rename and close delivery work assigned to anyone. Comparing rank is
    // the rule everywhere else in this codebase, and it is the rule here.
    const canStaff = atLeast(req.user!.role, 'MANAGER');
    const isOwn = existing.assigneeId === req.user!.userId;
    if (!canStaff && !isOwn) {
      res.status(403).json({ success: false, error: 'You can only edit your own tasks.' });
      return;
    }

    const parsed = taskSchema.innerType().partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    // A non-manager editing their own task cannot change who it belongs to.
    if (!canStaff && parsed.data.assigneeId && parsed.data.assigneeId !== existing.assigneeId) {
      res.status(403).json({ success: false, error: 'Only a manager can reassign work.' });
      return;
    }

    // A non-manager editing their own task cannot change its reviewer.
    if (
      !canStaff &&
      parsed.data.reviewerId !== undefined &&
      parsed.data.reviewerId !== existing.reviewerId
    ) {
      res.status(403).json({ success: false, error: 'Only a manager can assign a reviewer.' });
      return;
    }

    // Enforcement: Only the assigned reviewer (or a manager) can approve a task in review (or transition from IN_REVIEW to APPROVED/DONE).
    const isApproving =
      (parsed.data.status === 'APPROVED' || parsed.data.status === 'DONE') &&
      existing.status === 'IN_REVIEW';
    const isReviewer = existing.reviewerId === req.user!.userId;

    if (isApproving && !canStaff && !isReviewer) {
      res.status(403).json({
        success: false,
        error: 'Only the assigned reviewer can approve tasks that are under review.',
      });
      return;
    }

    const { recurrence, ...restData } = parsed.data;

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...restData,
        ...(parsed.data.status === 'DONE' && existing.status !== 'DONE'
          ? { completedAt: new Date() }
          : {}),
        ...(parsed.data.status && parsed.data.status !== 'DONE' && existing.status === 'DONE'
          ? { completedAt: null }
          : {}),
        ...(recurrence !== undefined ? { recurrence: recurrence ? (recurrence as any) : Prisma.DbNull } : {}),
      },
      include: {
        project: { select: { id: true, name: true, company: { select: { name: true } } } },
        deal: { select: { id: true, title: true } },
        assignee: { select: { id: true, name: true, avatar: true, designation: true } },
        reviewer: { select: { id: true, name: true, avatar: true, designation: true } },
        department: { select: { id: true, name: true } },
      },
    });

    if (task.status === 'DONE' && existing.status !== 'DONE' && task.recurrence && task.dueDate) {
      // Lazy import to avoid circular dependency since they are in different places? No, just standard import.
      const { spawnNextTask } = await import('../services/taskRecurrence.js');
      await spawnNextTask(task, req.user!.userId);
    }
    // Event-driven notifications — same reasoning as the create route.
    const assigneeChanged = parsed.data.assigneeId && parsed.data.assigneeId !== existing.assigneeId;
    if (assigneeChanged && task.assigneeId && task.assigneeId !== req.user!.userId) {
      notifyTaskAssigned({
        id: task.id,
        title: task.title,
        assigneeId: task.assigneeId,
        projectId: task.project?.id,
        projectName: task.project?.name,
      }).catch(() => {});
    }

    const movedToReview = parsed.data.status === 'IN_REVIEW' && existing.status !== 'IN_REVIEW';
    if (movedToReview && task.reviewerId && task.reviewerId !== req.user!.userId) {
      notifyTaskInReview({
        id: task.id,
        title: task.title,
        reviewerId: task.reviewerId,
        projectId: task.project?.id,
        projectName: task.project?.name,
      }).catch(() => {});
    }

    res.json({ success: true, data: task });
  } catch (e) {
    next(e);
  }
});

projectsRouter.delete('/tasks/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.task.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      select: { id: true, assigneeId: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const canStaff = atLeast(req.user!.role, 'MANAGER');
    const isOwn = existing.assigneeId === req.user!.userId;
    if (!canStaff && !isOwn) {
      res.status(403).json({ success: false, error: 'You can only delete your own tasks.' });
      return;
    }

    await prisma.task.delete({ where: { id } });
    res.json({ success: true, message: 'Task deleted' });
  } catch (e) {
    next(e);
  }
});
