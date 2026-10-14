import { Router, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { isLiveFocus } from '../services/taskFocus.js';

/**
 * The caller's own things that are nobody else's to set.
 *
 * For now, "Working on now" (Team plan 1): which task they said they are on.
 * Setting it is `POST /api/tasks/:id/focus`, on the task.
 */
export const meRouter = Router();

meRouter.use(authenticate);

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
