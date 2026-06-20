import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';

export const teamRouter = Router();
teamRouter.use(authenticate);

const teamSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
  leaderId: z.string().optional().nullable(),
});

// GET /api/teams
teamRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const teams = await prisma.team.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        leader: { select: { id: true, name: true, avatar: true } },
        members: { select: { id: true, name: true, avatar: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ teams });
  } catch (error) {
    next(error);
  }
});

// GET /api/teams/:id
teamRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId },
      include: {
        leader: { select: { id: true, name: true, avatar: true } },
        members: { select: { id: true, name: true, avatar: true, email: true, role: true } },
      },
    });

    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json(team);
  } catch (error) {
    next(error);
  }
});

// POST /api/teams
teamRouter.post('/', authorize('SUPER_ADMIN', 'ADMIN'), validate(teamSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const allMembers = Array.from(new Set([
      ...(req.body.memberIds || []),
      ...(req.body.leaderId ? [req.body.leaderId] : [])
    ]));

    const team = await prisma.team.create({
      data: {
        name: req.body.name,
        description: req.body.description,
        organizationId: req.user!.organizationId,
        leaderId: req.body.leaderId || undefined,
        members: {
          connect: allMembers.map((id: string) => ({ id }))
        },
      },
      include: {
        leader: { select: { id: true, name: true, avatar: true } },
        members: { select: { id: true, name: true, avatar: true, email: true, role: true } },
      },
    });

    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'team:changed', { id: team.id });
    res.status(201).json(team);
  } catch (error) {
    next(error);
  }
});

// PUT /api/teams/:id
teamRouter.put('/:id', authorize('SUPER_ADMIN', 'ADMIN'), validate(teamSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.team.findFirst({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const allMembers = Array.from(new Set([
      ...(req.body.memberIds || []),
      ...(req.body.leaderId ? [req.body.leaderId] : [])
    ]));

    const team = await prisma.team.update({
      where: { id: req.params.id as string },
      data: {
        name: req.body.name,
        description: req.body.description,
        leaderId: req.body.leaderId || null,
        members: {
          set: allMembers.map((id: string) => ({ id })),
        },
      },
      include: {
        leader: { select: { id: true, name: true, avatar: true } },
        members: { select: { id: true, name: true, avatar: true, email: true, role: true } },
      },
    });

    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'team:changed', { id: team.id });
    res.json(team);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/teams/:id
teamRouter.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.team.findFirst({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    await prisma.team.delete({
      where: { id: req.params.id as string },
    });

    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'team:changed', { id: req.params.id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
