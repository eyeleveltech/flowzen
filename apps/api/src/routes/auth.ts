import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { generateToken } from '../utils/jwt.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { validate } from '../middleware/validate.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { getEnabledModuleKeys, seedDefaultModules, DEFAULT_MODULES } from '../lib/modules.js';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { EmailService } from '../services/email.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 auth requests per windowMs
  message: { error: 'Too many authentication attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schemas
const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  organizationName: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/register
authRouter.post('/register', authLimiter, validate(registerSchema), async (req, res: Response, next) => {
  try {
    const { name, email, password, organizationName } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hashedPassword = await hashPassword(password);

    const organization = await prisma.organization.create({
      data: {
        name: organizationName,
        users: {
          create: {
            name,
            email,
            password: hashedPassword,
            role: 'SUPER_ADMIN',
            // The org creator sets their own password here, so activate immediately.
            // Without this the user defaults to PENDING and login (which requires
            // ACTIVE) rejects them once the initial session cookie expires — the
            // only path to ACTIVE otherwise is the email-based password reset.
            status: 'ACTIVE',
          },
        },
        clients: {
          create: {
            name: 'Internal',
            company: organizationName,
            status: 'ACTIVE',
            engagementType: 'INTERNAL',
          },
        },
      },
      include: { users: true },
    });

    // Every new org starts with both modules enabled.
    await seedDefaultModules(organization.id);

    const user = organization.users[0];
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: organization.id,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        organization: {
          id: organization.id,
          name: organization.name,
        },
        enabledModules: [...DEFAULT_MODULES],
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
authRouter.post('/login', authLimiter, validate(loginSchema), async (req, res: Response, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const enabledModules = await getEnabledModuleKeys(user.organizationId);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        department: user.department,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          logo: user.organization.logo,
        },
        enabledModules,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { organization: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const rawUser: any = await prisma.$queryRawUnsafe('SELECT "lastActivityReadAt" FROM "users" WHERE id = $1', req.user!.userId);
    const lastActivityReadAt = rawUser?.[0]?.lastActivityReadAt || null;
    const enabledModules = await getEnabledModuleKeys(user.organizationId);

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      department: user.department,
      designation: user.designation,
      phone: user.phone,
      joiningDate: user.joiningDate,
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        logo: user.organization.logo,
      },
      enabledModules,
      lastActivityReadAt: lastActivityReadAt,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true });
});


// POST /api/auth/request-reset
authRouter.post('/request-reset', authLimiter, async (req: Request, res: Response, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't leak whether the email exists or not
      res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    await EmailService.sendPasswordResetEmail(user.email, resetToken);

    res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/reset-password
authRouter.post('/reset-password', async (req: Request, res: Response, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      res.status(400).json({ error: 'Invalid or expired password reset token' });
      return;
    }

    const hashedPassword = await hashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        status: 'ACTIVE',
      },
    });

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (error) {
    next(error);
  }
});
