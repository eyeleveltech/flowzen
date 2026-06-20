import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { hashPassword } from '../utils/password.js';
import { EmailService } from '../services/email.js';
import { emitToOrganization } from '../sse.js';
import rateLimit from 'express-rate-limit';

const settingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many settings modifications, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
import crypto from 'crypto';

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
        industry: req.body.industry,
        companySize: req.body.companySize,
        phone: req.body.phone,
        address: req.body.address,
        description: req.body.description,
        settings: req.body.settings,
      },
    });

    // Sync or create the Internal client
    const existingInternalClient = await prisma.client.findFirst({
      where: { organizationId: req.user!.organizationId, name: 'Internal' }
    });

    if (existingInternalClient) {
      await prisma.client.update({
        where: { id: existingInternalClient.id },
        data: { company: req.body.name }
      });
    } else {
      await prisma.client.create({
        data: {
          name: 'Internal',
          company: req.body.name,
          organizationId: req.user!.organizationId,
          status: 'ACTIVE',
          engagementType: 'INTERNAL'
        }
      });
    }

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
        designation: true,
        team: { select: { name: true } },
        status: true,
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
settingsRouter.post('/users', authorize('SUPER_ADMIN', 'ADMIN'), settingsLimiter, async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, email, role, department, designation, password, teamId } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const dummyPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await hashPassword(dummyPassword);
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'TEAM_MEMBER',
        department,
        designation,
        resetToken,
        resetTokenExpiry,
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
        designation: true,
        status: true,
      },
    });

    await EmailService.sendSetupPasswordEmail(email, resetToken);

    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'member:changed', { id: user.id });
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/users/:id
settingsRouter.put('/users/:id', authorize('SUPER_ADMIN', 'ADMIN'), settingsLimiter, async (req: AuthRequest, res: Response, next) => {
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
      designation: req.body.designation,
      teamId: req.body.teamId || null,
      status: req.body.status,
    };

    const user = await prisma.user.update({
      where: { id: targetUserId },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        designation: true,
        team: { select: { name: true } },
        status: true,
      },
    });

    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'member:changed', { id: user.id });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/settings/users/:id
settingsRouter.delete('/users/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const targetUserId = req.params.id as string;
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (targetUser.organizationId !== req.user!.organizationId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    if (targetUser.role === 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Cannot delete a Super Admin' });
      return;
    }

    if (targetUserId === req.user!.userId) {
      res.status(400).json({ error: 'Cannot delete yourself' });
      return;
    }

    await prisma.user.delete({
      where: { id: targetUserId },
    });

    emitToOrganization(req.app.get('io'), req.user!.organizationId, 'member:changed', { id: targetUserId });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error: any) {
    if (error.code === 'P2003') {
      res.status(400).json({ error: 'Cannot delete user with associated records (projects, comments, etc.). Please mark them as inactive instead.' });
    } else {
      next(error);
    }
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
        type: req.body.type || 'RETAINER',
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

// GET /api/settings/workflows
settingsRouter.get('/workflows', async (req: AuthRequest, res: Response, next) => {
  try {
    const workflows = await prisma.workflowRule.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        creator: { select: { id: true, name: true, role: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(workflows);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/workflows
settingsRouter.post('/workflows', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, trigger, condition, action, targets, isActive } = req.body;
    
    const workflow = await prisma.workflowRule.create({
      data: {
        name,
        trigger,
        condition: condition || {},
        action,
        targets: targets || [],
        isActive: isActive !== false,
        organizationId: req.user!.organizationId,
        creatorId: req.user!.userId
      },
      include: {
        creator: { select: { id: true, name: true, role: true } }
      }
    });
    
    res.status(201).json(workflow);
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/workflows/:id
settingsRouter.put('/workflows/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, trigger, condition, action, targets, isActive } = req.body;
    
    const workflow = await prisma.workflowRule.update({
      where: { id: req.params.id as string },
      data: {
        name,
        trigger,
        condition,
        action,
        targets,
        isActive
      },
      include: {
        creator: { select: { id: true, name: true, role: true } }
      }
    });
    
    res.json(workflow);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/settings/workflows/:id
settingsRouter.delete('/workflows/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.workflowRule.delete({
      where: { id: req.params.id as string }
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
