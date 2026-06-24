import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { runDailyNotificationJobs } from '../services/notificationScanners.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

// GET /api/notifications/unread-count — badge count for the bell.
notificationRouter.get('/unread-count', async (req: AuthRequest, res: Response, next) => {
  try {
    const count = await prisma.notification.count({ where: { userId: req.user!.userId, read: false } });
    res.json({ count });
  } catch (error) { next(error); }
});

// POST /api/notifications/run-scan — manually trigger the daily scanners (admin; used in testing).
// In-app notifications only — digest/business emails are skipped so repeated test runs don't spam.
notificationRouter.post('/run-scan', authorize('SUPER_ADMIN', 'ADMIN'), async (_req: AuthRequest, res: Response, next) => {
  try {
    const result = await runDailyNotificationJobs(false);
    res.json({ ok: true, ...result });
  } catch (error) { next(error); }
});

// GET /api/notifications
notificationRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId: req.user!.userId, read: false },
    });

    res.json({ notifications, unreadCount });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/:id/read
notificationRouter.patch('/:id/read', async (req: AuthRequest, res: Response, next) => {
  try {
    // Scope to the owner so a user can't flip another user's notification (IDOR).
    const result = await prisma.notification.updateMany({
      where: { id: (req.params.id as string), userId: req.user!.userId },
      data: { read: true },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/read-all
notificationRouter.patch('/read-all', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.userId, read: false },
      data: { read: true },
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
});
