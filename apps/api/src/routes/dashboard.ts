import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { cacheMiddleware } from '../middleware/cache.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// Cache all dashboard routes for 5 minutes (invalidated on mutation)
dashboardRouter.use(cacheMiddleware(300));

// GET /api/dashboard/stats
dashboardRouter.get('/stats', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    const userId = req.user!.userId;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { startDate, endDate } = req.query;
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string)
        }
      };
    }

    const [activeClients, activeProjects, openTasks, completedTasks, delayedProjects, totalMembers, overdueTasks] =
      await Promise.all([
        prisma.client.count({ where: { organizationId: orgId, status: 'ACTIVE', ...dateFilter } }),
        prisma.project.count({
          where: { 
            client: { organizationId: orgId }, 
            status: { in: ['PLANNING', 'IN_PROGRESS', 'REVIEW'] },
            ...dateFilter,
            ...(role === 'PROJECT_MANAGER' ? { ownerId: userId } : {}),
            ...(role === 'TEAM_MEMBER' ? { members: { some: { userId } } } : {})
          },
        }),
        prisma.task.count({
          where: {
            project: { client: { organizationId: orgId } },
            status: { in: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED'] },
            ...dateFilter,
            ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
          },
        }),
        prisma.task.count({
          where: { 
            project: { client: { organizationId: orgId } }, 
            status: 'COMPLETED',
            ...(startDate && endDate ? {
              completedAt: {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string)
              }
            } : {}),
            ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
          },
        }),
        prisma.project.count({
          where: {
            client: { organizationId: orgId },
            endDate: { lt: todayStart },
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            ...dateFilter,
            ...(role === 'PROJECT_MANAGER' ? { ownerId: userId } : {}),
            ...(role === 'TEAM_MEMBER' ? { members: { some: { userId } } } : {})
          },
        }),
        prisma.user.count({ where: { organizationId: orgId, status: 'ACTIVE', ...dateFilter } }),
        prisma.task.count({
          where: {
            project: { client: { organizationId: orgId } },
            dueDate: { lt: todayStart },
            status: { notIn: ['COMPLETED'] },
            ...dateFilter,
            ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
          }
        }),
      ]);

    res.json({
      activeClients,
      activeProjects,
      openTasks,
      completedTasks,
      delayedProjects,
      totalMembers,
      overdueTasks,
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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
      if (p.endDate && p.endDate < todayStart) {
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
    const filter = (req.query.filter as string) || 'ALL';
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = parseInt(req.query.skip as string) || 0;

    let whereClause: any = { user: { organizationId: orgId } };

    if (filter === 'TASKS') {
      whereClause.entityType = 'TASK';
    } else if (filter === 'PROJECTS') {
      whereClause.entityType = 'PROJECT';
    } else if (filter === 'ME') {
      whereClause.userId = req.user!.userId;
    }

    const activities = await prisma.activity.findMany({
      where: whereClause,
      include: { 
        user: { select: { id: true, name: true, avatar: true } },
        task: { select: { id: true, title: true, projectId: true } },
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: skip,
    });

    res.json(activities);
  } catch (error) {
    next(error);
  }
});

// POST /api/dashboard/activity/read
dashboardRouter.post('/activity/read', async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.user!.userId;
    const now = new Date();
    // Use raw query to avoid Prisma Client out-of-date issues
    await prisma.$executeRawUnsafe('UPDATE "users" SET "lastActivityReadAt" = $1 WHERE id = $2', now, userId);
    res.json({ success: true, lastActivityReadAt: now });
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const tasks = await prisma.task.findMany({
      where: {
        project: { client: { organizationId: orgId } },
        dueDate: { gte: todayStart, lte: nextWeek },
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
    const { startDate, endDate } = req.query;
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string)
        }
      };
    }

    const members = await prisma.user.findMany({
      where: { organizationId: orgId, status: 'ACTIVE', ...dateFilter },
      select: {
        id: true,
        name: true,
        avatar: true,
        role: true,
        department: true,
        assignedTasks: { select: { status: true } },
      },
    });

    const workload = members.map((m) => {
      const activeTasks = m.assignedTasks.filter(t => t.status !== 'COMPLETED').length;
      const completedTasks = m.assignedTasks.filter(t => t.status === 'COMPLETED').length;
      const totalTasks = m.assignedTasks.length;
      const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      
      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        role: m.role,
        department: m.department,
        activeTasks,
        capacity: Math.min(100, Math.round((activeTasks / 10) * 100)),
        completionRate
      };
    });

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
    
    const { startDate, endDate } = req.query;

    let start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    
    let end = new Date();
    end.setHours(23, 59, 59, 999);

    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    }

    const tasks = await prisma.task.findMany({
      where: {
        project: { client: { organizationId: orgId } },
        status: 'COMPLETED',
        completedAt: { gte: start, lte: end },
        ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {})
      },
      select: { completedAt: true }
    });

    const dataMap = new Map();
    
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    
    // Always restrict to max 60 data points to prevent cluttered UI
    const totalDays = Math.min(diffDays, 60);
    
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(end.getTime());
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
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
    const { startDate, endDate } = req.query;

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string)
        }
      };
    }

    const tasks = await prisma.task.findMany({
      where: {
        project: { client: { organizationId: orgId } },
        ...(role === 'TEAM_MEMBER' ? { assigneeId: userId } : {}),
        ...dateFilter
      },
      select: { status: true, dueDate: true }
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let buckets = {
      TODO: 0,
      IN_PROGRESS: 0,
      REVIEW: 0,
      APPROVED: 0,
      COMPLETED: 0,
      OVERDUE: 0
    };

    tasks.forEach(t => {
      // Overdue takes precedence
      if (t.dueDate && new Date(t.dueDate) < todayStart && t.status !== 'COMPLETED') {
        buckets.OVERDUE++;
      } else {
        if (t.status === 'TODO' || t.status === 'BACKLOG' || t.status === 'BLOCKED') buckets.TODO++;
        else if (t.status === 'IN_PROGRESS') buckets.IN_PROGRESS++;
        else if (t.status === 'REVIEW') buckets.REVIEW++;
        else if (t.status === 'APPROVED') buckets.APPROVED++;
        else if (t.status === 'COMPLETED') buckets.COMPLETED++;
      }
    });

    const data = [
      { name: 'To Do', value: buckets.TODO, color: '#F3F4F6' },
      { name: 'In Progress', value: buckets.IN_PROGRESS, color: '#111827' },
      { name: 'In Review', value: buckets.REVIEW, color: '#4B5563' },
      { name: 'Approved', value: buckets.APPROVED, color: '#9CA3AF' },
      { name: 'Completed', value: buckets.COMPLETED, color: '#D1D5DB' },
      { name: 'Overdue', value: buckets.OVERDUE, color: '#EF4444' }
    ].filter(item => item.value > 0); // Only return segments with data
    
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/my-tasks
dashboardRouter.get('/my-tasks', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;

    const tasks = await prisma.task.findMany({
      where: {
        assigneeId: userId,
        project: { client: { organizationId: orgId } },
        status: { notIn: ['COMPLETED'] }
      },
      include: {
        project: { select: { id: true, name: true } }
      },
      orderBy: { dueDate: 'asc' }
    });
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/pending-approvals
dashboardRouter.get('/pending-approvals', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    
    if (role === 'TEAM_MEMBER') return res.json([]);

    const tasks = await prisma.task.findMany({
      where: {
        project: { client: { organizationId: orgId } },
        status: 'REVIEW'
      },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// GET /api/dashboard/client-health
dashboardRouter.get('/client-health', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { startDate, endDate } = req.query;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string)
        }
      };
    }
    
    const clients = await prisma.client.findMany({
      where: { organizationId: orgId, status: 'ACTIVE', ...dateFilter },
      select: {
        id: true,
        name: true,
        projects: {
          where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          select: {
            endDate: true,
            tasks: { select: { status: true, dueDate: true } }
          }
        }
      }
    });

    const healthData = clients.map(c => {
      let overdueTasks = 0;
      let nextDueDate: Date | null = null;
      let projectPastEndDate = false;

      c.projects.forEach(p => {
        if (p.endDate && new Date(p.endDate) < todayStart) projectPastEndDate = true;
        p.tasks.forEach(t => {
          if (t.status !== 'COMPLETED') {
            if (t.dueDate && new Date(t.dueDate) < todayStart) overdueTasks++;
            if (t.dueDate && new Date(t.dueDate) >= todayStart) {
              if (!nextDueDate || new Date(t.dueDate) < nextDueDate) nextDueDate = new Date(t.dueDate);
            }
          }
        });
      });

      let health = 'Green';
      if (overdueTasks >= 3 || projectPastEndDate) health = 'Red';
      else if (overdueTasks > 0) health = 'Amber';

      return {
        id: c.id,
        name: c.name,
        activeProjects: c.projects.length,
        overdueTasks,
        nextDueDate,
        health
      };
    });

    res.json(healthData);
  } catch (error) {
    next(error);
  }
});
