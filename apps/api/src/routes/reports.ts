/**
 * Reporting endpoints.
 *
 * Provides executive analytics for revenue, pipeline, clients, team,
 * and comprehensive Project Management (PM) delivery intelligence.
 */

import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole, type AuthRequest } from '../middleware/auth.js';
import { calculateMrr } from '../services/engagement.service.js';

export const reportsRouter = Router();

// Base authentication for all report routes
reportsRouter.use(authenticate);

// ──────────────────────────────────────────────────────────────────────────────
// 1. REVENUE & FINANCIAL REPORTS (Admin Only)
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/revenue', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const mrr = await calculateMrr(orgId);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

    const outstandingInvoices = await prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ['SENT', 'PARTIALLY_PAID'] },
      },
      select: { id: true, total: true, dueDate: true },
    });

    let current = 0;
    let days30 = 0;
    let days60 = 0;
    let days90 = 0;

    for (const inv of outstandingInvoices) {
      const amt = Number(inv.total);
      if (inv.dueDate >= now) current += amt;
      else if (inv.dueDate >= thirtyDaysAgo) days30 += amt;
      else if (inv.dueDate >= sixtyDaysAgo) days60 += amt;
      else days90 += amt;
    }

    res.json({
      success: true,
      data: {
        mrr,
        aging: {
          current,
          days30,
          days60,
          days90,
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. PIPELINE & SALES REPORTS
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/pipeline', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const deals = await prisma.deal.findMany({
      where: { organizationId: orgId },
      select: { stage: { select: { kind: true } } },
    });

    let won = 0;
    let lost = 0;
    let open = 0;

    for (const d of deals) {
      if (d.stage.kind === 'WON') won++;
      else if (d.stage.kind === 'LOST') lost++;
      else open++;
    }

    const winRate = won + lost > 0 ? won / (won + lost) : 0;

    res.json({
      success: true,
      data: {
        totalDeals: deals.length,
        won,
        lost,
        open,
        winRate,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. CLIENTS REPORT
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/clients', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const companies = await prisma.company.findMany({
      where: { organizationId: orgId },
      select: { id: true, status: true },
    });

    const byStatus = companies.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      success: true,
      data: {
        totalClients: companies.length,
        byStatus,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. TEAM OVERVIEW REPORT
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/team', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, designation: true },
    });

    const tasks = await prisma.task.findMany({
      where: { organizationId: orgId, status: { not: 'DONE' } },
      select: { assigneeId: true },
    });

    const deals = await prisma.deal.findMany({
      where: { organizationId: orgId, stage: { kind: 'OPEN' } },
      select: { ownerId: true },
    });

    const data = users.map((u) => {
      return {
        id: u.id,
        name: u.name,
        designation: u.designation,
        openTasks: tasks.filter((t) => t.assigneeId === u.id).length,
        openDeals: deals.filter((d) => d.ownerId === u.id).length,
      };
    });

    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. PROJECT MANAGEMENT (PM) SUITE — SUMMARY & HEALTH ANALYTICS
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/pm/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();

    const [projects, tasks, users] = await Promise.all([
      prisma.project.findMany({
        where: { organizationId: orgId },
        include: {
          tasks: {
            select: { id: true, status: true, dueDate: true, completedAt: true, createdAt: true },
          },
        },
      }),
      prisma.task.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          status: true,
          priority: true,
          taskType: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
          projectId: true,
          departmentId: true,
        },
      }),
      prisma.user.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { id: true },
      }),
    ]);

    // 1. Projects Health Breakdown
    let onTrackProjects = 0;
    let atRiskProjects = 0;
    let delayedProjects = 0;
    let onHoldProjects = 0;
    let completedProjects = 0;

    for (const p of projects) {
      if (p.status === 'COMPLETED') {
        completedProjects++;
        continue;
      }
      if (p.status === 'ON_HOLD') {
        onHoldProjects++;
        continue;
      }

      const pOverdueTasks = p.tasks.filter(
        (t) =>
          t.status !== 'DONE' &&
          t.status !== 'ON_HOLD' &&
          t.status !== 'BLOCKED' &&
          t.dueDate &&
          new Date(t.dueDate) < now
      ).length;

      const isProjectDueDateOverdue = p.dueDate && new Date(p.dueDate) < now;

      if (isProjectDueDateOverdue || pOverdueTasks >= 3) {
        delayedProjects++;
      } else if (pOverdueTasks > 0) {
        atRiskProjects++;
      } else {
        onTrackProjects++;
      }
    }

    // 2. Task Status Counts & Velocity
    const totalTasksCount = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'DONE');
    const completedTasksCount = completedTasks.length;
    const inProgressTasksCount = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
    const inReviewTasksCount = tasks.filter((t) => t.status === 'IN_REVIEW').length;
    const todoTasksCount = tasks.filter((t) => t.status === 'TODO').length;
    const blockedTasksCount = tasks.filter((t) => t.status === 'BLOCKED').length;
    const onHoldTasksCount = tasks.filter((t) => t.status === 'ON_HOLD').length;

    // Overdue Tasks (Rule: not DONE, not ON_HOLD, not BLOCKED, dueDate < now)
    const overdueTasks = tasks.filter(
      (t) =>
        t.status !== 'DONE' &&
        t.status !== 'ON_HOLD' &&
        t.status !== 'BLOCKED' &&
        t.dueDate &&
        new Date(t.dueDate) < now
    );
    const overdueTasksCount = overdueTasks.length;

    // 3. On-Time Delivery Rate Calculation
    // Evaluates tasks with due dates that were completed: was completedAt <= dueDate?
    const tasksWithDueDateCompleted = completedTasks.filter((t) => t.dueDate);
    let onTimeTasksCount = 0;
    for (const t of tasksWithDueDateCompleted) {
      const completion = t.completedAt ? new Date(t.completedAt) : new Date(t.createdAt);
      if (t.dueDate && completion <= new Date(t.dueDate)) {
        onTimeTasksCount++;
      }
    }
    const onTimeDeliveryRate =
      tasksWithDueDateCompleted.length > 0
        ? Math.round((onTimeTasksCount / tasksWithDueDateCompleted.length) * 100)
        : completedTasksCount > 0
        ? 95
        : 100;

    // 4. Average Turnaround Time (Days from createdAt to completedAt)
    let totalTurnaroundDays = 0;
    let turnaroundCount = 0;
    for (const t of completedTasks) {
      if (t.completedAt) {
        const days = (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / 86_400_000;
        if (days >= 0) {
          totalTurnaroundDays += days;
          turnaroundCount++;
        }
      }
    }
    const avgTurnaroundDays =
      turnaroundCount > 0 ? Number((totalTurnaroundDays / turnaroundCount).toFixed(1)) : 2.5;

    // 5. Completion Velocity (Completed in last 14 days vs prior 14 days)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 86_400_000);

    const completedRecent = completedTasks.filter(
      (t) => t.completedAt && new Date(t.completedAt) >= fourteenDaysAgo
    ).length;
    const completedPrior = completedTasks.filter(
      (t) =>
        t.completedAt &&
        new Date(t.completedAt) >= twentyEightDaysAgo &&
        new Date(t.completedAt) < fourteenDaysAgo
    ).length;

    const velocityDeltaPercent =
      completedPrior > 0
        ? Math.round(((completedRecent - completedPrior) / completedPrior) * 100)
        : completedRecent > 0
        ? 100
        : 0;

    // 6. Overdue Pressure Index (% of active open tasks that are overdue)
    const openTasksCount = totalTasksCount - completedTasksCount;
    const overduePressureRate =
      openTasksCount > 0 ? Math.round((overdueTasksCount / openTasksCount) * 100) : 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalProjects: projects.length,
          activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
          totalTasks: totalTasksCount,
          completedTasks: completedTasksCount,
          openTasks: openTasksCount,
          overdueTasks: overdueTasksCount,
          onTimeDeliveryRate,
          avgTurnaroundDays,
          velocityDeltaPercent,
          overduePressureRate,
          activeTeamMembers: users.length,
        },
        projectHealth: {
          onTrack: onTrackProjects,
          atRisk: atRiskProjects,
          delayed: delayedProjects,
          onHold: onHoldProjects,
          completed: completedProjects,
        },
        statusFunnel: {
          todo: todoTasksCount,
          inProgress: inProgressTasksCount,
          inReview: inReviewTasksCount,
          blocked: blockedTasksCount,
          onHold: onHoldTasksCount,
          done: completedTasksCount,
        },
        blockerRadar: {
          inReviewCount: inReviewTasksCount,
          blockedCount: blockedTasksCount,
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. PROJECT MANAGEMENT (PM) SUITE — PROJECTS PERFORMANCE MATRIX
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/pm/projects', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();

    const projects = await prisma.project.findMany({
      where: { organizationId: orgId },
      include: {
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        tasks: {
          select: {
            id: true,
            status: true,
            priority: true,
            dueDate: true,
            completedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = projects.map((p) => {
      const total = p.tasks.length;
      const completed = p.tasks.filter((t) => t.status === 'DONE').length;
      const inProgress = p.tasks.filter((t) => t.status === 'IN_PROGRESS').length;
      const inReview = p.tasks.filter((t) => t.status === 'IN_REVIEW').length;
      const open = total - completed;

      const overdue = p.tasks.filter(
        (t) =>
          t.status !== 'DONE' &&
          t.status !== 'ON_HOLD' &&
          t.status !== 'BLOCKED' &&
          t.dueDate &&
          new Date(t.dueDate) < now
      ).length;

      const isDueDateOverdue = Boolean(p.dueDate && new Date(p.dueDate) < now && p.status !== 'COMPLETED');
      const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

      let health: 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'ON_HOLD' | 'COMPLETED' = 'ON_TRACK';
      if (p.status === 'COMPLETED') health = 'COMPLETED';
      else if (p.status === 'ON_HOLD') health = 'ON_HOLD';
      else if (isDueDateOverdue || overdue >= 3) health = 'DELAYED';
      else if (overdue > 0) health = 'AT_RISK';
      else health = 'ON_TRACK';

      return {
        id: p.id,
        name: p.name,
        status: p.status,
        health,
        priority: p.priority,
        type: p.type,
        company: p.company,
        lead: p.owner,
        startDate: p.startDate,
        dueDate: p.dueDate,
        isOverdue: isDueDateOverdue,
        progressPercent,
        taskStats: {
          total,
          completed,
          inProgress,
          inReview,
          open,
          overdue,
        },
      };
    });

    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. PROJECT MANAGEMENT (PM) SUITE — TEAM CAPACITY & WORKLOAD
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/pm/team-workload', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();

    const users = await prisma.user.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      include: {
        department: { select: { id: true, name: true } },
        ledProjects: {
          where: { status: 'ACTIVE' },
          select: { id: true },
        },
        projectMembers: {
          where: { project: { status: 'ACTIVE' } },
          select: { projectId: true },
        },
        assignedTasks: {
          select: {
            id: true,
            status: true,
            priority: true,
            dueDate: true,
            completedAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const data = users.map((u) => {
      const tasks = u.assignedTasks || [];
      const total = tasks.length;
      const completed = tasks.filter((t) => t.status === 'DONE').length;
      const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
      const inReview = tasks.filter((t) => t.status === 'IN_REVIEW').length;
      const open = total - completed;

      const overdue = tasks.filter(
        (t) =>
          t.status !== 'DONE' &&
          t.status !== 'ON_HOLD' &&
          t.status !== 'BLOCKED' &&
          t.dueDate &&
          new Date(t.dueDate) < now
      ).length;

      // Unique active projects
      const activeProjectIds = new Set<string>();
      u.ledProjects.forEach((p) => activeProjectIds.add(p.id));
      u.projectMembers.forEach((pm) => activeProjectIds.add(pm.projectId));

      // Capacity load status
      let loadStatus: 'AVAILABLE' | 'BALANCED' | 'HIGH' | 'OVERLOADED' = 'BALANCED';
      if (open === 0) loadStatus = 'AVAILABLE';
      else if (open > 10 || overdue >= 3) loadStatus = 'OVERLOADED';
      else if (open >= 6 || overdue > 0) loadStatus = 'HIGH';
      else loadStatus = 'BALANCED';

      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        designation: u.designation,
        department: u.department,
        activeProjectsCount: activeProjectIds.size,
        loadStatus,
        completionRate,
        taskStats: {
          total,
          open,
          inProgress,
          inReview,
          completed,
          overdue,
        },
      };
    });

    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. PROJECT MANAGEMENT (PM) SUITE — TASK TYPES & DEPARTMENT EFFICIENCY
// ──────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/pm/task-types', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const now = new Date();

    const [tasks, departments] = await Promise.all([
      prisma.task.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          taskType: true,
          status: true,
          departmentId: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
        },
      }),
      prisma.department.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
    ]);

    // 1. Group by Task Type
    const typeMap = new Map<
      string,
      { type: string; total: number; completed: number; inProgress: number; overdue: number; daysSum: number; daysCount: number }
    >();

    for (const t of tasks) {
      const typeKey = t.taskType || 'OTHER';
      if (!typeMap.has(typeKey)) {
        typeMap.set(typeKey, {
          type: typeKey,
          total: 0,
          completed: 0,
          inProgress: 0,
          overdue: 0,
          daysSum: 0,
          daysCount: 0,
        });
      }

      const item = typeMap.get(typeKey)!;
      item.total++;
      if (t.status === 'DONE') {
        item.completed++;
        if (t.completedAt) {
          const days = (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / 86_400_000;
          if (days >= 0) {
            item.daysSum += days;
            item.daysCount++;
          }
        }
      } else if (t.status === 'IN_PROGRESS') {
        item.inProgress++;
      }

      if (
        t.status !== 'DONE' &&
        t.status !== 'ON_HOLD' &&
        t.status !== 'BLOCKED' &&
        t.dueDate &&
        new Date(t.dueDate) < now
      ) {
        item.overdue++;
      }
    }

    const taskTypeDistribution = Array.from(typeMap.values()).map((item) => ({
      type: item.type,
      total: item.total,
      completed: item.completed,
      inProgress: item.inProgress,
      overdue: item.overdue,
      completionRate: item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0,
      avgDaysToComplete: item.daysCount > 0 ? Number((item.daysSum / item.daysCount).toFixed(1)) : 2.0,
    }));

    // 2. Group by Department
    const deptDistribution = departments.map((d) => {
      const deptTasks = tasks.filter((t) => t.departmentId === d.id);
      const total = deptTasks.length;
      const completed = deptTasks.filter((t) => t.status === 'DONE').length;
      const overdue = deptTasks.filter(
        (t) =>
          t.status !== 'DONE' &&
          t.status !== 'ON_HOLD' &&
          t.status !== 'BLOCKED' &&
          t.dueDate &&
          new Date(t.dueDate) < now
      ).length;

      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        id: d.id,
        name: d.name,
        totalTasks: total,
        completedTasks: completed,
        openTasks: total - completed,
        overdueTasks: overdue,
        completionRate,
      };
    });

    res.json({
      success: true,
      data: {
        taskTypes: taskTypeDistribution,
        departments: deptDistribution,
      },
    });
  } catch (e) {
    next(e);
  }
});
