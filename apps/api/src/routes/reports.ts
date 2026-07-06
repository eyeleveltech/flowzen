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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const whereClause: any = { client: { organizationId: orgId } };
    if (req.query.teamId) {
      whereClause.teams = { some: { teamId: req.query.teamId as string } };
    }

    const [total, completed, active, delayed, planning, onHold, projectsList] = await Promise.all([
      prisma.project.count({ where: whereClause }),
      prisma.project.count({ where: { ...whereClause, status: 'COMPLETED' } }),
      prisma.project.count({ where: { ...whereClause, status: 'IN_PROGRESS' } }),
      prisma.project.count({
        where: {
          ...whereClause,
          endDate: { lt: todayStart },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      }),
      prisma.project.count({ where: { ...whereClause, status: 'PLANNING' } }),
      prisma.project.count({ where: { ...whereClause, status: 'ON_HOLD' } }),
      prisma.project.findMany({
        where: whereClause,
        select: {
          status: true,
          type: true,
          client: { select: { name: true, company: true } },
        }
      })
    ]);

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const projectsByClient = projectsList
      .filter(p => p.status === 'IN_PROGRESS')
      .reduce((acc, curr) => {
        const clientName = (curr.client.name === 'Internal' ? curr.client.company || 'Internal' : curr.client.company || curr.client.name) as string;
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const whereClause: any = { project: { client: { organizationId: orgId } } };
    if (req.query.teamId) {
      whereClause.assignee = { teamId: req.query.teamId as string };
    }

    const [total, completed, overdue, tasksList] = await Promise.all([
      prisma.task.count({ where: whereClause }),
      prisma.task.count({ where: { ...whereClause, status: 'COMPLETED' } }),
      prisma.task.count({ 
        where: { 
          ...whereClause, 
          dueDate: { lt: todayStart },
          status: { notIn: ['COMPLETED'] }
        } 
      }),
      prisma.task.findMany({
        where: { 
          ...whereClause,
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

    const whereClause: any = { organizationId: orgId, status: 'ACTIVE' };
    if (req.query.teamId) {
      whereClause.teamId = req.query.teamId as string;
    }

    const members = await prisma.user.findMany({
      where: whereClause,
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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
            if (t.dueDate && new Date(t.dueDate) < todayStart) {
              overdueTasks++;
            }
            if (t.dueDate && new Date(t.dueDate) > todayStart) {
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

// GET /api/reports/executive — aggregated "boss view": revenue, delivery, team, clients.
// Accepts optional startDate/endDate. Snapshot metrics (active revenue, pipeline, overdue)
// are current; period metrics (won/lost, velocity) honour the range.
reportRouter.get('/executive', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const periodStart = req.query.startDate ? new Date(req.query.startDate as string) : null;
    const periodEnd = req.query.endDate ? new Date(req.query.endDate as string) : null;
    const hasPeriod = !!(periodStart && periodEnd);
    const inPeriod = (d?: Date | null) => !hasPeriod || (!!d && d >= periodStart! && d <= periodEnd!);

    // Velocity window: the selected period, else the last 30 days.
    const vStart = periodStart ?? (() => { const d = new Date(); d.setDate(d.getDate() - 29); d.setHours(0, 0, 0, 0); return d; })();
    const vEnd = periodEnd ?? (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })();

    const [clients, leads, activeProjects, completedWithDue, overdueTasks, members, velTasks] = await Promise.all([
      prisma.client.findMany({
        where: { organizationId: orgId },
        select: {
          id: true, name: true, company: true, contractValue: true, status: true, updatedAt: true,
          projects: { select: { status: true, endDate: true, tasks: { select: { status: true, dueDate: true } } } },
        },
      }),
      prisma.lead.findMany({
        where: { organizationId: orgId },
        select: { dealValue: true, stage: true, lostReason: true, updatedAt: true },
      }),
      prisma.project.findMany({
        where: { client: { organizationId: orgId }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        select: { endDate: true, progress: true },
      }),
      prisma.task.findMany({
        where: {
          project: { client: { organizationId: orgId } },
          status: 'COMPLETED',
          dueDate: { not: null },
          completedAt: hasPeriod ? { gte: periodStart!, lte: periodEnd! } : { not: null },
        },
        select: { dueDate: true, completedAt: true },
      }),
      prisma.task.count({
        where: { project: { client: { organizationId: orgId } }, dueDate: { lt: todayStart }, status: { notIn: ['COMPLETED'] } },
      }),
      prisma.user.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { id: true, name: true, avatar: true, assignedTasks: { select: { status: true, loggedHours: true } } },
      }),
      prisma.task.findMany({
        where: { project: { client: { organizationId: orgId } }, status: 'COMPLETED', completedAt: { gte: vStart, lte: vEnd } },
        select: { completedAt: true },
      }),
    ]);

    // ── Revenue & Sales ──
    const activeRevenue = clients.filter(c => c.status === 'ACTIVE').reduce((s, c) => s + (c.contractValue || 0), 0);
    const WON_STAGES = ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED'];
    const pipelineValue = leads
      .filter(l => l.stage !== 'CHURNED' && l.stage !== 'PROJECT_COMPLETED')
      .reduce((s, l) => s + (l.dealValue || 0), 0);
    const won = leads.filter(l => WON_STAGES.includes(l.stage) && inPeriod(l.updatedAt));
    const lost = leads.filter(l => l.stage === 'CHURNED' && inPeriod(l.updatedAt));
    const wonValue = won.reduce((s, l) => s + (l.dealValue || 0), 0);
    const lostValue = lost.reduce((s, l) => s + (l.dealValue || 0), 0);
    const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
    const reasonMap: Record<string, { count: number; value: number }> = {};
    lost.forEach(l => {
      const r = l.lostReason || 'OTHER';
      if (!reasonMap[r]) reasonMap[r] = { count: 0, value: 0 };
      reasonMap[r].count++;
      reasonMap[r].value += l.dealValue || 0;
    });
    const lostReasons = Object.entries(reasonMap)
      .map(([reason, v]) => ({ reason, count: v.count, value: v.value }))
      .sort((a, b) => b.count - a.count);

    // ── Delivery & Operations ──
    let onTrack = 0, atRiskProjects = 0, delayed = 0;
    activeProjects.forEach(p => {
      if (p.endDate && p.endDate < todayStart) delayed++;
      else if (p.endDate) {
        const daysLeft = (p.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (daysLeft < 7 && p.progress < 80) atRiskProjects++; else onTrack++;
      } else onTrack++;
    });
    const onTimeCount = completedWithDue.filter(t => t.completedAt && t.dueDate && t.completedAt <= t.dueDate).length;
    const onTimeRate = completedWithDue.length > 0 ? Math.round((onTimeCount / completedWithDue.length) * 100) : 0;

    const velMap = new Map<string, { name: string; tasks: number }>();
    const diffDays = Math.ceil((vEnd.getTime() - vStart.getTime()) / (1000 * 60 * 60 * 24));
    const totalDays = Math.min(Math.max(diffDays, 1), 60);
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(vEnd.getTime());
      d.setDate(d.getDate() - i);
      velMap.set(d.toISOString().split('T')[0], { name: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tasks: 0 });
    }
    velTasks.forEach(t => {
      if (!t.completedAt) return;
      const key = t.completedAt.toISOString().split('T')[0];
      const entry = velMap.get(key);
      if (entry) entry.tasks++;
    });
    const velocity = Array.from(velMap.values());

    // ── Team & Utilization ──
    const teamMembers = members.map(m => {
      const completed = m.assignedTasks.filter(t => t.status === 'COMPLETED').length;
      const active = m.assignedTasks.filter(t => t.status !== 'COMPLETED').length;
      const total = m.assignedTasks.length;
      const loggedHours = m.assignedTasks.reduce((s, t) => s + (t.loggedHours || 0), 0);
      return {
        id: m.id, name: m.name, avatar: m.avatar,
        activeTasks: active,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        loggedHours,
        capacity: Math.min(100, Math.round((active / 10) * 100)),
      };
    }).sort((a, b) => b.activeTasks - a.activeTasks);
    const totalLoggedHours = teamMembers.reduce((s, m) => s + m.loggedHours, 0);
    const avgUtilization = teamMembers.length > 0 ? Math.round(teamMembers.reduce((s, m) => s + m.capacity, 0) / teamMembers.length) : 0;

    // ── Client Portfolio ──
    const portfolio = clients.map(c => {
      let cOverdue = 0;
      let pastEnd = false;
      c.projects.forEach(p => {
        if (p.endDate && new Date(p.endDate) < todayStart && p.status !== 'COMPLETED' && p.status !== 'CANCELLED') pastEnd = true;
        p.tasks.forEach(t => {
          if (t.status !== 'COMPLETED' && t.dueDate && new Date(t.dueDate) < todayStart) cOverdue++;
        });
      });
      let health = 'Green';
      if (cOverdue >= 3 || pastEnd) health = 'Red';
      else if (cOverdue > 0) health = 'Amber';
      return { name: (c.company || c.name) as string, contractValue: c.contractValue || 0, status: c.status, overdueTasks: cOverdue, health, updatedAt: c.updatedAt };
    });
    const topClients = [...portfolio]
      .filter(c => c.contractValue > 0)
      .sort((a, b) => b.contractValue - a.contractValue)
      .slice(0, 6)
      .map(c => ({ name: c.name, contractValue: c.contractValue, status: c.status }));
    const atRiskClients = portfolio
      .filter(c => c.health !== 'Green')
      .sort((a, b) => b.overdueTasks - a.overdueTasks)
      .slice(0, 8)
      .map(c => ({ name: c.name, health: c.health, overdueTasks: c.overdueTasks }));

    res.json({
      period: hasPeriod ? { startDate: periodStart, endDate: periodEnd } : null,
      revenue: { activeRevenue, pipelineValue, wonValue, lostValue, wonCount: won.length, lostCount: lost.length, winRate, lostReasons },
      delivery: { onTimeRate, overdueTasks, projectHealth: { onTrack, atRisk: atRiskProjects, delayed, total: activeProjects.length }, velocity },
      team: { avgUtilization, totalLoggedHours, members: teamMembers },
      clients: {
        totalClients: clients.length,
        active: clients.filter(c => c.status === 'ACTIVE').length,
        churned: clients.filter(c => c.status === 'CHURNED').length,
        inactive: clients.filter(c => c.status === 'PROJECT_COMPLETED').length,
        churnedInPeriod: clients.filter(c => c.status === 'CHURNED' && inPeriod(c.updatedAt)).length,
        topClients,
        atRisk: atRiskClients,
      },
    });
  } catch (error) {
    next(error);
  }
});
