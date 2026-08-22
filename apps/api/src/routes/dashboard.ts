/**
 * The morning screen.
 *
 * What needs attention today, addressed to the person reading it. Everything here
 * is computed at read time — a stored "overdue" is wrong the night a job fails
 * (master plan §3.8).
 *
 * What each role sees differs by ROWS and FIELDS rather than by a 403. People
 * should see their own world rather than hit walls (§3.10).
 */

import { Router, type Response, type NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { startOfDay, endOfDay, isBeforeToday, daysBetween } from '../utils/orgDay.js';
import { calculateMrr } from '../services/engagement.service.js';
import { revenueSummary } from '../services/invoice.service.js';
import { isRotting } from '../services/stageRules.js';
import { findAwaitingReply } from '../services/quote.service.js';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

dashboardRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;
    const org = await getOrgConfig(orgId);
    const now = new Date();

    // Every day boundary is calculated in the ORGANISATION's timezone, so "due
    // today" means what the person reading it expects (§3.11).
    const todayEnd = endOfDay(now, org.timezone);
    const canSeeMoney = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.role);
    const canSeePipeline = ['SALES', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(req.user!.role);

    // ── Everyone: their own work ────────────────────────────────────────────
    const myTasks = await prisma.task.findMany({
      where: {
        organizationId: orgId,
        status: { not: 'DONE' },
        OR: [{ assigneeId: userId }, { reviewerId: userId }],
      },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    const work = {
      overdue: myTasks.filter((t) => t.dueDate && isBeforeToday(t.dueDate, org.timezone, now)).length,
      dueToday: myTasks.filter(
        (t) => t.dueDate && t.dueDate <= todayEnd && !isBeforeToday(t.dueDate, org.timezone, now),
      ).length,
      awaitingMyReview: myTasks.filter((t) => t.reviewerId === userId && t.status === 'IN_REVIEW').length,
      tasks: myTasks.slice(0, 10),
    };

    const payload: Record<string, unknown> = { work };

    // ── Sales and above: the pipeline ───────────────────────────────────────
    if (canSeePipeline) {
      const [followUps, staleDeals, awaitingReply] = await Promise.all([
        prisma.deal.findMany({
          where: {
            organizationId: orgId,
            isOnHold: false,
            followUpDate: { not: null, lte: todayEnd },
            stage: { kind: 'OPEN' },
            // Addressed to whoever owns it. A notification to the whole team is
            // one nobody acts on (§4.12).
            ownerId: userId,
          },
          include: { company: { select: { id: true, name: true } } },
          orderBy: { followUpDate: 'asc' },
          take: 20,
        }),
        prisma.deal.findMany({
          where: { organizationId: orgId, isOnHold: false, stage: { kind: 'OPEN' }, ownerId: userId },
          include: {
            company: { select: { id: true, name: true } },
            stage: { select: { name: true, kind: true, rottingDays: true } },
            stageHistory: { orderBy: { enteredAt: 'desc' }, take: 1 },
          },
        }),
        findAwaitingReply(orgId, 7),
      ]);

      const rotting = staleDeals
        .map((d) => {
          const enteredAt = d.stageHistory[0]?.enteredAt ?? d.createdAt;
          const daysInStage = daysBetween(now, enteredAt, org.timezone);
          return { deal: d, daysInStage };
        })
        .filter(({ deal, daysInStage }) =>
          isRotting({ kind: deal.stage.kind, rottingDays: deal.stage.rottingDays }, daysInStage),
        )
        .map(({ deal, daysInStage }) => ({
          id: deal.id,
          title: deal.title,
          company: deal.company,
          stage: deal.stage.name,
          daysInStage,
          blockedOn: deal.blockedOn,
        }));

      payload.pipeline = {
        followUpsDue: followUps,
        rotting,
        // Accepted and declined both get recorded by somebody. Silence is
        // recorded by nobody, which is why it is surfaced here (§3.12).
        quotesAwaitingReply: awaitingReply
          .filter((q) => q.deal.ownerId === userId)
          .map((q) => ({
            id: q.id,
            number: q.number,
            company: q.company,
            total: q.total.toString(),
            sentAt: q.sentAt,
            daysWaiting: q.sentAt ? daysBetween(now, q.sentAt, org.timezone) : null,
          })),
      };
    }

    // ── Admin and above: the money ──────────────────────────────────────────
    if (canSeeMoney) {
      const monthStart = startOfDay(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        org.timezone,
      );

      const [mrr, summary, dueForBilling, attention] = await Promise.all([
        calculateMrr(orgId),
        revenueSummary(orgId, monthStart, now),
        prisma.engagement.count({
          where: { organizationId: orgId, status: 'ACTIVE', nextBillingDate: { not: null, lte: todayEnd } },
        }),
        prisma.engagement.count({
          where: {
            organizationId: orgId,
            status: 'ACTIVE',
            endDate: null,
            nextReviewDate: { lte: new Date(now.getTime() + 30 * 86_400_000) },
          },
        }),
      ]);

      payload.money = {
        // Three numbers, none derived from another. A month can look excellent on
        // the first and be empty on the third (§3.8).
        mrr: mrr.toString(),
        billedThisMonth: summary.billed.toString(),
        collectedThisMonth: summary.collected.toString(),
        outstanding: summary.outstanding.toString(),
        overdue: summary.overdue.toString(),
        invoicesDueToRaise: dueForBilling,
        pricesDueForReview: attention,
      };
    }

    // ── The client picture ──────────────────────────────────────────────────
    const statusCounts = await prisma.company.groupBy({
      by: ['status'],
      where: { organizationId: orgId, archivedAt: null },
      _count: { _all: true },
    });

    payload.clients = Object.fromEntries(
      statusCounts.map((s) => [s.status, s._count._all]),
    );

    res.json({ success: true, data: payload });
  } catch (e) {
    next(e);
  }
});
