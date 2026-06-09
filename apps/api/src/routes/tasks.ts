import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization, emitToUser } from '../sse.js';
import { NotificationService } from '../services/notifications.js';
import { executeWorkflowRules } from '../services/workflowEngine.js';
import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';
import { idempotency } from '../middleware/idempotency.js';

export const taskRouter = Router();
taskRouter.use(authenticate);

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['DESIGN', 'CONTENT', 'VIDEO', 'DIGITAL_MARKETING', 'DEVELOPMENT', 'STRATEGY', 'OTHER']).optional(),
  projectId: z.string(),
  assigneeId: z.string().optional().nullable(),
  reviewerId: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'BLOCKED', 'COMPLETED']).optional(),
  dueDate: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  loggedHours: z.number().optional().nullable(),
  estimatedHours: z.number().optional().nullable(),
  driveLink: z.string().optional().nullable(),
});

// GET /api/tasks
taskRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { search, status, priority, projectId, assigneeId, type, clientId, page = '1', limit = '50' } = req.query;

    const projectFilter: any = { client: { organizationId: orgId } };
    if (clientId) projectFilter.clientId = clientId as string;
    
    const where: Record<string, unknown> = { project: projectFilter };
    if (status) where.status = status as string;
    if (priority) where.priority = priority as string;
    if (type) where.type = type as string;
    if (projectId) where.projectId = projectId;
    
    if (req.user!.role === 'TEAM_MEMBER') {
      where.assigneeId = req.user!.userId;
    } else if (assigneeId) {
      where.assigneeId = assigneeId;
    }
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where: where as any,
        include: {
          project: { select: { id: true, name: true, color: true } },
          assignee: { select: { id: true, name: true, avatar: true } },
          reviewer: { select: { id: true, name: true, avatar: true } },
          _count: { select: { subtasks: true, comments: true, checklist: true } },
        },
        orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: parseInt(limit as string),
      }),
      prisma.task.count({ where: where as any }),
    ]);

    res.json({ tasks, total, page: parseInt(page as string), totalPages: Math.ceil(total / parseInt(limit as string)) });
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id
taskRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: (req.params.id as string), project: { client: { organizationId: req.user!.organizationId } } },
      include: {
        project: { select: { id: true, name: true, color: true } },
        assignee: { select: { id: true, name: true, avatar: true, email: true } },
        reviewer: { select: { id: true, name: true, avatar: true, email: true } },
        subtasks: {
          include: { assignee: { select: { id: true, name: true, avatar: true } } },
          orderBy: { order: 'asc' },
        },
        comments: {
          include: { author: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'asc' },
        },
        checklist: { orderBy: { order: 'asc' } },
        activities: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (req.user!.role === 'TEAM_MEMBER' && task.assigneeId !== req.user!.userId) {
      res.status(403).json({ error: 'You do not have permission to view this task' });
      return;
    }

    res.json(task);
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks — Create a task (Idempotent)
taskRouter.post('/', idempotency, validate(taskSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    if (req.user!.role === 'TEAM_MEMBER') {
      const isMember = await prisma.projectMember.findFirst({
        where: { projectId: req.body.projectId, userId: req.user!.userId }
      });
      
      let isTeamMember = false;
      if (!isMember) {
        const projectTeams = await prisma.projectTeam.findMany({
          where: { projectId: req.body.projectId },
          include: { team: { include: { members: true } } }
        });
        isTeamMember = projectTeams.some((pt: any) => pt.team.members.some((m: any) => m.id === req.user!.userId));
      }

      if (!isMember && !isTeamMember) {
        res.status(403).json({ error: 'You are not a member of this project' });
        return;
      }
    }

    const { title, description, type, projectId, assigneeId, reviewerId, priority, status, dueDate, parentId, estimatedHours, driveLink } = req.body;

    const task = await prisma.task.create({
      data: {
        title,
        description,
        type: type || 'OTHER',
        projectId,
        assigneeId,
        reviewerId,
        priority: priority || 'MEDIUM',
        status: status || 'TODO',
        dueDate: dueDate ? new Date(dueDate) : null,
        parentId,
        estimatedHours,
        driveLink,
        order: await prisma.task.count({ where: { projectId, parentId: parentId || null } }),
      },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        reviewer: { select: { id: true, name: true, avatar: true } },
      },
    });

    await prisma.activity.create({
      data: {
        type: 'TASK_CREATED',
        message: `created task "${task.title}"`,
        entityType: 'TASK',
        entityId: task.id,
        userId: req.user!.userId,
        taskId: task.id,
        projectId: task.projectId,
      },
    });

    // Notify assignee
    if (task.assigneeId && task.assigneeId !== req.user!.userId) {
      await NotificationService.send({
        type: 'TASK_ASSIGNED',
        message: `You were assigned to "${task.title}"`,
        userId: task.assigneeId,
        metadata: { taskId: task.id, projectId: task.projectId },
      });
    }

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'task:created', task);
    await invalidateOrganizationCache(req.user!.organizationId);

    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/:id
taskRouter.put('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: (req.params.id as string), project: { client: { organizationId: req.user!.organizationId } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (req.user!.role === 'TEAM_MEMBER' && existing.assigneeId !== req.user!.userId) {
      res.status(403).json({ error: 'You do not have permission to edit this task' });
      return;
    }

    const task = await prisma.task.update({
      where: { id: (req.params.id as string) },
      data: {
        ...req.body,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : req.body.dueDate === null ? null : undefined,
        ...(req.body.status === 'COMPLETED' && existing.status !== 'COMPLETED' 
             ? { completedAt: new Date() } 
             : req.body.status && req.body.status !== 'COMPLETED' && existing.status === 'COMPLETED'
               ? { completedAt: null }
               : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        reviewer: { select: { id: true, name: true, avatar: true } },
      },
    });

    // Log status changes
    if (existing.status !== task.status) {
      await prisma.activity.create({
        data: {
          type: task.status === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
          message: `changed task "${task.title}" status to ${task.status}`,
          entityType: 'TASK',
          entityId: task.id,
          userId: req.user!.userId,
          taskId: task.id,
          projectId: task.projectId,
        },
      });

      // Update project progress
      const projectTasks = await prisma.task.findMany({
        where: { projectId: task.projectId, parentId: null },
        select: { status: true },
      });
      const completed = projectTasks.filter((t) => t.status === 'COMPLETED').length;
      const progress = projectTasks.length > 0 ? Math.round((completed / projectTasks.length) * 100) : 0;
      await prisma.project.update({
        where: { id: task.projectId },
        data: { progress },
      });

      // Execute workflow automation rules
      await executeWorkflowRules('TASK_STATUS_CHANGE', {
        task,
        oldStatus: existing.status,
        newStatus: task.status,
        orgId: req.user!.organizationId,
      });
    }

    // Notify if assignee changed
    if (req.body.assigneeId && req.body.assigneeId !== existing.assigneeId && req.body.assigneeId !== req.user!.userId) {
      await NotificationService.send({
        type: 'TASK_ASSIGNED',
        message: `You were assigned to "${task.title}"`,
        userId: req.body.assigneeId,
        metadata: { taskId: task.id, projectId: task.projectId },
      });

      // Execute workflow automation rules for assignment
      await executeWorkflowRules('TASK_ASSIGNED', {
        task,
        orgId: req.user!.organizationId,
      });
    }

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'task:updated', task);
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json(task);
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/:id/status — Quick status update (Idempotent)
taskRouter.put('/:id/status', idempotency, async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: (req.params.id as string), project: { client: { organizationId: req.user!.organizationId } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (req.user!.role === 'TEAM_MEMBER' && existing.assigneeId !== req.user!.userId) {
      res.status(403).json({ error: 'You do not have permission to edit this task' });
      return;
    }

    const { status } = req.body;
    const task = await prisma.task.update({
      where: { id: (req.params.id as string) },
      data: {
        status: status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
    });

    // Update progress
    const projectTasks = await prisma.task.findMany({
      where: { projectId: task.projectId, parentId: null },
      select: { status: true },
    });
    const completed = projectTasks.filter((t) => t.status === 'COMPLETED').length;
    const progress = projectTasks.length > 0 ? Math.round((completed / projectTasks.length) * 100) : 0;
    await prisma.project.update({
      where: { id: task.projectId },
      data: { progress },
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'task:updated', task);
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json(task);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id
taskRouter.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: (req.params.id as string), project: { client: { organizationId: req.user!.organizationId } } },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (req.user!.role === 'TEAM_MEMBER' && task.assigneeId !== req.user!.userId) {
      res.status(403).json({ error: 'You do not have permission to delete this task' });
      return;
    }

    await prisma.task.delete({ where: { id: (req.params.id as string) } });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'task:deleted', { id: (req.params.id as string), projectId: task.projectId });
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json({ message: 'Task deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/comments
taskRouter.post('/:id/comments', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: (req.params.id as string), project: { client: { organizationId: req.user!.organizationId } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (req.user!.role === 'TEAM_MEMBER') {
      const isMember = await prisma.projectMember.findFirst({
        where: { projectId: existing.projectId, userId: req.user!.userId }
      });
      let isTeamMember = false;
      if (!isMember) {
        const projectTeams = await prisma.projectTeam.findMany({
          where: { projectId: existing.projectId },
          include: { team: { include: { members: true } } }
        });
        isTeamMember = projectTeams.some((pt: any) => pt.team.members.some((m: any) => m.id === req.user!.userId));
      }
      if (!isMember && !isTeamMember) {
        res.status(403).json({ error: 'You are not a member of this project' });
        return;
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content: req.body.content,
        mentions: req.body.mentions || [],
        taskId: (req.params.id as string),
        authorId: req.user!.userId,
      },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'comment:created', { ...comment, taskId: (req.params.id as string) });

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/:id/checklist
taskRouter.put('/:id/checklist', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: (req.params.id as string), project: { client: { organizationId: req.user!.organizationId } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (req.user!.role === 'TEAM_MEMBER' && existing.assigneeId !== req.user!.userId) {
      res.status(403).json({ error: 'You do not have permission to edit this checklist' });
      return;
    }

    const { items } = req.body as { items: { id?: string; text: string; completed: boolean; order: number }[] };

    // Delete existing and recreate
    await prisma.checklistItem.deleteMany({ where: { taskId: (req.params.id as string) } });
    const checklist = await prisma.checklistItem.createMany({
      data: items.map((item, idx) => ({
        text: item.text,
        completed: item.completed,
        order: item.order ?? idx,
        taskId: (req.params.id as string),
      })),
    });

    const updated = await prisma.checklistItem.findMany({
      where: { taskId: (req.params.id as string) },
      orderBy: { order: 'asc' },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tasks/reorder
taskRouter.patch('/reorder', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tasks } = req.body as { tasks: { id: string; order: number; status?: string }[] };

    if (tasks.length > 0 && req.user!.role === 'TEAM_MEMBER') {
      const firstTask = await prisma.task.findUnique({ where: { id: tasks[0].id } });
      if (firstTask) {
        const isMember = await prisma.projectMember.findFirst({
          where: { projectId: firstTask.projectId, userId: req.user!.userId }
        });
        let isTeamMember = false;
        if (!isMember) {
          const projectTeams = await prisma.projectTeam.findMany({
            where: { projectId: firstTask.projectId },
            include: { team: { include: { members: true } } }
          });
          isTeamMember = projectTeams.some((pt: any) => pt.team.members.some((m: any) => m.id === req.user!.userId));
        }
        if (!isMember && !isTeamMember) {
          res.status(403).json({ error: 'You are not a member of this project' });
          return;
        }
      }
    }

    await prisma.$transaction(
      tasks.map((t) =>
        prisma.task.update({
          where: { id: t.id },
          data: { order: t.order, ...(t.status ? { status: t.status as any, ...(t.status === 'COMPLETED' ? { completedAt: new Date() } : { completedAt: null }) } : {}) },
        })
      )
    );

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'tasks:reordered', { tasks });
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json({ message: 'Tasks reordered' });
  } catch (error) {
    next(error);
  }
});
