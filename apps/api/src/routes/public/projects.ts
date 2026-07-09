import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const projectRouter = Router();

// GET /api/v1/projects — List projects (Super Admin only context via apiKeyAuth)
projectRouter.get('/', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.organizationId;
    const { status, clientId, limit, page } = req.query;

    const where: any = { client: { organizationId: orgId } };
    if (status && typeof status === 'string') {
      where.status = status;
    }
    if (clientId && typeof clientId === 'string') {
      where.clientId = clientId;
    }

    const parsedLimit = limit ? parseInt(limit as string, 10) : 100;
    const parsedPage = page ? parseInt(page as string, 10) : 1;
    const skip = (parsedPage - 1) * parsedLimit;

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, company: true } },
          owner: { select: { id: true, name: true } },
          _count: { select: { tasks: true } }
        },
        skip,
        take: parsedLimit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.project.count({ where })
    ]);

    res.json({
      success: true,
      data: projects,
      meta: {
        page: parsedPage,
        limit: parsedLimit,
        total
      }
    });
  } catch (error) {
    console.error('[Public API GET /projects Error]:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// GET /api/v1/projects/:id — Get details of a single project
projectRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.organizationId;
    const project = await prisma.project.findFirst({
      where: {
        id: req.params.id as string,
        client: { organizationId: orgId }
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        milestones: { orderBy: { dueDate: 'asc' } },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, avatar: true } }
          },
          orderBy: { order: 'asc' }
        }
      }
    });

    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found', code: 404 });
      return;
    }

    res.json({ success: true, data: project });
  } catch (error) {
    console.error('[Public API GET /projects/:id Error]:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// POST /api/v1/projects — Create a new project
projectRouter.post('/', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.organizationId;
    const userId = (req as any).user.userId;
    const { name, description, clientId, ownerId, type, platform, scope, startDate, endDate, priority, budget, memberIds } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, error: 'Project name is required', code: 400 });
      return;
    }

    let finalClientId = clientId;
    if (!finalClientId) {
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      const internalName = `${org?.name || 'Internal'} (Internal)`;
      
      let internalClient = await prisma.client.findFirst({
        where: { organizationId: orgId, name: internalName }
      });

      if (!internalClient) {
        internalClient = await prisma.client.create({
          data: { name: internalName, organizationId: orgId, status: 'ACTIVE' }
        });
      }
      finalClientId = internalClient.id;
    }

    const finalOwnerId = ownerId || userId;

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        description: description || null,
        clientId: finalClientId,
        ownerId: finalOwnerId,
        type: type || 'ONE_TIME',
        platform: platform || null,
        scope: scope || null,
        priority: priority || 'MEDIUM',
        budget: budget ? parseFloat(budget) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        members: {
          create: memberIds && Array.isArray(memberIds)
            ? Array.from(new Set([...memberIds, finalOwnerId])).map((id: string) => ({ userId: id as string }))
            : [{ userId: finalOwnerId }],
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
        message: `created project "${project.name}" via EyeLevel API`,
        entityType: 'PROJECT',
        entityId: project.id,
        userId: userId,
        projectId: project.id,
        clientId: project.clientId,
      },
    });

    res.status(201).json({ success: true, data: project });
  } catch (error) {
    console.error('[Public API POST /projects Error]:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

export default projectRouter;
