import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export const searchRouter = Router();
searchRouter.use(authenticate);

// GET /api/search?q=term
searchRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const query = req.query.q as string;

    if (!query || query.length < 2) {
      res.json({ clients: [], projects: [], tasks: [], members: [] });
      return;
    }

    const [clients, projects, tasks, members] = await Promise.all([
      prisma.client.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { company: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, company: true, status: true },
        take: 5,
      }),
      prisma.project.findMany({
        where: {
          client: { organizationId: orgId },
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, status: true, client: { select: { name: true, company: true } } },
        take: 5,
      }),
      prisma.task.findMany({
        where: {
          project: { client: { organizationId: orgId } },
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, title: true, status: true, project: { select: { name: true } } },
        take: 5,
      }),
      prisma.user.findMany({
        where: {
          organizationId: orgId,
          status: 'ACTIVE',
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true, avatar: true, role: true },
        take: 5,
      }),
    ]);

    res.json({ clients, projects, tasks, members });
  } catch (error) {
    next(error);
  }
});
