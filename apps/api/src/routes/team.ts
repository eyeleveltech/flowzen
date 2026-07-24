import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export const teamRouter = Router();
teamRouter.use(authenticate);

// GET /api/team
teamRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const [members, org] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          role: true,
          designation: true,
          team: { select: { name: true } },
          phone: true,
          joiningDate: true,
          _count: {
            select: {
              assignedTasks: true,
              ownedProjects: true,
            },
          },
          assignedTasks: {
            where: { status: { notIn: ['COMPLETED'] } },
            select: { id: true, status: true, priority: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { settings: true },
      })
    ]);

    const overloadThreshold = ((org?.settings as any)?.overloadThreshold) || 25;

    const enriched = members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      avatar: m.avatar,
      role: m.role,
      department: m.team?.name || null,
      designation: m.designation,
      phone: m.phone,
      joiningDate: m.joiningDate,
      totalTasks: m._count.assignedTasks,
      totalProjects: m._count.ownedProjects,
      activeTasks: m.assignedTasks.length,
      capacity: Math.min(100, Math.round((m.assignedTasks.length / 10) * 100)),
      overloadThreshold,
    }));

    res.json(enriched);
  } catch (error) {
    next(error);
  }
});

// GET /api/team/:id
teamRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const [member, org] = await Promise.all([
      prisma.user.findFirst({
        where: { id: (req.params.id as string), organizationId: orgId },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          role: true,
          designation: true,
          team: { select: { name: true } },
          phone: true,
          joiningDate: true,
          assignedTasks: {
            include: {
              project: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          ownedProjects: {
            include: {
              client: { select: { id: true, name: true, company: true } },
              _count: { select: { tasks: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { settings: true },
      })
    ]);

    if (!member) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }

    const activeTasks = member.assignedTasks.filter((t) => t.status !== 'COMPLETED');
    const completedTasks = member.assignedTasks.filter((t) => t.status === 'COMPLETED');
    const overloadThreshold = ((org?.settings as any)?.overloadThreshold) || 25;

    res.json({
      ...member,
      department: member.team?.name || null,
      overloadThreshold,
      stats: {
        totalTasks: member.assignedTasks.length,
        activeTasks: activeTasks.length,
        completedTasks: completedTasks.length,
        totalProjects: member.ownedProjects.length,
        capacity: Math.min(100, Math.round((activeTasks.length / 10) * 100)),
      },
    });
  } catch (error) {
    next(error);
  }
});
