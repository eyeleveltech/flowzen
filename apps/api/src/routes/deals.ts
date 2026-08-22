/**
 * Deals and the pipeline board.
 *
 * A deal is one thing you are trying to sell one company. Many deals per company,
 * because customers come back and buy more than one thing (master plan §3.3).
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, param, requireRole, requireModule, type AuthRequest } from '../middleware/auth.js';
import {
  moveDealToStage,
  winDeal,
  holdDeal,
  unholdDeal,
  DealRuleError,
} from '../services/deal.service.js';
import { isRotting } from '../services/stageRules.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { daysBetween } from '../utils/orgDay.js';
import { setDealFieldValue, validateStageFields, getValuesForDeal } from '../services/customFields.js';

export const dealsRouter = Router();

/**
 * The pipeline is Sales and above (§3.10 — a Member's row reads "—").
 *
 * Gated on the ROUTER, not per route, because the leak was a read: writes were
 * all guarded individually and the board was not, so anyone signed in could list
 * every deal and its value. A gate that has to be remembered per route is a gate
 * that gets forgotten on the next one added.
 */
dealsRouter.use(authenticate, requireModule('CRM'), requireRole('SALES'));

/** Turn a rule violation into a response a form can render field by field. */
const handleRuleError = (e: unknown, res: Response, next: NextFunction) => {
  if (e instanceof DealRuleError) {
    res.status(422).json({ success: false, error: e.message, fieldErrors: e.errors });
    return true;
  }
  next(e);
  return false;
};

/**
 * GET /deals/board — the pipeline, grouped by stage.
 *
 * Each card carries its two stall signals: how long it has sat still against this
 * stage's own patience, and what it is waiting on. Those thresholds already
 * existed and were scanned nightly but never shown on a card (§1.3 ⑧).
 */
dealsRouter.get('/board', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const org = await getOrgConfig(orgId);

    const pipeline = await prisma.pipeline.findFirst({
      where: { organizationId: orgId, isDefault: true, archivedAt: null },
      include: {
        stages: {
          where: { archivedAt: null },
          orderBy: { position: 'asc' },
          include: {
            deals: {
              where: { organizationId: orgId },
              include: {
                company: { select: { id: true, name: true, status: true, gstNumber: true, companySize: true, billingAddress: true } },
                owner: { select: { id: true, name: true, avatar: true } },
                stageHistory: { orderBy: { enteredAt: 'desc' }, take: 1 },
              },
              orderBy: { updatedAt: 'desc' },
            },
          },
        },
      },
    });

    if (!pipeline) {
      res.status(404).json({ success: false, error: 'No pipeline configured.' });
      return;
    }

    const now = new Date();

    const columns = pipeline.stages.map((stage) => {
      const deals = stage.deals.map((deal) => {
        const enteredAt = deal.stageHistory[0]?.enteredAt ?? deal.createdAt;
        const daysInStage = daysBetween(now, enteredAt, org.timezone);
        return {
          id: deal.id,
          title: deal.title,
          value: deal.value?.toString() ?? null,
          expectedCloseDate: deal.expectedCloseDate,
          company: deal.company,
          owner: deal.owner,
          priority: deal.priority,
          isOnHold: deal.isOnHold,
          holdReason: deal.holdReason,
          blockedOn: deal.blockedOn,
          daysInStage,
          // Shown on the card, not just scanned overnight.
          //
          // A PARKED deal is never rotting. Silence on a deal somebody
          // deliberately put down is explained — the hold reason is the
          // explanation — and flagging it anyway trains people to ignore the
          // flag. The dashboard already excluded held deals; the board did not,
          // so the same deal was quiet in one place and fine in the other.
          isRotting:
            !deal.isOnHold &&
            isRotting({ kind: stage.kind, rottingDays: stage.rottingDays }, daysInStage),
        };
      });

      return {
        id: stage.id,
        name: stage.name,
        kind: stage.kind,
        probability: stage.probability.toString(),
        rottingDays: stage.rottingDays,
        requiresForecast: stage.requiresForecast,
        deals,
        // Weighted by this stage's probability — an unweighted column total reads
        // as money you are about to receive, which it is not.
        total: deals
          .reduce((sum, d) => sum.add(new Prisma.Decimal(d.value ?? 0)), new Prisma.Decimal(0))
          .toString(),
      };
    });

    res.json({ success: true, data: { pipelineId: pipeline.id, columns } });
  } catch (e) {
    next(e);
  }
});

const dealInput = z.object({
  companyId: z.string().min(1),
  title: z.string().optional().nullable(),
  stageId: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional().nullable(),
  expectedCloseDate: z.coerce.date().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  blockedOn: z.string().optional().nullable(),
  nextStepDate: z.coerce.date().optional().nullable(),
  followUpDate: z.coerce.date().optional().nullable(),
});

dealsRouter.post('/', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const parsed = dealInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const company = await prisma.company.findFirst({
      where: { id: parsed.data.companyId, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    // Land in the first stage unless told otherwise.
    const stageId =
      parsed.data.stageId ??
      (
        await prisma.stage.findFirstOrThrow({
          where: { pipeline: { organizationId: orgId, isDefault: true }, archivedAt: null },
          orderBy: { position: 'asc' },
          select: { id: true },
        })
      ).id;

    const deal = await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          organizationId: orgId,
          companyId: company.id,
          title: parsed.data.title ?? `${company.name} — new deal`,
          stageId,
          value: parsed.data.value == null ? null : new Prisma.Decimal(parsed.data.value),
          expectedCloseDate: parsed.data.expectedCloseDate ?? null,
          ownerId: parsed.data.ownerId ?? req.user!.userId,
          sourceId: parsed.data.sourceId ?? null,
          priority: parsed.data.priority ?? 'MEDIUM',
          blockedOn: parsed.data.blockedOn ?? null,
          nextStepDate: parsed.data.nextStepDate ?? null,
          followUpDate: parsed.data.followUpDate ?? null,
        },
      });

      // The first row of history, so "how long in this stage" has an answer from
      // the moment the deal exists rather than from its first move.
      await tx.stageHistory.create({
        data: { dealId: created.id, fromStageId: null, toStageId: stageId, movedById: req.user!.userId },
      });

      return created;
    });

    res.status(201).json({ success: true, data: deal });
  } catch (e) {
    next(e);
  }
});

dealsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deal = await prisma.deal.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      include: {
        company: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
        stage: true,
        owner: { select: { id: true, name: true, avatar: true } },
        source: true,
        lostReason: true,
        quotes: { orderBy: { createdAt: 'desc' } },
        engagement: true,
        tasks: { orderBy: { dueDate: 'asc' } },
        stageHistory: {
          include: { fromStage: { select: { name: true } }, toStage: { select: { name: true } } },
          orderBy: { enteredAt: 'desc' },
        },
        activities: { orderBy: { occurredAt: 'desc' }, take: 50 },
        fieldValues: { include: { field: true } },
      },
    });

    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }

    const formattedFields = await getValuesForDeal(deal.id);

    res.json({ success: true, data: { ...deal, fieldValues: formattedFields } });
  } catch (e) {
    next(e);
  }
});

dealsRouter.patch('/:id/fields', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deal = await prisma.deal.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }

    const fields = req.body;
    if (typeof fields !== 'object' || fields === null) {
      res.status(400).json({ success: false, error: 'Expected an object of fieldId -> value' });
      return;
    }

    for (const [fieldId, value] of Object.entries(fields)) {
      await setDealFieldValue(fieldId, deal.id, value);
    }

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

dealsRouter.patch('/:id', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const parsed = dealInput.partial().omit({ companyId: true, stageId: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const existing = await prisma.deal.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }

    const { value, ...rest } = parsed.data;
    const deal = await prisma.deal.update({
      where: { id: param(req, 'id') },
      data: {
        ...rest,
        ...(value !== undefined ? { value: value == null ? null : new Prisma.Decimal(value) } : {}),
      },
    });

    const customFields = (req.body as Record<string, unknown>)?.customFields;
    if (customFields && typeof customFields === 'object') {
      for (const [fieldId, val] of Object.entries(customFields)) {
        await setDealFieldValue(fieldId, deal.id, val);
      }
    }

    res.json({ success: true, data: deal });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /deals/:id/stage — the drag.
 *
 * Deliberately cannot win a deal. Winning creates billing and needs terms this
 * endpoint does not carry; letting a drag do it quietly is exactly how a one-off
 * project ended up on a monthly subscription (§1.3 ①).
 */
dealsRouter.post('/:id/stage', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { stageId, customFields } = req.body ?? {};
    if (!stageId) {
      res.status(400).json({ success: false, error: 'A stage is required.' });
      return;
    }

    const deal = await prisma.deal.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }

    // Save provided custom fields before attempting the move
    if (customFields && typeof customFields === 'object') {
      for (const [fieldId, value] of Object.entries(customFields)) {
        await setDealFieldValue(fieldId, deal.id, value);
      }
    }

    // Validate required custom fields for the target stage
    const currentValues = await getValuesForDeal(deal.id);
    const valueMap = Object.fromEntries(currentValues.map((v) => [v.key, v.value]));
    const fieldErrors = await validateStageFields(stageId, valueMap);

    if (fieldErrors.length > 0) {
      res.status(422).json({
        success: false,
        error: 'Missing required custom fields for this stage.',
        fieldErrors,
      });
      return;
    }

    const result = await moveDealToStage(deal.id, stageId, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (e) {
    handleRuleError(e, res, next);
  }
});

const winInput = z.object({
  contractType: z.enum(['RETAINER', 'PROJECT']),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  amount: z.union([z.number(), z.string()]),
  billingFrequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']),
  paymentTerms: z.enum(['ADVANCE_100', 'SPLIT_50_50', 'MONTHLY', 'MILESTONE']).optional().nullable(),
  advanceAmount: z.union([z.number(), z.string()]).optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * POST /deals/:id/win — the hinge.
 *
 * Company becomes a client, one engagement is created, its price history begins,
 * the deal closes. All in one transaction, or none of it (§4.7).
 */
dealsRouter.post('/:id/win', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = winInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.issues[0].message,
        fieldErrors: parsed.error.issues.map((i) => ({ field: String(i.path[0]), message: i.message })),
      });
      return;
    }

    const deal = await prisma.deal.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true, stageId: true },
    });
    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }

    const { customFields } = req.body ?? {};
    if (customFields && typeof customFields === 'object') {
      for (const [fieldId, value] of Object.entries(customFields)) {
        await setDealFieldValue(fieldId, deal.id, value);
      }
    }

    // A win implies moving to the WON stage, so we validate against its fields.
    const wonStage = await prisma.stage.findFirst({
      where: { pipeline: { organizationId: req.user!.organizationId, isDefault: true }, kind: 'WON', archivedAt: null },
      select: { id: true },
    });
    if (wonStage) {
      const currentValues = await getValuesForDeal(deal.id);
      const valueMap = Object.fromEntries(currentValues.map((v) => [v.key, v.value]));
      const fieldErrors = await validateStageFields(wonStage.id, valueMap);

      if (fieldErrors.length > 0) {
        res.status(422).json({
          success: false,
          error: 'Missing required custom fields for this stage.',
          fieldErrors,
        });
        return;
      }
    }

    const result = await winDeal(deal.id, parsed.data, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (e) {
    handleRuleError(e, res, next);
  }
});

/** POST /deals/:id/lose — a reason is required, or "why do we lose?" is unanswerable. */
dealsRouter.post('/:id/lose', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { lostReasonId, note } = req.body ?? {};
    if (!lostReasonId) {
      res.status(422).json({
        success: false,
        error: 'Choose a reason before closing this deal as lost.',
        fieldErrors: [{ field: 'lostReasonId', message: 'A reason is required.' }],
      });
      return;
    }

    const [deal, lostStage] = await Promise.all([
      prisma.deal.findFirst({ where: { id: param(req, 'id'), organizationId: orgId }, select: { id: true, stageId: true } }),
      prisma.stage.findFirst({
        where: { pipeline: { organizationId: orgId, isDefault: true }, kind: 'LOST', archivedAt: null },
        select: { id: true },
      }),
    ]);
    if (!deal || !lostStage) {
      res.status(404).json({ success: false, error: 'Deal or lost stage not found' });
      return;
    }

    await prisma.deal.update({ where: { id: deal.id }, data: { lostReasonId } });
    const result = await moveDealToStage(deal.id, lostStage.id, req.user!.userId);

    if (note) {
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          type: 'NOTE',
          message: 'Lost reason',
          body: note,
          userId: req.user!.userId,
          dealId: deal.id,
        },
      });
    }

    res.json({ success: true, data: result });
  } catch (e) {
    handleRuleError(e, res, next);
  }
});

/** Parking a deal stops nothing — there is no billing yet. It keeps its column. */
dealsRouter.post('/:id/hold', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deal = await prisma.deal.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }
    res.json({ success: true, data: await holdDeal(deal.id, req.body?.reason ?? null, req.user!.userId) });
  } catch (e) {
    next(e);
  }
});

dealsRouter.post('/:id/unhold', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deal = await prisma.deal.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!deal) {
      res.status(404).json({ success: false, error: 'Deal not found' });
      return;
    }
    res.json({ success: true, data: await unholdDeal(deal.id, req.user!.userId) });
  } catch (e) {
    next(e);
  }
});
