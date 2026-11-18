import { Router, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { isLiveFocus } from '../services/taskFocus.js';
import { z } from 'zod';
import { gettingStartedFor } from '../services/gettingStarted.js';

/**
 * The caller's own things that are nobody else's to set.
 *
 * For now, "Working on now" (Team plan 1): which task they said they are on.
 * Setting it is `POST /api/tasks/:id/focus`, on the task.
 */
export const meRouter = Router();

meRouter.use(authenticate);

/**
 * GET /api/me/getting-started — My Work's Getting started card (Ease Plan 2):
 * each step and whether it is done, worked out from what already exists.
 */
meRouter.get('/getting-started', async (req: AuthRequest, res: Response, next) => {
  try {
    const me = req.user!.userId;
    const mine = (await gettingStartedFor(req.user!.organizationId, [me])).get(me);
    if (!mine) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }
    res.json({ success: true, ...mine });
  } catch (error) {
    next(error);
  }
});

const hideSchema = z.object({ hidden: z.boolean() });

/** PATCH /api/me/getting-started { hidden } — Hide on the card; Profile's "Show it again". */
meRouter.patch('/getting-started', async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = hideSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Say whether to hide it.' });
      return;
    }
    await prisma.user.updateMany({
      where: { id: req.user!.userId, organizationId: req.user!.organizationId },
      data: { gettingStartedHiddenAt: parsed.data.hidden ? new Date() : null },
    });
    res.json({ success: true, hidden: parsed.data.hidden });
  } catch (error) {
    next(error);
  }
});

/** What I said I am working on now, or null. */
meRouter.get('/focus', async (req: AuthRequest, res: Response, next) => {
  try {
    const me = req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: me },
      select: {
        focusTask: {
          select: { id: true, title: true, status: true, deletedAt: true, assignees: { select: { userId: true } } },
        },
      },
    });
    const task = user?.focusTask ?? null;
    const live = isLiveFocus(task, me);
    // Ended some way that did not clear it — a cancelled project, say. Cleared
    // here, so it does not come back if the task is reopened.
    if (task && !live) {
      await prisma.user.updateMany({ where: { id: me, focusTaskId: task.id }, data: { focusTaskId: null } });
    }
    res.json({ success: true, focus: live ? { id: task!.id, title: task!.title, status: task!.status } : null });
  } catch (error) {
    next(error);
  }
});

/** Not working on anything in particular now. */
meRouter.delete('/focus', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.user.update({ where: { id: req.user!.userId }, data: { focusTaskId: null } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
