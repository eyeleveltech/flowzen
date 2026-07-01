import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';
import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';
import { NotificationService } from '../services/notifications.js';
import { toList, whereIn } from '../utils/query.js';

export const projectRouter = Router();
projectRouter.use(authenticate);

const projectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['RETAINER', 'ONE_TIME', 'EVENT', 'INTERNAL']).optional(),
  scope: z.string().optional(),
  reportingCadence: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'NONE']).optional(),
  clientApprovalRequired: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  projectNotes: z.string().optional(),
  folderLink: z.string().url().optional().or(z.literal('')),
  clientId: z.string().optional(),
  ownerId: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['PLANNING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'ON_HOLD', 'CANCELLED']).optional(),
  budget: z.number().optional(),
  platform: z.enum(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X_TWITTER', 'TIKTOK', 'YOUTUBE', 'GOOGLE_ADS', 'WEBSITE', 'MOBILE_APP', 'E_COMMERCE', 'CROSS_PLATFORM', 'OTHER']).optional(),
  memberIds: z.array(z.string()).optional(),
});

// GET /api/projects
projectRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { search, status, priority, clientId, ownerId, page = '1', limit = '20' } = req.query;

    const where: Record<string, unknown> = { client: { organizationId: orgId } };
    
    if (req.user!.role === 'TEAM_MEMBER') {
      where.OR = [
        { members: { some: { userId: req.user!.userId } } },
        { teams: { some: { team: { members: { some: { id: req.user!.userId } } } } } },
      ];
    }
    const statuses = toList(status);
    if (statuses) {
      // DELAYED carries an extra endDate constraint; keep that only when it's the sole filter.
      if (statuses.length === 1 && statuses[0] === 'DELAYED') {
        where.status = { in: ['IN_PROGRESS', 'REVIEW'] };
        where.endDate = { lt: new Date() };
      } else {
        const real = new Set<string>();
        for (const s of statuses) {
          if (s === 'ACTIVE') ['PLANNING', 'IN_PROGRESS', 'REVIEW'].forEach((x) => real.add(x));
          else if (s === 'DELAYED') ['IN_PROGRESS', 'REVIEW'].forEach((x) => real.add(x));
          else real.add(s);
        }
        where.status = { in: [...real] };
      }
    }
    if (priority) where.priority = whereIn(priority);
    if (clientId) where.clientId = whereIn(clientId);
    if (ownerId) where.ownerId = whereIn(ownerId);
    if (search) {
      const searchCondition = {
        OR: [
          { name: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
        ],
      };
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          searchCondition
        ];
        delete where.OR;
      } else {
        where.OR = searchCondition.OR;
      }
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where: where as any,
        include: {
          client: { select: { id: true, name: true, company: true } },
          owner: { select: { id: true, name: true, avatar: true } },
          members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
          teams: { include: { team: { include: { members: { select: { id: true, name: true, avatar: true } } } } } },
          _count: { select: { tasks: true } },
          ...(req.query.includeCalendarData === 'true' && {
            milestones: { select: { id: true, name: true, dueDate: true, completed: true } },
          }),
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.project.count({ where: where as any }),
    ]);

    res.json({ projects, total, page: parseInt(page as string), totalPages: Math.ceil(total / parseInt(limit as string)) });
  } catch (error) {
    next(error);
  }
});

// GET /api/projects/:id
projectRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const where: Record<string, unknown> = { id: (req.params.id as string), client: { organizationId: req.user!.organizationId } };
    if (req.user!.role === 'TEAM_MEMBER') {
      where.OR = [
        { members: { some: { userId: req.user!.userId } } },
        { teams: { some: { team: { members: { some: { id: req.user!.userId } } } } } },
      ];
    }

    const project = await prisma.project.findFirst({
      where: where as any,
      include: {
        client: { select: { id: true, name: true, company: true, lead: { select: { id: true } } } },
        owner: { select: { id: true, name: true, avatar: true, email: true } },
        members: { include: { user: { select: { id: true, name: true, avatar: true, role: true, designation: true } } } },
        teams: { include: { team: { include: { members: { select: { id: true, name: true, avatar: true, role: true, designation: true } } } } } },
        tasks: {
          where: req.user!.role === 'TEAM_MEMBER'
            ? { OR: [{ assigneeId: req.user!.userId }, { assignees: { some: { id: req.user!.userId } } }] }
            : undefined,
          include: {
            assignee: { select: { id: true, name: true, avatar: true } },
            assignees: { select: { id: true, name: true, avatar: true } },
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: [{ status: 'asc' }, { order: 'asc' }],
        },
        milestones: { orderBy: { dueDate: 'asc' } },
        activities: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        comments: {
          include: { author: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(project);
  } catch (error) {
    next(error);
  }
});

// POST /api/projects
projectRouter.post('/', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), validate(projectSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { memberIds, teamIds, folderLink, ...projectData } = req.body;



    let finalClientId = projectData.clientId;
    if (!finalClientId) {
      const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
      const internalName = `${org?.name || 'Internal'} (Internal)`;
      
      let internalClient = await prisma.client.findFirst({
        where: { organizationId: req.user!.organizationId, name: internalName }
      });

      if (!internalClient) {
        internalClient = await prisma.client.create({
          data: { name: internalName, organizationId: req.user!.organizationId, status: 'ACTIVE' }
        });
      }
      finalClientId = internalClient.id;
    }

    const project = await prisma.project.create({
      data: {
        ...projectData,
        folderLink: folderLink || null,
        clientId: finalClientId,
        startDate: projectData.startDate ? new Date(projectData.startDate) : undefined,
        endDate: projectData.endDate ? new Date(projectData.endDate) : undefined,
        members: {
          create: req.body.memberIds 
            ? Array.from(new Set([...req.body.memberIds, req.body.ownerId])).map((id: string) => ({ userId: id as string }))
            : [{ userId: req.body.ownerId }],
        },
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        owner: { select: { id: true, name: true, avatar: true } },
      },
    });

    await prisma.activity.create({
      data: {
        type: 'PROJECT_CREATED',
        message: `created project "${project.name}"`,
        entityType: 'PROJECT',
        entityId: project.id,
        userId: req.user!.userId,
        projectId: project.id,
        clientId: project.clientId,
      },
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'project:created', project);
    await invalidateOrganizationCache(req.user!.organizationId);

    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

// PUT /api/projects/:id
projectRouter.put('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.project.findFirst({
      where: { id: (req.params.id as string), client: { organizationId: req.user!.organizationId } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { memberIds, teamIds, folderLink, ...projectData } = req.body;



    let finalClientId = projectData.clientId;
    if (!finalClientId) {
      const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
      const internalName = `${org?.name || 'Internal'} (Internal)`;
      
      let internalClient = await prisma.client.findFirst({
        where: { organizationId: req.user!.organizationId, name: internalName }
      });

      if (!internalClient) {
        internalClient = await prisma.client.create({
          data: { name: internalName, organizationId: req.user!.organizationId, status: 'ACTIVE' }
        });
      }
      finalClientId = internalClient.id;
    }

    const project = await prisma.project.update({
      where: { id: (req.params.id as string) },
      data: {
        ...projectData,
        folderLink: folderLink || null,
        clientId: finalClientId,
        startDate: projectData.startDate ? new Date(projectData.startDate) : undefined,
        endDate: projectData.endDate ? new Date(projectData.endDate) : undefined,
        ...(req.body.memberIds ? {
          members: {
            deleteMany: {},
            create: Array.from(new Set([...req.body.memberIds, req.body.ownerId || existing.ownerId])).map((id: string) => ({ userId: id as string })),
          },
        } : {}),
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        members: { include: { user: { select: { id: true, name: true, avatar: true, role: true, designation: true } } } },
        teams: { include: { team: { include: { members: { select: { id: true, name: true, avatar: true, role: true, designation: true } } } } } },
        tasks: {
          where: req.user!.role === 'TEAM_MEMBER'
            ? { OR: [{ assigneeId: req.user!.userId }, { assignees: { some: { id: req.user!.userId } } }] }
            : undefined,
          include: {
            assignee: { select: { id: true, name: true, avatar: true } },
            assignees: { select: { id: true, name: true, avatar: true } },
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: [{ status: 'asc' }, { order: 'asc' }],
        },
        milestones: { orderBy: { dueDate: 'asc' } },
        activities: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (existing.status !== project.status) {
      await prisma.activity.create({
        data: {
          type: 'PROJECT_STATUS_CHANGED',
          message: `changed project "${project.name}" status to ${project.status}`,
          entityType: 'PROJECT',
          entityId: project.id,
          userId: req.user!.userId,
          projectId: project.id,
        },
      });
    }

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'project:updated', project);
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json(project);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/projects/:id
projectRouter.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: (req.params.id as string), client: { organizationId: req.user!.organizationId } },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await prisma.project.delete({ where: { id: (req.params.id as string) } });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'project:deleted', { id: (req.params.id as string) });
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json({ message: 'Project deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/from-template
projectRouter.post('/from-template', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { templateId, clientId, ownerId, name, startDate, endDate } = req.body;

    const template = await prisma.projectTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const structure = template.structure as { tasks?: { title: string; subtasks?: { title: string }[] }[] };

    const project = await prisma.project.create({
      data: {
        name: name || template.name,
        description: template.description,
        clientId,
        ownerId,
        templateId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        members: { create: { userId: ownerId } },
      },
    });

    // Create tasks from template
    if (structure.tasks) {
      for (let i = 0; i < structure.tasks.length; i++) {
        const taskDef = structure.tasks[i];
        const task = await prisma.task.create({
          data: {
            title: taskDef.title,
            projectId: project.id,
            order: i,
            status: 'TODO',
          },
        });

        if (taskDef.subtasks) {
          for (let j = 0; j < taskDef.subtasks.length; j++) {
            await prisma.task.create({
              data: {
                title: taskDef.subtasks[j].title,
                projectId: project.id,
                parentId: task.id,
                order: j,
                status: 'TODO',
              },
            });
          }
        }
      }
    }

    await invalidateOrganizationCache(req.user!.organizationId);
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/milestones
projectRouter.post('/:id/milestones', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
  try {
    const milestone = await prisma.milestone.create({
      data: {
        name: req.body.name,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
        projectId: (req.params.id as string),
      },
    });

    res.status(201).json(milestone);
  } catch (error) {
    next(error);
  }
});

// PUT /api/projects/:id/milestones/:milestoneId
projectRouter.put('/:id/milestones/:milestoneId', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
  try {
    const milestone = await prisma.milestone.update({
      where: { id: req.params.milestoneId as string },
      data: {
        name: req.body.name,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
        completed: req.body.completed !== undefined ? req.body.completed : undefined,
      },
    });

    res.json(milestone);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/projects/:id/milestones/:milestoneId
projectRouter.delete('/:id/milestones/:milestoneId', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.milestone.delete({
      where: { id: req.params.milestoneId as string },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /api/projects/:id/comments
projectRouter.post('/:id/comments', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.project.findFirst({
      where: { id: (req.params.id as string), client: { organizationId: req.user!.organizationId } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (req.user!.role === 'TEAM_MEMBER') {
      const isMember = await prisma.projectMember.findFirst({
        where: { projectId: existing.id, userId: req.user!.userId }
      });
      let isTeamMember = false;
      if (!isMember) {
        const projectTeams = await prisma.projectTeam.findMany({
          where: { projectId: existing.id },
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
        projectId: (req.params.id as string),
        authorId: req.user!.userId,
      },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'project_comment:created', { ...comment, projectId: (req.params.id as string) });

    // Notify the project owner + anyone mentioned (excluding the commenter).
    const authorId = req.user!.userId;
    const meta = { projectId: existing.id };
    const mentioned = (comment.mentions || []).filter((id) => id && id !== authorId);
    const mentionedSet = new Set(mentioned);

    await NotificationService.sendMany(
      mentioned,
      { type: 'MENTION', message: `${comment.author.name} mentioned you on "${existing.name}"`, metadata: meta },
      authorId,
    );
    await NotificationService.sendMany(
      [existing.ownerId].filter((id) => !mentionedSet.has(id as string)),
      { type: 'COMMENT_ADDED', message: `${comment.author.name} commented on "${existing.name}"`, metadata: meta },
      authorId,
    );

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});
