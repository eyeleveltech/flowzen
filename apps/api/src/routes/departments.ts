import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole, param, type AuthRequest, requireModule } from '../middleware/auth.js';

export const departmentsRouter = Router();

departmentsRouter.use(authenticate, requireModule('PM'));

const departmentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  headId: z.string().optional().nullable(),
  memberIds: z.array(z.string()).optional(),
});

departmentsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const departments = await prisma.department.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        head: { select: { id: true, name: true, avatar: true } },
        users: { select: { id: true, name: true, avatar: true, email: true } },
        _count: { select: { users: true, tasks: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: departments });
  } catch (e) {
    next(e);
  }
});

departmentsRouter.post('/', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const exists = await prisma.department.findUnique({
      where: {
        organizationId_name: {
          organizationId: req.user!.organizationId,
          name: parsed.data.name,
        },
      },
    });

    if (exists) {
      res.status(409).json({ success: false, error: 'A department with this name already exists' });
      return;
    }

    const { memberIds, ...deptData } = parsed.data;

    const department = await prisma.department.create({
      data: {
        name: deptData.name,
        headId: deptData.headId ?? null,
        organizationId: req.user!.organizationId,
        ...(memberIds?.length
          ? {
              users: {
                connect: memberIds.map((id) => ({ id })),
              },
            }
          : {}),
      },
      include: {
        head: { select: { id: true, name: true, avatar: true } },
        users: { select: { id: true, name: true, avatar: true, email: true } },
        _count: { select: { users: true, tasks: true } },
      },
    });

    res.status(201).json({ success: true, data: department });
  } catch (e) {
    next(e);
  }
});

departmentsRouter.patch('/:id', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const parsed = departmentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    if (parsed.data.name) {
      const exists = await prisma.department.findFirst({
        where: {
          organizationId: req.user!.organizationId,
          name: parsed.data.name,
          id: { not: id },
        },
      });
      if (exists) {
        res.status(409).json({ success: false, error: 'A department with this name already exists' });
        return;
      }
    }

    const { memberIds, ...deptData } = parsed.data;

    if (memberIds !== undefined) {
      // Remove members not in memberIds
      await prisma.user.updateMany({
        where: { departmentId: id, organizationId: req.user!.organizationId, id: { notIn: memberIds } },
        data: { departmentId: null },
      });
      // Assign members in memberIds to this department
      if (memberIds.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: memberIds }, organizationId: req.user!.organizationId },
          data: { departmentId: id },
        });
      }
    }

    const department = await prisma.department.update({
      where: { id, organizationId: req.user!.organizationId },
      data: deptData,
      include: {
        head: { select: { id: true, name: true, avatar: true } },
        users: { select: { id: true, name: true, avatar: true, email: true } },
        _count: { select: { users: true, tasks: true } },
      },
    });

    res.json({ success: true, data: department });
  } catch (e) {
    next(e);
  }
});

departmentsRouter.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    await prisma.department.delete({
      where: { id, organizationId: req.user!.organizationId },
    });
    res.json({ success: true, data: { id } });
  } catch (e) {
    next(e);
  }
});

departmentsRouter.post('/:id/members', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const { userId } = req.body ?? {};
    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    const dept = await prisma.department.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!dept) {
      res.status(404).json({ success: false, error: 'Department not found' });
      return;
    }

    await prisma.user.update({
      where: { id: userId, organizationId: req.user!.organizationId },
      data: { departmentId: id },
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

departmentsRouter.delete('/:id/members/:userId', requireRole('MANAGER'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const userId = param(req, 'userId');

    await prisma.user.updateMany({
      where: { id: userId, departmentId: id, organizationId: req.user!.organizationId },
      data: { departmentId: null },
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
