/**
 * The timeline.
 *
 * One timeline, replacing the old Activity AND Note — adding a note used to write
 * two records that could disagree (master plan §3.9).
 *
 * It can only be added to. A history you can edit is not a history.
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, param, requireRole, type AuthRequest } from '../middleware/auth.js';

export const activitiesRouter = Router();

activitiesRouter.use(authenticate);

const logSchema = z
  .object({
    type: z.enum(['NOTE', 'CALL', 'MEETING', 'EMAIL', 'WHATSAPP']),
    message: z.string().min(1),
    body: z.string().optional().nullable(),
    direction: z.enum(['IN', 'OUT']).optional().nullable(),
    /**
     * When it HAPPENED. Defaults to now, and being editable is the whole point:
     * a call logged on Friday about a Tuesday conversation belongs on Tuesday, or
     * every "last contacted" figure is wrong by however long people take to write
     * things up (§3.9).
     */
    occurredAt: z.coerce.date().optional(),
    companyId: z.string().optional().nullable(),
    dealId: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    taskId: z.string().optional().nullable(),
    engagementId: z.string().optional().nullable(),
  })
  .refine(
    (v) => Boolean(v.companyId || v.dealId || v.projectId || v.taskId || v.engagementId),
    { message: 'An activity has to be attached to something.' },
  );

activitiesRouter.post('/', requireRole('MEMBER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = logSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const occurredAt = parsed.data.occurredAt ?? new Date();

    const activity = await prisma.$transaction(async (tx) => {
      const created = await tx.activity.create({
        data: {
          ...parsed.data,
          occurredAt,
          organizationId: req.user!.organizationId,
          userId: req.user!.userId,
        },
      });

      // "Last contacted" follows the timeline rather than being maintained
      // separately — two places recording the same fact is how they disagree.
      if (parsed.data.dealId && ['CALL', 'MEETING', 'EMAIL', 'WHATSAPP'].includes(parsed.data.type)) {
        await tx.deal.updateMany({
          where: {
            id: parsed.data.dealId,
            organizationId: req.user!.organizationId,
            OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: occurredAt } }],
          },
          data: { lastContactedAt: occurredAt },
        });
      }

      return created;
    });

    res.status(201).json({ success: true, data: activity });
  } catch (e) {
    next(e);
  }
});

/** GET /activities?dealId=… — ordered by when things HAPPENED, not when typed. */
activitiesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { companyId, dealId, projectId, engagementId } = req.query;
    if (!companyId && !dealId && !projectId && !engagementId) {
      res.status(400).json({ success: false, error: 'Say which record you want the timeline for.' });
      return;
    }

    const activities = await prisma.activity.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(companyId ? { companyId: String(companyId) } : {}),
        ...(dealId ? { dealId: String(dealId) } : {}),
        ...(projectId ? { projectId: String(projectId) } : {}),
        ...(engagementId ? { engagementId: String(engagementId) } : {}),
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { occurredAt: 'desc' },
      take: Number(req.query.limit ?? 100),
    });

    res.json({ success: true, data: activities });
  } catch (e) {
    next(e);
  }
});

/**
 * There is deliberately no PATCH and no DELETE.
 *
 * The timeline is append-only. If something was logged wrongly, log a correction —
 * that is what a history looks like when it can be trusted (§5).
 */
activitiesRouter.all('/:id', (req, res) => {
  if (req.method === 'GET') {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  res.status(405).json({
    success: false,
    error:
      'The timeline can only be added to. Log a correction rather than editing what was recorded.',
  });
});
