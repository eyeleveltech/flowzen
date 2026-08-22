/**
 * Expenses.
 *
 * Operational expenses tracked against a project or company. Used to compute
 * gross margin on the revenue dashboard (master plan §4.9).
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, param, requireRole, requireModule, type AuthRequest } from '../middleware/auth.js';

export const expensesRouter = Router();

// Expenses are Admin domain.
expensesRouter.use(authenticate, requireModule('REVENUE'), requireRole('ADMIN'));

const expenseInput = z.object({
  description: z.string().min(1, 'Description is required'),
  amount: z.union([z.number(), z.string()]).refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: 'Amount must be positive.',
  }),
  currency: z.string().default('INR'),
  date: z.coerce.date().optional(),
  category: z.enum(['VENDOR', 'TRAVEL', 'EQUIPMENT', 'MARKETING', 'MISC']).optional(),
  projectId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  vendor: z.string().optional().nullable(),
  isBillable: z.boolean().optional(),
  receiptKey: z.string().optional().nullable(),
}).refine(data => data.projectId || data.companyId, {
  message: 'An expense must be attributed to either a project or a client.',
  path: ['projectId'],
});

expensesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { companyId, projectId, startDate, endDate } = req.query;

    const expenses = await prisma.expense.findMany({
      where: {
        organizationId: orgId,
        ...(companyId ? { companyId: String(companyId) } : {}),
        ...(projectId ? { projectId: String(projectId) } : {}),
        ...(startDate || endDate
          ? {
              date: {
                ...(startDate ? { gte: new Date(String(startDate)) } : {}),
                ...(endDate ? { lte: new Date(String(endDate)) } : {}),
              },
            }
          : {}),
      },
      include: {
        company: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    res.json({ success: true, data: expenses });
  } catch (e) {
    next(e);
  }
});

expensesRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = expenseInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;

    if (parsed.data.projectId) {
      const p = await prisma.project.findFirst({ where: { id: parsed.data.projectId, organizationId: orgId } });
      if (!p) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      // Inherit company from project if not provided
      if (!parsed.data.companyId) parsed.data.companyId = p.companyId;
    }

    const expense = await prisma.expense.create({
      data: {
        organizationId: orgId,
        description: parsed.data.description,
        amount: new Prisma.Decimal(parsed.data.amount),
        currency: parsed.data.currency,
        date: parsed.data.date ?? new Date(),
        category: parsed.data.category ?? 'MISC',
        projectId: parsed.data.projectId ?? null,
        companyId: parsed.data.companyId ?? null,
        vendor: parsed.data.vendor ?? null,
        isBillable: parsed.data.isBillable ?? false,
        receiptKey: parsed.data.receiptKey ?? null,
        recordedById: req.user!.userId,
      },
      include: {
        company: { select: { name: true } },
        project: { select: { name: true } },
      },
    });

    res.status(201).json({ success: true, data: expense });
  } catch (e) {
    next(e);
  }
});

expensesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = await prisma.expense.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      include: {
        company: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    if (!expense) {
      res.status(404).json({ success: false, error: 'Expense not found' });
      return;
    }
    res.json({ success: true, data: expense });
  } catch (e) {
    next(e);
  }
});

expensesRouter.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.expense.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Expense not found' });
      return;
    }

    const parsed = expenseInput.innerType().partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const data: any = { ...parsed.data };
    if (data.amount !== undefined) data.amount = new Prisma.Decimal(data.amount);

    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data,
      include: {
        company: { select: { name: true } },
        project: { select: { name: true } },
      },
    });

    res.json({ success: true, data: expense });
  } catch (e) {
    next(e);
  }
});

expensesRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.expense.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Expense not found' });
      return;
    }

    // Hard delete. Expenses are operational corrections, not binding legal docs like invoices.
    await prisma.expense.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
