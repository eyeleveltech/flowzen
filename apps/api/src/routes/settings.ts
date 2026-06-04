import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { hashPassword } from '../utils/password.js';

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

    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/users/:id
settingsRouter.put('/users/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const dataToUpdate: any = {
      name: req.body.name,
      role: req.body.role,
      department: req.body.department,
      teamId: req.body.teamId || null,
      isActive: req.body.isActive,
    };

    if (req.body.password && req.body.password.trim() !== '') {
      dataToUpdate.password = await hashPassword(req.body.password);
    }

    const user = await prisma.user.update({
      where: { id: (req.params.id as string) },
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
