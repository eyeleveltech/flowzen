import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../socket.js';
import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';

export const clientRouter = Router();
clientRouter.use(authenticate);

const clientSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  industry: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  contractValue: z.number().optional(),
  startDate: z.string().optional(),
  status: z.enum(['LEAD', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
  contacts: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    designation: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  })).optional(),
});

// GET /api/clients
clientRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { search, status, page = '1', limit = '20' } = req.query;

    const where: Record<string, unknown> = { organizationId: orgId };
    if (status) where.status = status as string;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { company: { contains: search as string, mode: 'insensitive' } },
        { contactPerson: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where: where as any,
        include: {
          contacts: true,
          _count: { select: { projects: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.client.count({ where: where as any }),
    ]);

    res.json({ clients, total, page: parseInt(page as string), totalPages: Math.ceil(total / parseInt(limit as string)) });
  } catch (error) {
    next(error);
  }
});

// GET /api/clients/:id
clientRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: (req.params.id as string), organizationId: req.user!.organizationId },
      include: {
        contacts: true,
        projects: {
          include: {
            owner: { select: { id: true, name: true, avatar: true } },
            _count: { select: { tasks: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        notes: {
          include: { author: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: { select: { projects: true } },
      },
    });

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.json(client);
  } catch (error) {
    next(error);
  }
});

// POST /api/clients
clientRouter.post('/', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), validate(clientSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { contacts, startDate, ...data } = req.body;
    
    const client = await prisma.client.create({
      data: {
        ...data,
        startDate: startDate ? new Date(startDate) : undefined,
        organizationId: req.user!.organizationId,
        contacts: contacts ? {
          create: contacts.map((c: any) => ({
            name: c.name,
            designation: c.designation,
            email: c.email,
            phone: c.phone
          }))
        } : undefined,
      },
      include: { contacts: true }
    });

    // Activity log
    await prisma.activity.create({
      data: {
        type: 'CLIENT_CREATED',
        message: `added client "${client.name}"`,
        entityType: 'CLIENT',
        entityId: client.id,
        userId: req.user!.userId,
        clientId: client.id,
      },
    });

    // Real-time notification
    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:created', client);
    await invalidateOrganizationCache(req.user!.organizationId);

    res.status(201).json(client);
  } catch (error) {
    next(error);
  }
});

// PUT /api/clients/:id
clientRouter.put('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), validate(clientSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: (req.params.id as string), organizationId: req.user!.organizationId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const { contacts, startDate, ...data } = req.body;

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: {
        ...data,
        startDate: startDate ? new Date(startDate) : undefined,
        contacts: {
          deleteMany: {},
          create: contacts?.map((c: any) => ({
            name: c.name,
            designation: c.designation,
            email: c.email,
            phone: c.phone
          })) || []
        }
      },
      include: { contacts: true }
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:updated', updated);
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/clients/:id
clientRouter.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const client = await prisma.client.deleteMany({
      where: { id: (req.params.id as string), organizationId: req.user!.organizationId },
    });

    if (client.count === 0) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:deleted', { id: (req.params.id as string) });
    await invalidateOrganizationCache(req.user!.organizationId);

    res.json({ message: 'Client deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/clients/:id/notes
clientRouter.post('/:id/notes', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const note = await prisma.note.create({
      data: {
        content: req.body.content,
        type: req.body.type || 'INTERNAL',
        clientId: (req.params.id as string),
        authorId: req.user!.userId,
      },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });

    res.status(201).json(note);
  } catch (error) {
    next(error);
  }
});
