import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

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
    await prisma.notification.update({
      where: { id: (req.params.id as string) },
      data: { read: true },
    });

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
