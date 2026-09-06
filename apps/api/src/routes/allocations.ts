import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, hasPermission, requirePermission } from '../middleware/auth.js';
import { TaskWorkType } from '@prisma/client';

export const allocationsRouter = Router();

allocationsRouter.use(authenticate);

/**
 * GET /api/allocations — List monthly people allocations
 */
allocationsRouter.get('/', requirePermission('cost.enter'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    // §6: "monthlyCost — readable only with setup.admin. Never leaves the
    // server for anyone else" — money.figures (Accounts holds this without
    // setup.admin) is not the same gate. This screen's whole design intent
    // (§6 PeopleAllocation) is percentages only; salary must stay hidden
    // even from whoever is confirming a split. Same gate as team.ts/projects.ts.
    const canSeeFigures = hasPermission(req.user!, 'setup.admin');

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetMonth = (req.query.month as string) || currentMonthKey;

    const team = await prisma.user.findMany({
      where: { organizationId: orgId, active: true },
      select: {
        id: true,
        name: true,
        email: true,
        dept: true,
        preset: true,
        monthlyCost: true,
        allocations: {
          where: { month: targetMonth },
          include: {
            monthCard: {
              select: {
                id: true,
                month: true,
                retainer: { select: { id: true, company: { select: { id: true, name: true } } } },
              },
            },
            project: {
              select: {
                id: true,
                name: true,
                company: { select: { id: true, name: true } },
              },
            },
            confirmedBy: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const members = team.map((member) => {
      const totalPercent = member.allocations.reduce((acc, a) => acc + a.percent, 0);
      const isConfirmed = member.allocations.length > 0 && member.allocations.every((a) => Boolean(a.confirmedAt));

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        dept: member.dept,
        preset: member.preset,
        monthlyCost: canSeeFigures ? Number(member.monthlyCost) : null,
        totalPercent,
        capacityStatus: totalPercent > 100 ? 'OVERALLOCATED' : totalPercent === 100 ? 'FULL' : 'AVAILABLE',
        isConfirmed,
        allocations: member.allocations.map((a) => {
          const salaryCost = canSeeFigures ? Math.round((Number(member.monthlyCost) * a.percent) / 100) : null;
          return {
            id: a.id,
            workType: a.workType,
            workId: a.workId,
            monthCardId: a.monthCardId,
            projectId: a.projectId,
            percent: a.percent,
            proposedPercent: a.proposedPercent,
            salaryCost,
            confirmedAt: a.confirmedAt,
            confirmedBy: a.confirmedBy,
            jobTitle: a.monthCard
              ? `${a.monthCard.retainer.company.name} (Retainer ${a.monthCard.month})`
              : a.project
              ? `${a.project.company.name} (${a.project.name})`
              : 'Unknown Job',
          };
        }),
      };
    });

    res.json({
      success: true,
      month: targetMonth,
      // Say so, rather than leaving the screen to infer it from nulls. It was
      // summing `monthlyCost ?? 0` across a masked list and printing the result
      // as "Total Payroll ₹0" — a figure, stated confidently, to somebody not
      // allowed to see figures. An org where everybody genuinely earns nothing
      // is indistinguishable from that, which is why this is a flag and not a
      // guess.
      canSeeFigures,
      members,
      summary: {
        totalMembers: team.length,
        fullyAllocated: members.filter((m) => m.totalPercent >= 100).length,
        availableCapacity: members.filter((m) => m.totalPercent < 100).length,
        overallocated: members.filter((m) => m.totalPercent > 100).length,
      },
    });
  } catch (e) {
    next(e);
  }
});

const workTypeSchema = z.enum(['MONTH_CARD', 'RETAINER', 'PROJECT', 'INTERNAL']).transform((val) => {
  if (val === 'RETAINER') return TaskWorkType.MONTH_CARD;
  return val as TaskWorkType;
});

const bulkAllocationSchema = z.object({
  userId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  allocations: z.array(
    z.object({
      workType: workTypeSchema,
      workId: z.string().min(1),
      monthCardId: z.string().optional().nullable(),
      projectId: z.string().optional().nullable(),
      percent: z.number().int().min(0).max(100),
      proposedPercent: z.number().int().min(0).max(100).optional(),
    }),
  ),
});

/**
 * POST /api/allocations/bulk — Save monthly allocations for a member
 */
allocationsRouter.post(
  '/bulk',
  requirePermission('cost.enter'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = bulkAllocationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const { userId, month, allocations } = parsed.data;
      const orgId = req.user!.organizationId;

      // Verify user belongs to org
      const user = await prisma.user.findFirst({
        where: { id: userId, organizationId: orgId },
      });
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found in organization' });
        return;
      }

      // Atomically replace user's allocations for this month
      await prisma.$transaction(async (tx) => {
        await tx.peopleAllocation.deleteMany({
          where: { userId, month },
        });

        if (allocations.length > 0) {
          for (const item of allocations) {
            await tx.peopleAllocation.create({
              data: {
                userId,
                month,
                workType: item.workType,
                workId: item.workId,
                monthCardId: item.monthCardId || undefined,
                projectId: item.projectId || undefined,
                percent: item.percent,
                proposedPercent: item.proposedPercent ?? item.percent,
              },
            });
          }
        }
      });

      // Percentages only — never a rupee figure, per §6: "This table never
      // stores money." That holds for the audit trail too.
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'User',
          entityId: userId,
          actorId: req.user!.userId,
          verb: 'allocations_updated',
          payload: { month, jobCount: allocations.length },
        },
      });

      res.status(201).json({ success: true, message: 'Allocations updated successfully' });
    } catch (e) {
      next(e);
    }
  },
);

const confirmSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  userIds: z.array(z.string()).optional(),
});

/**
 * POST /api/allocations/confirm — Confirm allocations for the month
 */
allocationsRouter.post(
  '/confirm',
  requirePermission('cost.enter'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = confirmSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const { month, userIds } = parsed.data;
      const orgId = req.user!.organizationId;
      const approverId = req.user!.userId;

      const where: any = {
        month,
        user: { organizationId: orgId },
      };
      if (userIds && userIds.length > 0) {
        where.userId = { in: userIds };
      }

      const updated = await prisma.peopleAllocation.updateMany({
        where,
        data: {
          confirmedById: approverId,
          confirmedAt: new Date(),
        },
      });

      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Organization',
          entityId: orgId,
          actorId: approverId,
          verb: 'allocations_confirmed',
          payload: { month, userIds: userIds ?? null, confirmedCount: updated.count },
        },
      });

      res.json({ success: true, confirmedCount: updated.count });
    } catch (e) {
      next(e);
    }
  },
);
