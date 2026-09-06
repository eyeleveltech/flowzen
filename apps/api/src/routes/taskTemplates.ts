import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';

export const taskTemplatesRouter = Router();

taskTemplatesRouter.use(authenticate);

// A template's `items` is a JSON array read by the 1st-of-month roll job
// (workers/monthCard.cron.ts) — only `title` and `dayOfMonth` are ever
// applied to a spawned Task, so that's all this editor collects.
const itemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
});

const templateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  items: z.array(itemSchema).min(1, 'Add at least one task'),
});

// ── List ─────────────────────────────────────────────────────────────────
// Readable by anyone who can create a retainer, since that's where a
// template gets picked.

taskTemplatesRouter.get('/', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const templates = await prisma.taskTemplate.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: { _count: { select: { retainers: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, templates });
  } catch (error) {
    next(error);
  }
});

// ── Trash — soft-deleted templates, and restoring one ───────────────────────
// §16 mandates soft delete but never a way back to it; setup.admin only,
// same tier as the delete itself. Registered ahead of nothing that would
// collide (no GET /:id exists on this router), but kept next to List for
// the same reason projects.ts and costs.ts place theirs early.

taskTemplatesRouter.get('/trash', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const templates = await prisma.taskTemplate.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
    res.json({ success: true, templates });
  } catch (error) {
    next(error);
  }
});

taskTemplatesRouter.post('/:id/restore', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.taskTemplate.findFirst({ where: { id, organizationId: orgId, deletedAt: { not: null } } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Deleted template not found' });
      return;
    }

    await prisma.taskTemplate.update({ where: { id }, data: { deletedAt: null } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        actorId: req.user!.userId,
        entityType: 'TaskTemplate',
        entityId: id,
        verb: 'restored',
        payload: { name: existing.name },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── Create ───────────────────────────────────────────────────────────────

taskTemplatesRouter.post('/', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const template = await prisma.taskTemplate.create({
      data: { organizationId: orgId, name: parsed.data.name.trim(), items: parsed.data.items },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'TaskTemplate',
        entityId: template.id,
        actorId: req.user!.userId,
        verb: 'task_template_created',
        payload: { name: template.name, itemCount: parsed.data.items.length },
      },
    });

    res.status(201).json({ success: true, template });
  } catch (error) {
    next(error);
  }
});

// ── Update ───────────────────────────────────────────────────────────────

taskTemplatesRouter.patch('/:id', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.taskTemplate.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    const template = await prisma.taskTemplate.update({
      where: { id },
      data: { name: parsed.data.name.trim(), items: parsed.data.items },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'TaskTemplate',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'task_template_updated',
        payload: { name: template.name, itemCount: parsed.data.items.length },
      },
    });

    res.json({ success: true, template });
  } catch (error) {
    next(error);
  }
});

// ── Delete ───────────────────────────────────────────────────────────────

taskTemplatesRouter.delete('/:id', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.taskTemplate.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { _count: { select: { retainers: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    if (existing._count.retainers > 0) {
      res.status(400).json({
        success: false,
        error: `${existing._count.retainers} retainer${existing._count.retainers === 1 ? '' : 's'} still use this template. Move them to a different one first.`,
      });
      return;
    }

    await prisma.taskTemplate.update({ where: { id }, data: { deletedAt: new Date() } });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'TaskTemplate',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'task_template_deleted',
        payload: { name: existing.name },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
