import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, hasPermission, requirePermission } from '../middleware/auth.js';
import { CostType, CostPaidBy, CostTreatment, TaskWorkType } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { toCsv } from '../utils/csv.js';
import { sendCsv } from '../utils/csvResponse.js';

export const costsRouter = Router();

costsRouter.use(authenticate);

/**
 * GET /api/costs — List direct and company costs
 *
 * §10 places the cost register under the money.figures-gated Money screen —
 * but someone with cost.enter (HEAD, ACCOUNTS) reasonably needs to browse
 * what they've entered, so that's the other way in. Neither key alone was
 * being checked at all: any authenticated user, including a plain EMPLOYEE,
 * could list every vendor, category and loan treatment in the org (only the
 * rupee amount was masked).
 */
costsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const canBrowse = canSeeFigures || hasPermission(req.user!, 'cost.enter');
    if (!canBrowse) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        detail: "This action requires the 'money.figures' or 'cost.enter' permission switch.",
      });
      return;
    }
    const { type, monthCardId, projectId, category, month } = req.query;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    const where: any = { organizationId: orgId, deletedAt: null };
    if (type && typeof type === 'string' && Object.values(CostType).includes(type as CostType)) {
      where.type = type as CostType;
    }
    if (monthCardId && typeof monthCardId === 'string') {
      where.monthCardId = monthCardId;
    }
    if (projectId && typeof projectId === 'string') {
      where.projectId = projectId;
    }
    if (category && typeof category === 'string') {
      where.category = category;
    }
    if (month && typeof month === 'string') {
      // Filter by month YYYY-MM
      const start = new Date(`${month}-01`);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      where.incurredAt = { gte: start, lte: end };
    }

    const [costs, total] = await Promise.all([
      prisma.cost.findMany({
        where,
        orderBy: { incurredAt: 'desc' },
        skip,
        take,
        include: {
          enteredBy: { select: { id: true, name: true } },
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
        },
      }),
      prisma.cost.count({ where }),
    ]);

    const data = costs.map((c) => ({
      id: c.id,
      type: c.type,
      workType: c.workType,
      workId: c.workId,
      category: c.category,
      vendor: c.vendor,
      amount: canSeeFigures ? Number(c.amount) : null,
      incurredAt: c.incurredAt,
      committedNotPaid: c.committedNotPaid,
      paidBy: c.paidBy,
      treatment: c.treatment,
      enteredBy: c.enteredBy,
      recurring: c.recurring,
      recurringSourceId: c.recurringSourceId,
      confirmed: c.confirmed,
      notes: c.notes,
      monthCard: c.monthCard,
      project: c.project,
    }));

    if (wantsCsv) {
      const csv = toCsv(data, [
        { label: 'Type', value: (c) => c.type },
        { label: 'Category', value: (c) => c.category },
        { label: 'Vendor', value: (c) => c.vendor },
        { label: 'Amount', value: (c) => c.amount ?? '' },
        { label: 'Incurred', value: (c) => c.incurredAt.toISOString().slice(0, 10) },
        { label: 'Committed, not paid', value: (c) => (c.committedNotPaid ? 'Yes' : 'No') },
        { label: 'Paid by', value: (c) => c.paidBy },
        { label: 'Treatment', value: (c) => c.treatment },
        { label: 'Entered by', value: (c) => c.enteredBy.name },
        { label: 'Recurring', value: (c) => (c.recurring ? 'Yes' : 'No') },
        { label: 'Client', value: (c) => c.monthCard?.retainer.company.name ?? c.project?.company.name ?? '' },
      ]);
      sendCsv(res, `costs-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    res.json({
      success: true,
      data,
      costs: data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (e) {
    next(e);
  }
});

const workTypeSchema = z.enum(['MONTH_CARD', 'RETAINER', 'PROJECT', 'INTERNAL']).transform((val) => {
  if (val === 'RETAINER') return TaskWorkType.MONTH_CARD;
  return val as TaskWorkType;
});

const createCostSchema = z.object({
  type: z.nativeEnum(CostType).default(CostType.DIRECT),
  workType: workTypeSchema.optional().nullable(),
  workId: z.string().optional().nullable(),
  monthCardId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  category: z.string().min(1),
  vendor: z.string().min(1),
  amount: z.number().positive(),
  incurredAt: z.string().optional(),
  committedNotPaid: z.boolean().default(false),
  paidBy: z.nativeEnum(CostPaidBy).default(CostPaidBy.COMPANY),
  treatment: z.nativeEnum(CostTreatment).default(CostTreatment.COMPANY_EXPENSE),
  recurring: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});

/**
 * GET /api/costs/trash — soft-deleted cost records, and restoring one. §16
 * mandates soft delete but never a way back to it; setup.admin only, since
 * recovery is an administrative action distinct from day-to-day cost entry.
 */
costsRouter.get('/trash', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const costs = await prisma.cost.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      include: { enteredBy: { select: { id: true, name: true } } },
    });
    res.json({ success: true, costs });
  } catch (error) {
    next(error);
  }
});

costsRouter.post('/:id/restore', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.cost.findFirst({ where: { id, organizationId: orgId, deletedAt: { not: null } } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Deleted cost not found' });
      return;
    }

    await prisma.cost.update({ where: { id }, data: { deletedAt: null } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        actorId: req.user!.userId,
        entityType: 'Cost',
        entityId: id,
        verb: 'restored',
        payload: { category: existing.category, vendor: existing.vendor },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Everything a cost points at has to be in the caller's own organization.
 *
 * `organizationId` was stamped onto the cost from the session and every read
 * filters on it, so the ROW was always confined to one tenant — but the ids it
 * carried were written down exactly as they arrived. A cost in one
 * organization could therefore reference a project in another, and the Money
 * screen renders `cost.project.company.name`, so the other tenant's client
 * name would appear on this one's page.
 *
 * `tasks.ts` has done this for people since multi-assignee landed
 * (`resolvePeople`); costs never got the equivalent for the work it hangs off.
 * Returns an error message, or null when everything checks out.
 */
async function checkWorkLinks(
  orgId: string,
  links: { monthCardId?: string | null; projectId?: string | null },
): Promise<string | null> {
  if (links.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: links.projectId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!project) return 'That project is not one of yours';
  }
  if (links.monthCardId) {
    // A month card carries no organizationId of its own; its retainer does.
    const card = await prisma.monthCard.findFirst({
      where: { id: links.monthCardId, retainer: { organizationId: orgId } },
      select: { id: true },
    });
    if (!card) return 'That month card is not one of yours';
  }
  return null;
}

/**
 * POST /api/costs — Record direct or operational cost
 */
costsRouter.post(
  '/',
  requirePermission('cost.enter'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = createCostSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const orgId = req.user!.organizationId;

      const linkProblem = await checkWorkLinks(orgId, {
        monthCardId: parsed.data.monthCardId,
        projectId: parsed.data.projectId,
      });
      if (linkProblem) {
        res.status(400).json({ success: false, error: linkProblem });
        return;
      }

      const incurredDate = parsed.data.incurredAt ? new Date(parsed.data.incurredAt) : new Date();

      const cost = await prisma.cost.create({
        data: {
          organizationId: orgId,
          type: parsed.data.type,
          workType: parsed.data.workType || undefined,
          workId: parsed.data.workId || undefined,
          monthCardId: parsed.data.monthCardId || undefined,
          projectId: parsed.data.projectId || undefined,
          category: parsed.data.category,
          vendor: parsed.data.vendor,
          amount: parsed.data.amount,
          incurredAt: incurredDate,
          committedNotPaid: parsed.data.committedNotPaid,
          paidBy: parsed.data.paidBy,
          treatment: parsed.data.treatment,
          enteredById: req.user!.userId,
          recurring: parsed.data.recurring,
          notes: parsed.data.notes || undefined,
        },
      });

      // Log activity
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          actorId: req.user!.userId,
          entityType: 'Cost',
          entityId: cost.id,
          verb: 'created',
          payload: {
            category: cost.category,
            vendor: cost.vendor,
            amount: parsed.data.amount,
            type: cost.type,
          },
        },
      });

      res.status(201).json({ success: true, data: cost, cost });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * PATCH /api/costs/:id/confirm — Confirm an auto-rolled recurring cost draft
 *
 * §13: the 00:15-on-the-1st job creates recurring rows "in draft, for
 * confirmation" — this is that confirmation.
 */
costsRouter.patch(
  '/:id/confirm',
  requirePermission('cost.enter'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const costId = String(req.params.id);

      const existing = await prisma.cost.findFirst({ where: { id: costId, organizationId: orgId, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Cost record not found' });
        return;
      }

      const cost = await prisma.cost.update({ where: { id: costId }, data: { confirmed: true } });
      res.json({ success: true, cost });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * DELETE /api/costs/:id — Remove a cost record
 *
 * Soft delete — §16: "Soft delete only... nothing is ever hard deleted by a
 * user." A financial record disappearing outright, with every already-run
 * profit figure it fed into left unexplained, is exactly the failure mode
 * that rule exists to prevent.
 */
costsRouter.delete(
  '/:id',
  requirePermission('cost.enter'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const orgId = req.user!.organizationId;

      const costId = String(id);
      const existing = await prisma.cost.findFirst({
        where: { id: costId, organizationId: orgId, deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ success: false, error: 'Cost record not found' });
        return;
      }

      await prisma.cost.update({ where: { id: costId }, data: { deletedAt: new Date() } });

      await prisma.activity.create({
        data: {
          organizationId: orgId,
          actorId: req.user!.userId,
          entityType: 'Cost',
          entityId: costId,
          verb: 'deleted',
          payload: { category: existing.category, vendor: existing.vendor, amount: Number(existing.amount) },
        },
      });

      res.json({ success: true, message: 'Cost record deleted successfully' });
    } catch (e) {
      next(e);
    }
  },
);
