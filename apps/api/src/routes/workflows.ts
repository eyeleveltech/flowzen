import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const workflowRouter = Router();
workflowRouter.use(authenticate);
workflowRouter.use(authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'));

const workflowSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  trigger: z.enum(['TASK_STATUS_CHANGE', 'TASK_ASSIGNED', 'TASK_DEADLINE_APPROACHING']),
  condition: z.record(z.any()).optional().default({}),
  action: z.enum(['NOTIFY', 'EMAIL', 'NOTIFY_AND_EMAIL']),
  targets: z.array(z.string()).min(1, 'At least one target is required'),
  isActive: z.boolean().optional().default(true),
});

// GET /api/workflows — List all rules for the org
workflowRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const rules = await prisma.workflowRule.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ rules });
  } catch (error) {
    next(error);
  }
});

// POST /api/workflows — Create a new rule
workflowRouter.post('/', validate(workflowSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const rule = await prisma.workflowRule.create({
      data: {
        ...req.body,
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json(rule);
  } catch (error) {
    next(error);
  }
});

// PUT /api/workflows/:id — Update a rule
workflowRouter.put('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.workflowRule.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Workflow rule not found' });
      return;
    }

    const rule = await prisma.workflowRule.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json(rule);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/workflows/:id/toggle — Toggle active/inactive
workflowRouter.patch('/:id/toggle', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.workflowRule.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Workflow rule not found' });
      return;
    }

    const rule = await prisma.workflowRule.update({
      where: { id: req.params.id },
      data: { isActive: !existing.isActive },
    });

    res.json(rule);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/workflows/:id — Delete a rule
workflowRouter.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.workflowRule.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Workflow rule not found' });
      return;
    }

    await prisma.workflowRule.delete({ where: { id: req.params.id } });
    res.json({ message: 'Rule deleted' });
  } catch (error) {
    next(error);
  }
});
