import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';

export const reportRouter = Router();
reportRouter.use(authenticate);
reportRouter.use(authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'));

// GET /api/reports/projects
reportRouter.get('/projects', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const [total, completed, active, delayed, planning, onHold] = await Promise.all([
      prisma.project.count({ where: { client: { organizationId: orgId } } }),
      prisma.project.count({ where: { client: { organizationId: orgId }, status: 'COMPLETED' } }),
      prisma.project.count({ where: { client: { organizationId: orgId }, status: 'IN_PROGRESS' } }),
      prisma.project.count({
        where: {
          client: { organizationId: orgId },
          endDate: { lt: new Date() },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      }),
      prisma.project.count({ where: { client: { organizationId: orgId }, status: 'PLANNING' } }),
      prisma.project.count({ where: { client: { organizationId: orgId }, status: 'ON_HOLD' } }),
    ]);

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({
      total,
      completed,
      active,
      delayed,
      planning,
      onHold,
      completionRate,
      statusDistribution: [
        { status: 'Planning', count: planning },
        { status: 'Active', count: active },
        { status: 'On Hold', count: onHold },
        { status: 'Completed', count: completed },
        { status: 'Delayed', count: delayed },
      ],
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/team
reportRouter.get('/team', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const members = await prisma.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        name: true,
        avatar: true,
        _count: {
          select: { assignedTasks: true },
        },
        assignedTasks: {
          select: { status: true },
        },
      },
    });

    const teamMetrics = members.map((m) => {
      const completed = m.assignedTasks.filter((t) => t.status === 'COMPLETED').length;
      const total = m._count.assignedTasks;
      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        totalTasks: total,
        completedTasks: completed,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });

    const totalTasks = teamMetrics.reduce((sum, m) => sum + m.totalTasks, 0);
    const totalCompleted = teamMetrics.reduce((sum, m) => sum + m.completedTasks, 0);

    res.json({
      overallCompletionRate: totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0,
      totalTasks,
      totalCompleted,
      members: teamMetrics,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/clients
reportRouter.get('/clients', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const clients = await prisma.client.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        company: true,
        contractValue: true,
        status: true,
        projects: {
          select: { status: true, budget: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const clientMetrics = clients.map((c) => {
      const completed = c.projects.filter((p) => p.status === 'COMPLETED').length;
      const total = c.projects.length;
      const totalBudget = c.projects.reduce((sum, p) => sum + (p.budget || 0), 0);
      return {
        id: c.id,
        name: c.name,
        company: c.company,
        contractValue: c.contractValue,
        status: c.status,
        totalProjects: total,
        completedProjects: completed,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalBudget,
      };
    });

    const totalRevenue = clientMetrics.reduce((sum, c) => sum + (c.contractValue || 0), 0);

    res.json({
      totalClients: clients.length,
      totalRevenue,
      clients: clientMetrics,
    });
  } catch (error) {
    next(error);
  }
});
