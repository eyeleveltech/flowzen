/**
 * Your own account.
 *
 * Separate from /users on purpose. Everything here is about YOU and needs no
 * role, and nothing here can change a role — the two must not share a handler,
 * or "edit my phone number" and "promote myself" become one code path (§5).
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { authenticate, highestRole, type AuthRequest } from '../middleware/auth.js';

export const profileRouter = Router();

profileRouter.use(authenticate);

class ProfileRuleError extends Error {
  readonly code = 'PROFILE_RULE_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'ProfileRuleError';
  }
}

const onError = (e: unknown, res: Response, next: NextFunction) => {
  if (e instanceof ProfileRuleError) {
    res.status(409).json({ success: false, error: e.message, code: e.code });
    return;
  }
  next(e);
};

profileRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        designation: true,
        phone: true,
        joiningDate: true,
        authProvider: true,
        password: true,
        googleId: true,
        roles: { select: { role: true } },
        organization: { select: { id: true, name: true, allowPasswordLogin: true } },
      },
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        designation: user.designation,
        phone: user.phone,
        joiningDate: user.joiningDate,
        role: highestRole(user.roles.map((r) => r.role)),
        organization: user.organization,
        // Never the hash itself — only whether there is one.
        signIn: {
          password: user.password !== null,
          google: user.googleId !== null,
          provider: user.authProvider,
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

// Deliberately narrow. Email is missing because changing it changes who you sign
// in as, and role is missing because nobody promotes themselves.
const editSchema = z.object({
  name: z.string().min(1, 'A name is needed.').optional(),
  designation: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  avatar: z.string().optional().nullable(),
});

profileRouter.patch('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: parsed.data,
      select: { id: true, name: true, designation: true, phone: true, avatar: true },
    });
    res.json({ success: true, data: user });
  } catch (e) {
    next(e);
  }
});

const passwordSchema = z.object({
  // Optional, because somebody who joined with Google is SETTING a first
  // password rather than changing one, and there is nothing to verify against.
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'Use at least 8 characters.'),
});

/**
 * Change, or set, your password.
 *
 * `tokenVersion` is bumped so every other session dies. Without it a stolen
 * cookie survives the change that was made because of it — which is the one
 * thing a password change is supposed to stop.
 */
profileRouter.post('/password', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.userId },
      select: { id: true, password: true },
    });

    if (user.password) {
      if (!parsed.data.currentPassword) {
        throw new ProfileRuleError('Enter your current password.');
      }
      if (!(await comparePassword(parsed.data.currentPassword, user.password))) {
        throw new ProfileRuleError('That is not your current password.');
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(parsed.data.newPassword),
        tokenVersion: { increment: 1 },
      },
    });

    // This request's own cookie is now stale too, so say so rather than letting
    // the next click look like a random logout.
    res.json({
      success: true,
      data: { signedOutEverywhere: true },
      message: 'Password updated. Sign in again.',
    });
  } catch (e) {
    onError(e, res, next);
  }
});
