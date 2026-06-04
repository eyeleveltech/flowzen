import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// GET /api/dashboard/stats
dashboardRouter.get('/stats', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    const userId = req.user!.userId;

    const [activeClients, activeProjects, openTasks, completedTasks, delayedProjects, totalMembers] =
      await Promise.all([
        prisma.client.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
        prisma.project.count({
          where: { 
            client: { organizationId: orgId }, 
            status: { in: ['PLANNING', 'IN_PROGRESS', 'REVIEW'] },
            ...(role === 'PROJECT_MANAGER' ? { ownerId: userId } : {}),
            ...(role === 'TEAM_MEMBER' ? { members: { some: { userId } } } : {})
          },
        }),
        prisma.task.count({
          where: {
            project: { client: { organizationId: orgId } },
            status: { in: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED'] },
            ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
          },
        }),
        prisma.task.count({
          where: { 
            project: { client: { organizationId: orgId } }, 
            status: 'COMPLETED',
            ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
          },
        }),
        prisma.project.count({
          where: {
            client: { organizationId: orgId },
            endDate: { lt: new Date() },
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            ...(role === 'PROJECT_MANAGER' ? { ownerId: userId } : {}),
            ...(role === 'TEAM_MEMBER' ? { members: { some: { userId } } } : {})
          },
        }),
        prisma.user.count({ where: { organizationId: orgId, isActive: true } }),
      ]);

    res.json({
      activeClients,
      activeProjects,
      openTasks,
      completedTasks,
      delayedProjects,
      totalMembers,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/project-health
dashboardRouter.get('/project-health', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    const userId = req.user!.userId;
    const now = new Date();

    const projects = await prisma.project.findMany({
      where: {
        client: { organizationId: orgId },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        ...(role === 'PROJECT_MANAGER' ? { ownerId: userId } : {}),
        ...(role === 'TEAM_MEMBER' ? { members: { some: { userId } } } : {})
      },
      select: { id: true, endDate: true, progress: true, status: true },
    });

    let onTrack = 0;
    let atRisk = 0;
    let delayed = 0;

    projects.forEach((p) => {
      if (p.endDate && p.endDate < now) {
        delayed++;
      } else if (p.endDate) {
        const total = p.endDate.getTime() - now.getTime();
        const daysLeft = total / (1000 * 60 * 60 * 24);
        if (daysLeft < 7 && p.progress < 80) {
          atRisk++;
        } else {
          onTrack++;
        }
      } else {
        onTrack++;
      }
    });

    res.json({ onTrack, atRisk, delayed, total: projects.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/activity
dashboardRouter.get('/activity', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const activities = await prisma.activity.findMany({
      where: { user: { organizationId: orgId } },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json(activities);
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/deadlines
dashboardRouter.get('/deadlines', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    const userId = req.user!.userId;
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const tasks = await prisma.task.findMany({
      where: {
        project: { client: { organizationId: orgId } },
        dueDate: { gte: now, lte: nextWeek },
        status: { notIn: ['COMPLETED'] },
        ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
      },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
    });

    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/team-workload
dashboardRouter.get('/team-workload', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const members = await prisma.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        name: true,
        avatar: true,
        role: true,
        department: true,
        _count: {
          select: {
            assignedTasks: {
              where: { status: { notIn: ['COMPLETED'] } },
            },
          },
        },
      },
    });

    const workload = members.map((m) => ({
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      role: m.role,
      department: m.department,
      activeTasks: m._count.assignedTasks,
      capacity: Math.min(100, Math.round((m._count.assignedTasks / 10) * 100)),
    }));

    res.json(workload);
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/velocity
dashboardRouter.get('/velocity', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    const userId = req.user!.userId;
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29); // include today
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const tasks = await prisma.task.findMany({
      where: {
        project: { client: { organizationId: orgId } },
        status: 'COMPLETED',
        completedAt: { gte: thirtyDaysAgo },
        ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
      },
      select: { completedAt: true }
    });

    const dataMap = new Map();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime());
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      // Format as "Mon DD"
      const formattedStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dataMap.set(dateStr, { name: formattedStr, tasks: 0 });
    }

    tasks.forEach(t => {
      if (t.completedAt) {
        const dateStr = t.completedAt.toISOString().split('T')[0];
        if (dataMap.has(dateStr)) {
          dataMap.get(dateStr).tasks += 1;
        }
      }
    });

    const data = Array.from(dataMap.values());
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/status-distribution
dashboardRouter.get('/status-distribution', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    const userId = req.user!.userId;

    const baseProjectWhere = role === 'TEAM_MEMBER' ? { members: { some: { userId } } } : role === 'PROJECT_MANAGER' ? { ownerId: userId } : {};

    const projects = await prisma.project.groupBy({
      by: ['status'],
      where: {
        client: { organizationId: orgId },
        ...baseProjectWhere
      },
      _count: { id: true }
    });

    const labelMap: Record<string, string> = {
      PLANNING: 'Planning',
      IN_PROGRESS: 'In Progress',
      REVIEW: 'Review',
      COMPLETED: 'Completed',
      ON_HOLD: 'On Hold',
      CANCELLED: 'Cancelled'
    };

    const data = projects.map(p => ({
      name: labelMap[p.status] || p.status,
      value: p._count.id
    }));
    
    res.json(data);
  } catch (error) {
    next(error);
  }
});
