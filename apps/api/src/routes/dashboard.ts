import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, hasPermission } from '../middleware/auth.js';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

dashboardRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const canSeeMoney = hasPermission(req.user!, 'money.figures');
    const canSeePipeline = hasPermission(req.user!, 'pipeline.read');
    const canSeeAllWork = hasPermission(req.user!, 'work.all');

    // 1. Tasks
    const allUserTasks = await prisma.task.findMany({
      // Anybody on the task, matching /tasks/my — the two screens answer
      // the same question and disagreeing about a shared task would be worse
      // than either answer.
      where: { organizationId: orgId, assignees: { some: { userId } }, deletedAt: null },
      orderBy: { dueDate: 'asc' },
      take: 20,
    });

    const overdueCount = allUserTasks.filter(
      (t) => t.status !== 'DONE' && t.status !== 'CANCELLED' && new Date(t.dueDate).toISOString().slice(0, 10) < todayStr,
    ).length;

    const dueTodayCount = allUserTasks.filter(
      (t) => t.status !== 'DONE' && t.status !== 'CANCELLED' && new Date(t.dueDate).toISOString().slice(0, 10) === todayStr,
    ).length;

    // 2. Delivery / Projects
    const [activeProjects, offTrackProjects, prospectsCount, clientsCount, pastCount] = await Promise.all([
      prisma.project.count({ where: { organizationId: orgId, status: 'LIVE' } }),
      prisma.project.count({ where: { organizationId: orgId, status: 'LIVE', endDate: { lt: new Date() } } }),
      prisma.company.count({ where: { organizationId: orgId, status: 'PROSPECT' } }),
      prisma.company.count({ where: { organizationId: orgId, status: 'CLIENT' } }),
      prisma.company.count({ where: { organizationId: orgId, status: 'PAST' } }),
    ]);

    // 3. Money Metrics
    let moneyData = null;
    if (canSeeMoney) {
      const activeRetainers = await prisma.retainer.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { monthlyValue: true },
      });
      const mrr = activeRetainers.reduce((acc, r) => acc + Number(r.monthlyValue), 0);

      moneyData = {
        mrr: String(mrr),
        billedThisMonth: String(mrr),
        collectedThisMonth: '0',
        overdue: '0',
        overdueInvoices: 0,
        invoicesToSend: 0,
        invoicesDueToRaise: 0,
        pricesDueForReview: 0,
      };
    }

    // 4. Pipeline Prompts
    let pipelineData = null;
    if (canSeePipeline) {
      pipelineData = {
        followUpsDue: [],
        companyFollowUpsDue: [],
        rotting: [],
        quotesAwaitingReply: [],
        quotesExpired: [],
      };
    }

    const payload = {
      work: {
        overdue: overdueCount,
        dueToday: dueTodayCount,
        awaitingMyReview: 0,
        tasks: allUserTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
          workType: t.workType,
        })),
      },
      delivery: {
        active: activeProjects,
        offTrack: offTrackProjects,
      },
      clients: {
        PROSPECT: prospectsCount,
        ACTIVE: clientsCount,
        CLIENT: clientsCount,
        ONHOLD: 0,
        PROJECT_COMPLETED: 0,
        CHURNED: pastCount,
        PAST: pastCount,
      },
      money: moneyData,
      pipeline: pipelineData,
    };

    res.json(payload);
  } catch (e) {
    next(e);
  }
});
