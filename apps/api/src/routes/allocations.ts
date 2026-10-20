import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, hasPermission, requirePermission } from '../middleware/auth.js';
import { MonthCardStatus, TaskWorkType } from '@prisma/client';
import { canSeePerson, peopleInScope } from '../services/teamScope.js';
import { monthCardRefusal } from '../utils/monthCardOpen.js';

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
    /*
     * `?departmentId=` is My Department's Time split tab: that department's
     * people, narrowed by the caller's team scope like every head screen, and
     * percentages only — never money, not even for an admin looking at it.
     */
    const departmentId = typeof req.query.departmentId === 'string' && req.query.departmentId ? req.query.departmentId : null;
    const canSeeFigures = !departmentId && hasPermission(req.user!, 'setup.admin');

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetMonth = (req.query.month as string) || currentMonthKey;

    const base = { organizationId: orgId, active: true };
    const team = await prisma.user.findMany({
      where: departmentId ? await peopleInScope(req.user!, { ...base, departmentId }) : base,
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

type BulkItem = z.infer<typeof bulkAllocationSchema>['allocations'][number];

/** The month card an allocation is against, if it is against one. */
const cardOf = (a: { workType: string; workId: string; monthCardId?: string | null }) =>
  a.monthCardId || (a.workType === TaskWorkType.MONTH_CARD ? a.workId : null);

/**
 * Every piece of work named is this organisation's.
 *
 * The ids were written exactly as they arrived, so a split could be pointed at
 * another organisation's retainer month or project — and the time split is
 * what people's cost is apportioned by.
 */
async function workRefusal(orgId: string, items: BulkItem[]): Promise<string | null> {
  const cards = new Set<string>();
  const projects = new Set<string>();
  const internal = new Set<string>();
  for (const item of items) {
    if (item.workType === TaskWorkType.MONTH_CARD) cards.add(item.workId);
    else if (item.workType === TaskWorkType.PROJECT) projects.add(item.workId);
    else internal.add(item.workId);
    if (item.monthCardId) cards.add(item.monthCardId);
    if (item.projectId) projects.add(item.projectId);
  }
  const [cardCount, projectCount, internalCount] = await Promise.all([
    cards.size
      ? prisma.monthCard.count({ where: { id: { in: [...cards] }, retainer: { organizationId: orgId } } })
      : 0,
    projects.size
      ? prisma.project.count({ where: { id: { in: [...projects] }, organizationId: orgId, deletedAt: null } })
      : 0,
    internal.size
      ? prisma.internalProject.count({ where: { id: { in: [...internal] }, organizationId: orgId } })
      : 0,
  ]);
  if (cardCount !== cards.size || projectCount !== projects.size || internalCount !== internal.size) {
    return 'One of those pieces of work is not one of yours.';
  }
  return null;
}

/**
 * POST /api/allocations/bulk — Save monthly allocations for a member
 *
 * Three refusals this used to lack: work from outside the organisation; a
 * Head changing the split of somebody outside the departments they lead (the
 * confirm route below already refused that); and a closed month, whose profit
 * has been reported — the same lock costs have (utils/monthCardOpen).
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

      // A Head: only the people of the departments they lead (and themselves).
      if (!(await canSeePerson(req.user!, userId))) {
        res.status(403).json({
          success: false,
          error: 'You can change the split only for people in the departments you lead.',
        });
        return;
      }

      const badWork = await workRefusal(orgId, allocations);
      if (badWork) {
        res.status(400).json({ success: false, error: badWork });
        return;
      }

      /*
       * A closed month stays as it was reported.
       *
       * The form posts the person's whole split, closed months included, so
       * a closed month's rows that come back unchanged are left exactly as
       * they are (confirmation and all) rather than deleted and written again;
       * any change to one is refused.
       */
      const existing = await prisma.peopleAllocation.findMany({
        where: { userId, month },
        select: { id: true, workType: true, workId: true, monthCardId: true, percent: true, proposedPercent: true },
      });
      const touchedCards = [
        ...new Set([...existing.map(cardOf), ...allocations.map(cardOf)].filter((c): c is string => Boolean(c))),
      ];
      const closedCards = touchedCards.length
        ? (
            await prisma.monthCard.findMany({
              where: { id: { in: touchedCards }, status: MonthCardStatus.CLOSED },
              select: { id: true },
            })
          ).map((c) => c.id)
        : [];
      const signature = (rows: { workId: string; percent: number; proposedPercent?: number | null }[]) =>
        rows
          .map((r) => `${r.workId}:${r.percent}:${r.proposedPercent ?? r.percent}`)
          .sort()
          .join('|');
      const keep: string[] = [];
      for (const cardId of closedCards) {
        const before = existing.filter((a) => cardOf(a) === cardId);
        const after = allocations.filter((a) => cardOf(a) === cardId);
        if (signature(before) !== signature(after)) {
          const closed = await monthCardRefusal(cardId, 'Changing these allocations');
          res.status(400).json({ success: false, error: closed });
          return;
        }
        keep.push(...before.map((a) => a.id));
      }
      const open = allocations.filter((a) => {
        const card = cardOf(a);
        return !card || !closedCards.includes(card);
      });

      // Atomically replace user's allocations for this month
      await prisma.$transaction(async (tx) => {
        await tx.peopleAllocation.deleteMany({
          where: { userId, month, ...(keep.length ? { id: { notIn: keep } } : {}) },
        });

        if (open.length > 0) {
          for (const item of open) {
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
 *
 * A Head confirms the split for the people of the departments they lead;
 * Accounts and Management confirm anybody's. Without `userIds` it is everybody
 * the caller may confirm — for a Head, all of theirs.
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

      const whose = await peopleInScope(req.user!, { organizationId: orgId });
      if (userIds && userIds.length > 0) {
        const asked = Array.from(new Set(userIds));
        const allowed = await prisma.user.count({ where: { AND: [whose, { id: { in: asked } }] } });
        if (allowed < asked.length) {
          res.status(403).json({
            success: false,
            error: 'You can confirm the split only for people in the departments you lead.',
          });
          return;
        }
      }

      const where: any = {
        month,
        user: whose,
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
