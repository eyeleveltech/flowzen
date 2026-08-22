/**
 * The bell.
 *
 * Reading notifications, not producing them. The scanner that WRITES a row every
 * morning is still unbuilt (master plan §4.9) — so this legitimately answers an
 * empty list today, and that is the point: the header polls this on every page,
 * and a 404 on every page is noise people learn to scroll past.
 *
 * `dedupeKey` is why nothing here creates rows ad hoc. One row per (user, key),
 * UPDATED rather than re-inserted, or a month of scans leaves thirty identical
 * "invoice #123 overdue" lines and the bell stops being read at all.
 */

import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, param, type AuthRequest } from '../middleware/auth.js';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

/**
 * `readAt` is a timestamp, not a boolean — knowing WHEN something was read is
 * worth keeping. The wire carries a boolean because that is all a bell needs.
 */
const present = (n: {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  message: n.message ?? n.title,
  link: n.link,
  read: n.readAt !== null,
  createdAt: n.createdAt,
});

notificationsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    // Bare shape rather than the { success, data } envelope, matching /auth/me.
    // Both clients cope: the v2 one falls through to the payload when there is
    // no `data` key.
    res.json({ notifications: rows.map(present), unreadCount });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.patch('/read-all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ marked: result.count });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.patch('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const userId = req.user!.userId;

    // Scoped by userId, so one person cannot mark another's notification read
    // by guessing an id — and so a wrong id is "not found" rather than a leak
    // that it exists.
    const existing = await prisma.notification.findFirst({
      where: { id, userId },
      select: { readAt: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Notification not found' });
      return;
    }

    // Marking an already-read one is a no-op, not an error. Two clicks on the
    // same row, or a retry, must not surface as a failure.
    if (!existing.readAt) {
      await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
