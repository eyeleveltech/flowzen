/**
 * Your own account.
 *
 * The web app has had a finished /profile screen for a long time — it loads
 * you, lets you edit your name, job title and phone, and changes your
 * password. None of it worked, because none of these three routes existed and
 * every request 404'd. Profile sits in the bottom navigation for every signed-
 * in person, so this was the one dead link nobody could avoid.
 *
 * Deliberately narrow, matching the screen: email is what you sign in as, and
 * `preset` is not here at all — nobody promotes themselves.
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { roleForPreset } from '../utils/roles.js';

export const profileRouter = Router();

profileRouter.use(authenticate);

// ── Read ────────────────────────────────────────────────────────────────────

profileRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { organization: { select: { id: true, name: true, allowPasswordLogin: true } } },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      // No uploaded avatars anywhere in this app — the screen draws initials on
      // a colour derived from the name, so null is the honest answer, not a gap.
      avatar: null,
      designation: user.designation,
      phone: user.phone,
      // The day the account was made. There is no separate joining date to keep
      // in step with it, and inventing one would only let the two disagree.
      joiningDate: user.createdAt.toISOString(),
      role: roleForPreset(user.preset),
      organization: user.organization,
      signIn: {
        password: true,
        // Google sign-in is not wired up in this deployment. Said plainly here
        // so the password card offers "change" rather than "set".
        google: false,
        provider: 'password',
      },
    });
  } catch (e) {
    next(e);
  }
});

// ── Edit ────────────────────────────────────────────────────────────────────

const profileUpdateSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  designation: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

profileRouter.patch('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const { name, designation, phone } = parsed.data;
    const blank = (v: string | null | undefined) =>
      v === undefined ? undefined : v && v.trim() ? v.trim() : null;

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(designation !== undefined ? { designation: blank(designation) } : {}),
        ...(phone !== undefined ? { phone: blank(phone) } : {}),
      },
      select: { id: true, name: true, designation: true, phone: true },
    });

    res.json(user);
  } catch (e) {
    next(e);
  }
});

// ── Password ────────────────────────────────────────────────────────────────

const passwordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'Use at least 8 characters'),
});

profileRouter.post('/password', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }

    // Everyone in this deployment has a password, so the current one is always
    // required. Asking for it is what stops a borrowed unlocked laptop from
    // becoming a permanent account takeover.
    if (!currentPassword) {
      res.status(400).json({ success: false, error: 'Enter your current password' });
      return;
    }

    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      res.status(400).json({ success: false, error: 'That is not your current password' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        // Retires every token issued before now, this browser's included — the
        // screen says so before the button, and then sends you to sign in.
        sessionsValidFrom: new Date(),
      },
    });

    res.clearCookie('token');
    res.json({ signedOutEverywhere: true });
  } catch (e) {
    next(e);
  }
});
