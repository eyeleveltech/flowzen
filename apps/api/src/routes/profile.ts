import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import { emitToOrganization } from '../sse.js';

export const profileRouter = Router();

// Require authentication for all profile routes
profileRouter.use(authenticate);

// Validation schemas
const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  designation: z.string().trim().max(60).optional().nullable(),
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
        designation: true,
        avatar: true,
        organizationId: true,
        teamId: true,
        team: { select: { id: true, name: true } },
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
        designation: data.designation,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        designation: true,
        avatar: true,
        organizationId: true,
        teamId: true,
        team: { select: { id: true, name: true } },
        status: true,
      },
    });

    // Propagate name/department/designation changes so member lists + assignee
    // dropdowns refresh everywhere (and for other users).
    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'member:changed', { id: user.id });
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

    // Bump tokenVersion to revoke every existing session, then reissue a token for THIS
    // session so the user who just changed their password stays logged in on this device
    // while all other devices are signed out.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      select: { id: true, email: true, role: true, organizationId: true, tokenVersion: true },
    });

    const token = generateToken({
      userId: updated.id,
      email: updated.email,
      role: updated.role,
      organizationId: updated.organizationId,
      tokenVersion: updated.tokenVersion,
    });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});
