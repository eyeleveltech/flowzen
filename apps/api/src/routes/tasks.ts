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
import { toList, whereIn } from '../utils/query.js';

export const taskRouter = Router();
taskRouter.use(authenticate);

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['DESIGN', 'CONTENT', 'VIDEO', 'DIGITAL_MARKETING', 'SOCIAL_MEDIA', 'DEVELOPMENT', 'STRATEGY', 'BUSINESS', 'OTHER']).optional(),
  projectId: z.string(),
  assigneeId: z.string().optional().nullable(),
  assigneeIds: z.array(z.string()).optional(),
  reviewerId: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'BLOCKED', 'COMPLETED']).optional(),
  dueDate: z.string().optional().nullable(),
  assignedDate: z.string().optional().nullable(),
  assignedById: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  loggedHours: z.number().optional().nullable(),
  estimatedHours: z.number().optional().nullable(),
  driveLink: z.string().optional().nullable(),
});

// GET /api/tasks
taskRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { search, status, priority, projectId, assigneeId, type, clientId, filter, teamId, sort, page = '1', limit = '50' } = req.query;

    const projectFilter: any = { client: { organizationId: orgId } };
    if (clientId) projectFilter.clientId = whereIn(clientId);

    const where: Record<string, unknown> = { project: projectFilter };
    if (status) where.status = whereIn(status);
    if (priority) where.priority = whereIn(priority);
    if (type) where.type = whereIn(type);
    if (projectId) where.projectId = whereIn(projectId);
    
    const andConditions: any[] = [];
    
    if (filter === 'overdue') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      where.dueDate = { lt: todayStart };
      if (!status) {
        where.status = { notIn: ['COMPLETED'] };
      }
    } else if (filter === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      if (!status) {
        andConditions.push({
          OR: [
            { dueDate: { lt: todayStart }, status: { notIn: ['COMPLETED'] } },
            { dueDate: { gte: todayStart, lte: todayEnd } }
          ]
        });
      } else {
        andConditions.push({
          OR: [
            { dueDate: { lt: todayStart } },
            { dueDate: { gte: todayStart, lte: todayEnd } }
          ]
        });
      }
    } else if (filter === 'approval') {
      where.status = 'REVIEW';
    }
    
    
    // Match either the primary assignee or any of the multi-assignees.
    const assigneeMatch = (uid: string) => ({ OR: [{ assigneeId: uid }, { assignees: { some: { id: uid } } }] });
    if (req.user!.role === 'TEAM_MEMBER') {
      andConditions.push(assigneeMatch(req.user!.userId));
    } else {
      const assigneeIds = toList(assigneeId);
      // Any of the selected assignees (primary or multi-assignee).
      if (assigneeIds) andConditions.push({ OR: assigneeIds.flatMap((uid) => assigneeMatch(uid).OR) });
    }
    if (teamId) {
      const teamIds = toList(teamId);
      if (teamIds) {
        andConditions.push({
          OR: [
            { assignee: { teamId: { in: teamIds } } },
            { assignees: { some: { teamId: { in: teamIds } } } }
          ]
        });
      }
    }
    if (search) {
      andConditions.push({
        OR: [
          { title: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
        ],
      });
    }
    if (andConditions.length) where.AND = andConditions;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where: where as any,
        include: {
          project: { select: { id: true, name: true, color: true } },
          assignee: { select: { id: true, name: true, avatar: true } },
          assignees: { select: { id: true, name: true, avatar: true } },
          assignedBy: { select: { id: true, name: true, avatar: true } },
          reviewer: { select: { id: true, name: true, avatar: true } },
          _count: { select: { subtasks: true, comments: true, checklist: true } },
        },
        orderBy: sort === 'dueDate_asc' ? [{ dueDate: 'asc' }]
               : sort === 'dueDate_desc' ? [{ dueDate: 'desc' }]
               : sort === 'createdAt_asc' ? [{ createdAt: 'asc' }]
               : sort === 'createdAt_desc' ? [{ createdAt: 'desc' }]
               : sort === 'updatedAt_asc' ? [{ updatedAt: 'asc' }]
               : sort === 'updatedAt_desc' ? [{ updatedAt: 'desc' }]
               : sort === 'project_asc' ? [{ project: { name: 'asc' } }]
               : sort === 'project_desc' ? [{ project: { name: 'desc' } }]
               : sort === 'priority_asc' ? [{ priority: 'asc' }]
               : sort === 'priority_desc' ? [{ priority: 'desc' }]
               : sort === 'status_asc' ? [{ status: 'asc' }]
               : sort === 'status_desc' ? [{ status: 'desc' }]
               : sort === 'title_asc' ? [{ title: 'asc' }]
               : sort === 'title_desc' ? [{ title: 'desc' }]
               : [{ priority: 'desc' }, { createdAt: 'desc' }],
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
        project: { select: { id: true, name: true, color: true, client: { select: { id: true, name: true, company: true } } } },
        client: { select: { id: true, name: true, company: true } },
        assignee: { select: { id: true, name: true, avatar: true, email: true } },
        assignees: { select: { id: true, name: true, avatar: true, email: true } },
        assignedBy: { select: { id: true, name: true, avatar: true, email: true } },
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

    const isAssignee = task.assigneeId === req.user!.userId || task.assignees.some((a) => a.id === req.user!.userId);
    if (req.user!.role === 'TEAM_MEMBER' && !isAssignee) {
      res.status(403).json({ error: 'You do not have permission to view this task' });
      return;
    }

    res.json(task);
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/bulk-approve
taskRouter.post('/bulk-approve', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      res.status(400).json({ error: 'Invalid taskIds' });
      return;
    }

    const tasks = await prisma.task.findMany({
      where: {
        id: { in: taskIds },
        status: 'REVIEW',
        project: { client: { organizationId: req.user!.organizationId } }
      }
    });

    const updatedTasks = await Promise.all(
      tasks.map(async (t) => {
        const updated = await prisma.task.update({
          where: { id: t.id },
          data: { status: 'APPROVED' }
        });

        await prisma.activity.create({
          data: {
            type: 'TASK_STATUS_CHANGED',
            message: `changed task "${updated.title}" status to APPROVED`,
            entityType: 'TASK',
            entityId: updated.id,
            userId: req.user!.userId,
            taskId: updated.id,
            projectId: updated.projectId,
          },
        });

        await executeWorkflowRules('TASK_STATUS_CHANGE', {
          task: updated,
          oldStatus: 'REVIEW',
          newStatus: 'APPROVED',
          orgId: req.user!.organizationId,
        });
        return updated;
      })
    );

    const uniqueProjectIds = Array.from(new Set(tasks.map(t => t.projectId).filter(Boolean))) as string[];
    await Promise.all(
      uniqueProjectIds.map(async (projectId) => {
        const projectTasks = await prisma.task.findMany({
          where: { projectId, parentId: null },
          select: { status: true },
        });
        const completed = projectTasks.filter((t) => t.status === 'COMPLETED').length;
        const progress = projectTasks.length > 0 ? Math.round((completed / projectTasks.length) * 100) : 0;
        await prisma.project.update({
          where: { id: projectId },
          data: { progress },
        });
      })
    );

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'task:updated', { taskIds: updatedTasks.map(t => t.id) });
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json({ success: true, count: updatedTasks.length });
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

    const { title, description, type, projectId, assigneeId, assigneeIds, reviewerId, assignedById, priority, status, dueDate, assignedDate, parentId, estimatedHours, driveLink } = req.body;

    // Multi-assignee: the first of the list is the "primary" assignee (kept in
    // assigneeId for back-compat); the full set lives in the assignees relation.
    const ids: string[] = Array.from(new Set(((assigneeIds?.length ? assigneeIds : (assigneeId ? [assigneeId] : [])) as string[]).filter(Boolean)));
    const primaryAssigneeId = ids[0] || null;

    const task = await prisma.task.create({
      data: {
        title,
        description,
        type: type || 'OTHER',
        projectId,
        assigneeId: primaryAssigneeId,
        ...(ids.length ? { assignees: { connect: ids.map((id) => ({ id })) } } : {}),
        reviewerId,
        assignedById: assignedById || req.user!.userId,
        priority: priority || 'MEDIUM',
        status: status || 'TODO',
        dueDate: dueDate ? new Date(dueDate) : null,
        assignedDate: assignedDate ? new Date(assignedDate) : new Date(),
        parentId,
        estimatedHours,
        driveLink,
        order: await prisma.task.count({ where: { projectId, parentId: parentId || null } }),
      },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        assignees: { select: { id: true, name: true, avatar: true } },
        assignedBy: { select: { id: true, name: true } },
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

    // Notify every assignee (except the creator).
    const assignerName = task.assignedBy?.name || 'Someone';
    await NotificationService.sendMany(
      ids,
      { type: 'TASK_ASSIGNED', message: `${assignerName} assigned you to "${task.title}"`, metadata: { taskId: task.id, projectId: task.projectId } },
      req.user!.userId,
    );

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
      include: { assignees: { select: { id: true } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const canEdit = existing.assigneeId === req.user!.userId || existing.assignees.some((a) => a.id === req.user!.userId);
    if (req.user!.role === 'TEAM_MEMBER' && !canEdit) {
      res.status(403).json({ error: 'You do not have permission to edit this task' });
      return;
    }

    // Keep assigneeIds out of the Prisma spread, and translate any assignee change
    // into both the primary field (assigneeId) and the assignees relation.
    const { assigneeIds: bodyAssigneeIds, ...rest } = req.body;
    let assigneeUpdate: any = {};
    let newAssigneeIds: string[] | null = null;
    if (Array.isArray(bodyAssigneeIds)) {
      newAssigneeIds = Array.from(new Set((bodyAssigneeIds as string[]).filter(Boolean)));
    } else if ('assigneeId' in rest) {
      newAssigneeIds = rest.assigneeId ? [rest.assigneeId as string] : [];
    }
    if (newAssigneeIds) {
      assigneeUpdate = { assigneeId: newAssigneeIds[0] || null, assignees: { set: newAssigneeIds.map((id) => ({ id })) } };
      delete rest.assigneeId;
    }

    const task = await prisma.task.update({
      where: { id: (req.params.id as string) },
      data: {
        ...rest,
        ...assigneeUpdate,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : req.body.dueDate === null ? null : undefined,
        assignedDate: req.body.assignedDate ? new Date(req.body.assignedDate) : req.body.assignedDate === null ? null : undefined,
        ...(req.body.status === 'COMPLETED' && existing.status !== 'COMPLETED'
             ? { completedAt: new Date() }
             : req.body.status && req.body.status !== 'COMPLETED' && existing.status === 'COMPLETED'
               ? { completedAt: null }
               : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        assignees: { select: { id: true, name: true, avatar: true } },
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
      if (task.projectId) {
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
      }

      // Execute workflow automation rules
      await executeWorkflowRules('TASK_STATUS_CHANGE', {
        task,
        oldStatus: existing.status,
        newStatus: task.status,
        orgId: req.user!.organizationId,
      });

      // Notify the project owner + reviewer when work is completed (not the completer).
      if (task.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        const ownerId = task.projectId
          ? (await prisma.project.findUnique({ where: { id: task.projectId }, select: { ownerId: true } }))?.ownerId
          : null;
        await NotificationService.sendMany(
          [ownerId, task.reviewerId],
          { type: 'TASK_COMPLETED', message: `"${task.title}" was completed`, metadata: { taskId: task.id, projectId: task.projectId } },
          req.user!.userId,
        );
      }

      // Notify the project owner + reviewer when work is ready for review.
      if (task.status === 'REVIEW' && existing.status !== 'REVIEW') {
        const ownerId = task.projectId
          ? (await prisma.project.findUnique({ where: { id: task.projectId }, select: { ownerId: true } }))?.ownerId
          : null;
        await NotificationService.sendMany(
          [ownerId, task.reviewerId],
          { type: 'TASK_REVIEW', message: `"${task.title}" is ready for review`, metadata: { taskId: task.id, projectId: task.projectId } },
          req.user!.userId,
        );
      }
    }

    // Notify newly-added assignees (anyone not previously on the task), then run
    // the assignment workflow if at least one person was added.
    if (newAssigneeIds) {
      const previous = new Set([existing.assigneeId, ...existing.assignees.map((a) => a.id)].filter(Boolean) as string[]);
      const added = newAssigneeIds.filter((id) => !previous.has(id));
      await NotificationService.sendMany(
        added,
        { type: 'TASK_ASSIGNED', message: `You were assigned to "${task.title}"`, metadata: { taskId: task.id, projectId: task.projectId } },
        req.user!.userId,
      );
      if (added.length) {
        await executeWorkflowRules('TASK_ASSIGNED', { task, orgId: req.user!.organizationId });
      }
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
      include: { assignees: { select: { id: true } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const canEdit = existing.assigneeId === req.user!.userId || existing.assignees.some((a) => a.id === req.user!.userId);
    if (req.user!.role === 'TEAM_MEMBER' && !canEdit) {
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
    if (task.projectId) {
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
    }

    // Notify the project owner + reviewer when work is completed (not the completer).
    if (task.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
      const ownerId = task.projectId
        ? (await prisma.project.findUnique({ where: { id: task.projectId }, select: { ownerId: true } }))?.ownerId
        : null;
      await NotificationService.sendMany(
        [ownerId, task.reviewerId],
        { type: 'TASK_COMPLETED', message: `"${task.title}" was completed`, metadata: { taskId: task.id, projectId: task.projectId } },
        req.user!.userId,
      );
    }

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
      include: { assignees: { select: { id: true } } },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const canDelete = task.assigneeId === req.user!.userId || task.assignees.some((a) => a.id === req.user!.userId);
    if (req.user!.role === 'TEAM_MEMBER' && !canDelete) {
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
      const isMember = existing.projectId ? await prisma.projectMember.findFirst({
        where: { projectId: existing.projectId, userId: req.user!.userId }
      }) : null;
      let isTeamMember = false;
      if (!isMember && existing.projectId) {
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

    // Notify the people involved in this task (excluding the commenter).
    const authorId = req.user!.userId;
    const meta = { taskId: existing.id, projectId: existing.projectId };
    const ownerId = existing.projectId
      ? (await prisma.project.findUnique({ where: { id: existing.projectId }, select: { ownerId: true } }))?.ownerId
      : null;
    const mentioned = (comment.mentions || []).filter((id) => id && id !== authorId);
    const mentionedSet = new Set(mentioned);

    await NotificationService.sendMany(
      mentioned,
      { type: 'MENTION', message: `${comment.author.name} mentioned you on "${existing.title}"`, metadata: meta },
      authorId,
    );
    await NotificationService.sendMany(
      [existing.assigneeId, existing.reviewerId, ownerId].filter((id) => !mentionedSet.has(id as string)),
      { type: 'COMMENT_ADDED', message: `${comment.author.name} commented on "${existing.title}"`, metadata: meta },
      authorId,
    );

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
      include: { assignees: { select: { id: true } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const canEdit = existing.assigneeId === req.user!.userId || existing.assignees.some((a) => a.id === req.user!.userId);
    if (req.user!.role === 'TEAM_MEMBER' && !canEdit) {
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
        const isMember = firstTask.projectId ? await prisma.projectMember.findFirst({
          where: { projectId: firstTask.projectId, userId: req.user!.userId }
        }) : null;
        let isTeamMember = false;
        if (!isMember && firstTask.projectId) {
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
