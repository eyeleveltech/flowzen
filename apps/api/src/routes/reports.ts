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

    const [total, completed, active, delayed, planning, onHold, projectsList] = await Promise.all([
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
      prisma.project.findMany({
        where: { client: { organizationId: orgId } },
        select: {
          status: true,
          type: true,
          client: { select: { name: true } },
        }
      })
    ]);

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const projectsByClient = projectsList
      .filter(p => p.status === 'IN_PROGRESS')
      .reduce((acc, curr) => {
        const clientName = curr.client.name;
        acc[clientName] = (acc[clientName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    const projectsByType = projectsList.reduce((acc, curr) => {
      const type = curr.type || 'ONE_TIME';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

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
      projectsByClient: Object.entries(projectsByClient).map(([client, count]) => ({ client, count })).sort((a, b) => b.count - a.count),
      projectsByType: Object.entries(projectsByType).map(([type, count]) => ({ type, count })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/tasks
reportRouter.get('/tasks', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const [total, completed, overdue, tasksList] = await Promise.all([
      prisma.task.count({ where: { project: { client: { organizationId: orgId } } } }),
      prisma.task.count({ where: { project: { client: { organizationId: orgId } }, status: 'COMPLETED' } }),
      prisma.task.count({ 
        where: { 
          project: { client: { organizationId: orgId } }, 
          dueDate: { lt: new Date() },
          status: { notIn: ['COMPLETED'] }
        } 
      }),
      prisma.task.findMany({
        where: { 
          project: { client: { organizationId: orgId } },
          status: { notIn: ['COMPLETED'] }
        },
        select: {
          type: true,
          assignee: { select: { name: true } }
        }
      })
    ]);

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const tasksByType = tasksList.reduce((acc, curr) => {
      const type = curr.type || 'OTHER';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const tasksByAssignee = tasksList
      .filter(t => t.assignee?.name)
      .reduce((acc, curr) => {
        const name = curr.assignee!.name;
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    res.json({
      total,
      completed,
      overdue,
      completionRate,
      tasksByType: Object.entries(tasksByType).map(([type, count]) => ({ type, count })),
      tasksByAssignee: Object.entries(tasksByAssignee).map(([assignee, count]) => ({ assignee, count })).sort((a, b) => b.count - a.count),
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
      where: { organizationId: orgId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        avatar: true,
        _count: {
          select: { assignedTasks: true },
        },
        assignedTasks: {
          select: { status: true, loggedHours: true },
        },
      },
    });

    const teamMetrics = members.map((m) => {
      const completed = m.assignedTasks.filter((t) => t.status === 'COMPLETED').length;
      const active = m.assignedTasks.filter((t) => t.status !== 'COMPLETED').length;
      const total = m._count.assignedTasks;
      const loggedHours = m.assignedTasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        totalTasks: total,
        completedTasks: completed,
        activeTasks: active,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        loggedHours,
      };
    });

    const totalTasks = teamMetrics.reduce((sum, m) => sum + m.totalTasks, 0);
    const totalCompleted = teamMetrics.reduce((sum, m) => sum + m.completedTasks, 0);

    res.json({
      overallCompletionRate: totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0,
      totalTasks,
      totalCompleted,
      members: teamMetrics.sort((a, b) => b.activeTasks - a.activeTasks),
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
          select: { 
            status: true, 
            budget: true, 
            endDate: true,
            tasks: { select: { status: true, dueDate: true } } 
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const clientMetrics = clients.map((c) => {
      const completedProjects = c.projects.filter((p) => p.status === 'COMPLETED').length;
      const totalProjects = c.projects.length;
      const totalBudget = c.projects.reduce((sum, p) => sum + (p.budget || 0), 0);
      
      let totalTasks = 0;
      let completedTasks = 0;
      let overdueTasks = 0;
      let nextDueDate: Date | null = null;
      
      c.projects.forEach(p => {
        totalTasks += p.tasks.length;
        p.tasks.forEach(t => {
          if (t.status === 'COMPLETED') {
            completedTasks++;
          } else {
            if (t.dueDate && new Date(t.dueDate) < new Date()) {
              overdueTasks++;
            }
            if (t.dueDate && new Date(t.dueDate) > new Date()) {
              if (!nextDueDate || new Date(t.dueDate) < nextDueDate) {
                nextDueDate = new Date(t.dueDate);
              }
            }
          }
        });
      });

      return {
        id: c.id,
        name: c.name,
        company: c.company,
        contractValue: c.contractValue,
        status: c.status,
        totalProjects,
        completedProjects,
        completionRate: totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0,
        totalBudget,
        totalTasks,
        completedTasks,
        deliverablesRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        overdueTasks,
        nextDueDate,
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
