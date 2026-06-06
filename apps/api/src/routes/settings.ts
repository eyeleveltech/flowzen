import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { hashPassword } from '../utils/password.js';
import { EmailService } from '../services/email.js';

export const settingsRouter = Router();
settingsRouter.use(authenticate);

// GET /api/settings/organization
settingsRouter.get('/organization', async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
    });

    res.json(org);
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/organization
settingsRouter.put('/organization', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: {
        name: req.body.name,
        logo: req.body.logo,
        website: req.body.website,
        settings: req.body.settings,
      },
    });

    res.json(org);
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/users
settingsRouter.get('/users', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        department: true,
        team: { select: { name: true } },
        isActive: true,
        joiningDate: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(users);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/users (invite)
settingsRouter.post('/users', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, email, role, department, password, teamId } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hashedPassword = await hashPassword(password || 'Welcome@123');

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'TEAM_MEMBER',
        department,
        organizationId: req.user!.organizationId,
        ...(teamId && {
          teamId
        })
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        isActive: true,
      },
    });

    const generatedPassword = password || 'Welcome@123';
    await EmailService.sendWelcomeEmail(email, generatedPassword);

    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/users/:id
settingsRouter.put('/users/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const targetUserId = req.params.id as string;
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (targetUser.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Admins cannot edit Super Admins' });
      return;
    }

    let roleToSet = req.body.role;
    if (targetUser.role === 'SUPER_ADMIN') {
      roleToSet = 'SUPER_ADMIN'; // Cannot be demoted here
    } else if (req.body.role === 'SUPER_ADMIN') {
      res.status(400).json({ error: 'Cannot promote to Super Admin directly' });
      return;
    }

    const dataToUpdate: any = {
      name: req.body.name,
      role: roleToSet,
      department: req.body.department,
      teamId: req.body.teamId || null,
      isActive: req.body.isActive,
    };

    if (req.body.password && req.body.password.trim() !== '') {
      dataToUpdate.password = await hashPassword(req.body.password);
    }

    const user = await prisma.user.update({
      where: { id: targetUserId },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        team: { select: { name: true } },
        isActive: true,
      },
    });

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/templates
settingsRouter.get('/templates', async (req: AuthRequest, res: Response, next) => {
  try {
    const templates = await prisma.projectTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json(templates);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/templates
settingsRouter.post('/templates', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const template = await prisma.projectTemplate.create({
      data: {
        name: req.body.name,
        description: req.body.description,
        structure: req.body.structure,
      },
    });

    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/users/:id/transfer-super-admin
settingsRouter.post('/users/:id/transfer-super-admin', authorize('SUPER_ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const targetUserId = req.params.id as string;
    const currentUserId = req.user!.userId;

    if (targetUserId === currentUserId) {
      res.status(400).json({ error: 'Cannot transfer role to yourself' });
      return;
    }

    // Verify target user belongs to same org
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser || targetUser.organizationId !== req.user!.organizationId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Perform transfer in a transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: targetUserId },
        data: { role: 'SUPER_ADMIN' },
      }),
      prisma.user.update({
        where: { id: currentUserId },
        data: { role: 'ADMIN' },
      }),
    ]);

    res.json({ message: 'Super Admin role transferred successfully' });
  } catch (error) {
    next(error);
  }
});
