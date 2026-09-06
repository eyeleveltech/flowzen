import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, type AuthRequest } from '../middleware/auth.js';
import { parsePagination } from '../utils/query.js';
import { TaskWorkType, TaskStatus } from '@prisma/client';
import type { PermissionKey } from '@flowzen/shared';

/**
 * The audit trail — who did what, and when.
 *
 * ─── What this used to be ───────────────────────────────────────────────────
 *
 * Organisation-scoped and otherwise WIDE OPEN. Any signed-in person could ask
 * for the whole feed, and 29 of 82 rows on a real database carried a rupee
 * figure in their payload: invoice amounts, cost amounts with vendor and
 * category, retainer monthly values, project quoted values, proposal won
 * values. A designer with nothing but `work.own` — correctly refused /costs,
 * /forecast, /companies and retainer profitability — could read all of it from
 * here in one request.
 *
 * Every `money.figures` gate in the product was bypassable through this one
 * endpoint. A gate that one unguarded route walks around is not a gate.
 *
 * ─── The two rules now ──────────────────────────────────────────────────────
 *
 * 1. WHICH ROWS. Each entity type names the permission its own screen needs,
 *    exactly as `search.ts` does. You can read the history of a thing if you
 *    could have opened the thing.
 *
 * 2. WHAT IS IN THEM. Money keys are stripped from the payload without
 *    `money.figures`, even for somebody allowed to see the row. Being able to
 *    open a project is not the same as being allowed to read what it is worth,
 *    and the feed must not become the back door for the second question.
 */

export const activitiesRouter = Router();

activitiesRouter.use(authenticate);

/**
 * The permission each entity's own screen requires.
 *
 * `undefined` means everybody — a Task's history is visible to anyone who can
 * reach the task, and task visibility is already narrowed elsewhere.
 *
 * Anything NOT in this map is refused rather than allowed. A new entity type
 * arriving with no entry should disappear from the feed until somebody decides
 * who may read it, which is the safe direction to fail.
 */
const READ_PERMISSION: Record<string, PermissionKey | undefined> = {
  Company: 'company.read',
  Proposal: 'pipeline.read',
  Proforma: 'pipeline.read',
  Project: 'work.all',
  MonthCard: 'work.all',
  Retainer: 'work.all',
  Task: undefined,
  Asset: undefined,
  Invoice: 'money.status',
  Cost: 'cost.enter',
  User: 'setup.admin',
  Organization: 'setup.admin',
  TaskTemplate: 'setup.admin',
};

const readable = (req: AuthRequest, entityType: string): boolean => {
  if (!(entityType in READ_PERMISSION)) return false;
  const needed = READ_PERMISSION[entityType];
  return needed === undefined || hasPermission(req.user!, needed);
};

/**
 * Figures, out of a payload, for somebody without `money.figures`.
 *
 * Matched on the KEY rather than on a list of verbs, because the leak was never
 * about a particular verb — it was about `amount` riding along inside whatever
 * happened to be logged. A new activity that puts a rupee value in its payload
 * is covered the day it is written rather than the day somebody notices.
 */
const MONEY_KEYS = new Set([
  'amount',
  'value',
  'quotedValue',
  'estimatedCost',
  'monthlyValue',
  'monthlyCost',
  'paymentAmount',
  'totalPaid',
  'revenue',
  'purchasePrice',
  'disposalValue',
  'salvageValue',
  'bookValue',
  // The closing figure a delivered project stamps (projects.ts, brief §11.3
  // step 6). A HEAD carries work.all — enough to read a project's history —
  // and not money.figures, so without these the new profit feature would have
  // reopened a smaller version of the leak this file exists to close.
  'profit',
  'directCost',
  'peopleCost',
  'actualCost',
  'costVariance',
  'marginPercent',
  'costVariancePercent',
  'projectedCost',
  'projectedProfit',
]);

const stripMoney = (payload: unknown): unknown => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (MONEY_KEYS.has(k)) continue;
    out[k] = v && typeof v === 'object' ? stripMoney(v) : v;
  }
  return out;
};

/**
 * GET /api/activities — one entity's history, or the feed you are allowed.
 *
 * `entityType` + `entityId` is how every real caller uses this: the timeline on
 * a project, a client, a deal. An unfiltered request is answered with only the
 * entity types the caller could have opened anyway.
 */
activitiesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { entityType, entityId } = req.query;

    /**
     * One thing's whole history, or a page of the general feed.
     *
     * These are different questions and were sharing a limit of 20. A named
     * entity's history is naturally bounded — a busy project accumulates a few
     * dozen events over its life — and it is read as a TIMELINE, so cutting it
     * at twenty drops the beginning of the story with nothing on screen saying
     * so and no control to ask for the rest. The unfiltered feed is a firehose
     * with no natural end and keeps the small page.
     */
    const scoped = typeof entityId === 'string' && entityId.length > 0;
    const { page, limit, skip, take } = parsePagination(
      req.query,
      scoped ? { defaultLimit: 200, maxLimit: 500 } : { defaultLimit: 20, maxLimit: 100 },
    );

    const where: {
      organizationId: string;
      entityType?: string | { in: string[] };
      entityId?: string;
    } = { organizationId: orgId };

    if (typeof entityType === 'string' && entityType) {
      if (!readable(req, entityType)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          detail: `Reading ${entityType} history requires the '${READ_PERMISSION[entityType] ?? 'unknown'}' permission switch.`,
        });
        return;
      }
      where.entityType = entityType;
      if (typeof entityId === 'string' && entityId) where.entityId = entityId;
    } else {
      // No entity named: answer with the types this person could open anyway,
      // rather than everything in the organisation.
      const allowed = Object.keys(READ_PERMISSION).filter((t) => readable(req, t));
      if (allowed.length === 0) {
        res.json({ success: true, data: [], activities: [], meta: { page, limit, total: 0, totalPages: 1 } });
        return;
      }
      where.entityType = { in: allowed };
    }

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        orderBy: { at: 'desc' },
        skip,
        take,
        include: {
          actor: { select: { id: true, name: true, email: true, dept: true } },
        },
      }),
      prisma.activity.count({ where }),
    ]);

    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const data = canSeeFigures
      ? activities
      : activities.map((a) => ({ ...a, payload: stripMoney(a.payload) }));

    res.json({
      success: true,
      data,
      activities: data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (e) {
    next(e);
  }
});

const logSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  verb: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});

/**
 * Which table an entity type lives in, so a logged row can be proved to point
 * at something real inside the caller's own organisation.
 *
 * Without this the audit trail was writable fiction: `entityId:
 * "does-not-exist-at-all"` came back 201. An audit log anybody can put
 * arbitrary rows into is not evidence of anything.
 */
const ENTITY_EXISTS: Record<string, (id: string, orgId: string) => Promise<boolean>> = {
  Company: (id, orgId) =>
    prisma.company.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }).then(Boolean),
  Proposal: (id, orgId) =>
    prisma.proposal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }).then(Boolean),
  Project: (id, orgId) =>
    prisma.project.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }).then(Boolean),
  Task: (id, orgId) =>
    prisma.task.findFirst({ where: { id, organizationId: orgId, deletedAt: null }, select: { id: true } }).then(Boolean),
  Retainer: (id, orgId) =>
    prisma.retainer.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }).then(Boolean),
  MonthCard: (id, orgId) =>
    prisma.monthCard
      .findFirst({ where: { id, retainer: { organizationId: orgId } }, select: { id: true } })
      .then(Boolean),
  Asset: (id, orgId) =>
    prisma.asset.findFirst({ where: { id, organizationId: orgId }, select: { id: true } }).then(Boolean),
};

/**
 * POST /api/activities — record that something happened.
 *
 * Deliberately open to any signed-in person for the entity types they can
 * read: logging that you spoke to a client is the single most common thing
 * anybody does, and gating it behind a role is how a CRM stops describing
 * reality. What is NOT open is inventing rows — the entity has to exist, in
 * this organisation, and be one this person could have opened.
 */
activitiesRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = logSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;
    const { entityType, entityId, verb, payload } = parsed.data;

    const exists = ENTITY_EXISTS[entityType];
    if (!exists) {
      res.status(400).json({
        success: false,
        error: `Nothing can be logged against a ${entityType}.`,
      });
      return;
    }

    if (!readable(req, entityType)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        detail: `Logging against a ${entityType} requires the '${READ_PERMISSION[entityType] ?? 'unknown'}' permission switch.`,
      });
      return;
    }

    if (!(await exists(entityId, orgId))) {
      res.status(404).json({ success: false, error: `That ${entityType.toLowerCase()} does not exist.` });
      return;
    }

    const activity = await prisma.activity.create({
      data: {
        organizationId: orgId,
        actorId: userId,
        entityType,
        entityId,
        verb,
        payload: (payload as any) || {},
      },
    });

    // Brief §11.1 step 5: logging a meeting raises the next step itself,
    // rather than leaving it to whoever remembers to come back and create one.
    let followUpTask: { id: string } | null = null;
    const followUpDate = (payload as any)?.followUpDate;
    if (verb === 'meeting_logged' && entityType === 'Company' && followUpDate) {
      const company = await prisma.company.findFirst({ where: { id: entityId, organizationId: orgId } });
      if (company) {
        followUpTask = await prisma.task.create({
          data: {
            organizationId: orgId,
            title: `Follow up — ${company.name}`,
            workType: TaskWorkType.INTERNAL,
            assigneeId: company.ownerId ?? userId,
            createdById: userId,
            dueDate: new Date(followUpDate),
            assignedAt: new Date(),
            status: TaskStatus.TODO,
            notes: (payload as any)?.message ? `From meeting: ${(payload as any).message}` : null,
            // The join is what My Work and a person's load read now, so a task
            // created without a row here belongs to nobody.
            assignees: { create: { userId: company.ownerId ?? userId } },
          },
        });
      }
    }

    res.status(201).json({ success: true, activity, followUpTask });
  } catch (e) {
    next(e);
  }
});
