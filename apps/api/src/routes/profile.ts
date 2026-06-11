import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { hashPassword, comparePassword } from '../utils/password.js';

export const profileRouter = Router();

// Require authentication for all profile routes
profileRouter.use(authenticate);

// Validation schemas
const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  department: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
});

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// GET /api/profile
profileRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        designation: true,
        avatar: true,
        organizationId: true,
        teamId: true,
        status: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /api/profile
profileRouter.put('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const data = updateProfileSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        name: data.name,
        department: data.department,
        designation: data.designation,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        designation: true,
        avatar: true,
        organizationId: true,
        teamId: true,
        status: true,
      },
    });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /api/profile/password
profileRouter.put('/password', async (req: AuthRequest, res: Response, next) => {
  try {
    const { currentPassword, newPassword } = updatePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isValid = await comparePassword(currentPassword, user.password);
    if (!isValid) {
      res.status(400).json({ error: 'Incorrect current password' });
      return;
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});
