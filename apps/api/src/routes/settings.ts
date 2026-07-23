import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { hashPassword } from '../utils/password.js';
import { EmailService } from '../services/email.js';
import { emitToOrganization } from '../sse.js';
import { seedDefaultModules } from '../lib/modules.js';
import rateLimit from 'express-rate-limit';
import { createAuditLog } from '../utils/audit.js';
import { toProperCase } from '../utils/properCase.js';

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

const isOrgAdmin = (req: AuthRequest) => req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'ADMIN';

// The `settings` blob nests company billing (bank/GST/PAN), so it is never selected for non-admins.
const ORG_PUBLIC_SELECT = {
  id: true,
  name: true,
  logo: true,
  website: true,
  industry: true,
  companySize: true,
  phone: true,
  address: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GET /api/settings/organization
settingsRouter.get('/organization', async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: isOrgAdmin(req) ? { ...ORG_PUBLIC_SELECT, settings: true } : ORG_PUBLIC_SELECT,
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

// GET /api/settings/company — company billing details (GST/PAN/bank/state/standard T&C) used by quotations.
// The quote and invoice-draft forms need `state` (IGST vs CGST/SGST) and `standardTerms`, so the route stays
// open to every role — but bank/GST/PAN are admin-only and must not travel to a TEAM_MEMBER.
const COMPANY_NON_ADMIN_FIELDS = ['state', 'standardTerms'] as const;

settingsRouter.get('/company', async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId }, select: { name: true, address: true, phone: true, settings: true } });
    const company = ((org?.settings as any)?.company) || {};
    const visible = isOrgAdmin(req)
      ? company
      : Object.fromEntries(COMPANY_NON_ADMIN_FIELDS.filter((k) => k in company).map((k) => [k, company[k]]));
    res.json({ name: org?.name, address: org?.address, phone: org?.phone, ...visible });
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/company — merge company billing details into settings.company.
settingsRouter.put('/company', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const allowed = ['state', 'gst', 'pan', 'bankName', 'bankAccount', 'bankIfsc', 'bankHolder', 'bankBranch', 'email', 'standardTerms', 'quotationTemplate'];
    const company = { ...(settings.company || {}) };
    for (const k of allowed) if (req.body[k] !== undefined) company[k] = req.body[k];
    const updated = await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: { settings: { ...settings, company } },
      select: { settings: true },
    });
    res.json(((updated.settings as any)?.company) || {});
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/notification-preferences — per-user alert toggles (Module F)
settingsRouter.get('/notification-preferences', async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { settings: true } });
    const n = ((user?.settings as any)?.notifications) || {};
    res.json({
      followUpDue: n.followUpDue !== false,
      staleLead: n.staleLead !== false,
      dailyDigest: n.dailyDigest !== false,
      digestTime: n.digestTime || '08:00',
      taskAssigned: n.taskAssigned !== false,
      taskDue24h: n.taskDue24h !== false,
      taskOverdue: n.taskOverdue !== false,
      taskComment: n.taskComment !== false
    });
  } catch (error) { next(error); }
});

// PATCH /api/settings/notification-preferences
settingsRouter.patch('/notification-preferences', async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { settings: true } });
    const settings = (user?.settings as any) || {};
    const notifications = { ...(settings.notifications || {}) };
    for (const k of ['followUpDue', 'staleLead', 'dailyDigest', 'digestTime', 'taskAssigned', 'taskDue24h', 'taskOverdue', 'taskComment']) {
      if (req.body[k] !== undefined) notifications[k] = req.body[k];
    }
    const updated = await prisma.user.update({ where: { id: req.user!.userId }, data: { settings: { ...settings, notifications } }, select: { settings: true } });
    res.json(((updated.settings as any)?.notifications) || {});
  } catch (error) { next(error); }
});

// GET /api/settings/notification-thresholds — org stale-lead thresholds + the business CRM
// notification email that receives the daily Sales & CRM summary (Admin).
settingsRouter.get('/notification-thresholds', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId }, select: { settings: true } });
    const defaults = { OUTREACH: 5, MEETING: 7, PROPOSAL: 7, NEGOTIATION: 5, CONTRACT: 3 };
    const settings = (org?.settings as any) || {};
    res.json({
      thresholds: { ...defaults, ...(settings.staleThresholds || {}) },
      crmNotificationEmail: settings.crmNotificationEmail || '',
      overloadThreshold: settings.overloadThreshold || 25
    });
  } catch (error) { next(error); }
});

// PATCH /api/settings/notification-thresholds (Admin) — body: { thresholds?, crmNotificationEmail?, overloadThreshold? }
settingsRouter.patch('/notification-thresholds', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const staleThresholds = { ...(settings.staleThresholds || {}) };
    const incoming = req.body?.thresholds || {};
    // Only accept a real threshold (>= 1 day). A blank field arrives as 0/NaN — ignore it so we
    // never persist a 0-day threshold that would flag every lead as stale.
    for (const k of ['OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT']) {
      if (incoming[k] === undefined) continue;
      const n = Number(incoming[k]);
      if (Number.isFinite(n) && n >= 1) staleThresholds[k] = Math.round(n);
    }
    if (req.body?.crmNotificationEmail !== undefined) settings.crmNotificationEmail = String(req.body.crmNotificationEmail || '').trim();
    if (req.body?.overloadThreshold !== undefined) {
      const val = Number(req.body.overloadThreshold);
      if (Number.isFinite(val) && val >= 1) settings.overloadThreshold = Math.round(val);
    }
    const updated = await prisma.organization.update({ where: { id: req.user!.organizationId }, data: { settings: { ...settings, staleThresholds } }, select: { settings: true } });
    const s = (updated.settings as any) || {};
    res.json({ thresholds: s.staleThresholds || {}, crmNotificationEmail: s.crmNotificationEmail || '', overloadThreshold: s.overloadThreshold || 25 });
  } catch (error) { next(error); }
});

// GET /api/settings/modules — list this org's modules (ensures CRM + PM rows exist)
settingsRouter.get('/modules', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    await seedDefaultModules(orgId); // idempotent — covers any org missing rows
    const modules = await prisma.organizationModule.findMany({
      where: { organizationId: orgId },
      select: { key: true, enabled: true },
      orderBy: { key: 'asc' },
    });
    res.json(modules);
  } catch (error) {
    next(error);
  }
});

// PUT /api/settings/modules/:key — enable/disable a module (Admins only)
settingsRouter.put('/modules/:key', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const key = String(req.params.key).toUpperCase();
    if (!['CRM', 'PM'].includes(key)) {
      res.status(400).json({ error: 'Unknown module' });
      return;
    }
    const enabled = !!req.body.enabled;
    const module = await prisma.organizationModule.upsert({
      where: { organizationId_key: { organizationId: orgId, key } },
      update: { enabled },
      create: { organizationId: orgId, key, enabled },
      select: { key: true, enabled: true },
    });
    res.json(module);
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
        designation: true,
        teamId: true,
        team: { select: { id: true, name: true } },
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

const inviteUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER']).default('TEAM_MEMBER'),
  designation: z.string().optional(),
  teamId: z.string().optional(),
}).strict();

// POST /api/settings/users (invite)
settingsRouter.post('/users', authorize('SUPER_ADMIN', 'ADMIN'), validate(inviteUserSchema), settingsLimiter, async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, email, role, designation, teamId } = req.body;

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
        name: toProperCase(name),
        email,
        password: hashedPassword,
        role,
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
    const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, organizationId: req.user!.organizationId } });
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (targetUser.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Admins cannot edit Super Admins' });
      return;
    }

    if (req.body.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Super Admins can promote to Super Admin' });
      return;
    }

    const updateUserSchema = z.object({
      name: z.string().trim().min(2).optional(),
      role: z.enum(['ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER']).optional(),
      designation: z.string().nullable().optional(),
      teamId: z.string().nullable().optional(),
      status: z.enum(['ACTIVE', 'PENDING', 'INACTIVE']).optional(),
    }).strict();

    let body: any;
    try {
      body = updateUserSchema.parse(req.body);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
      }
      throw err;
    }

    if (body.name) {
      body.name = toProperCase(body.name);
    }

    if (targetUser.role === 'SUPER_ADMIN') {
      delete body.role; // Cannot be demoted here
    }

    const user = await prisma.user.update({
      where: { id: targetUserId },
      data: body,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        designation: true,
        teamId: true,
        team: { select: { id: true, name: true } },
        status: true,
      },
    });

    const oldRole = targetUser.role;
    const isRoleChanged = body.role && body.role !== oldRole;
    if (isRoleChanged) {
      await createAuditLog({
        organizationId: req.user!.organizationId,
        userId: req.user!.userId,
        action: 'UPDATE_ROLE',
        entityType: 'USER',
        entityId: targetUserId,
        details: {
          userName: targetUser.name,
          userEmail: targetUser.email,
          previousRole: oldRole,
          newRole: body.role
        }
      });
    }

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
settingsRouter.get('/templates', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const templates = await prisma.projectTemplate.findMany({
      where: { organizationId: req.user!.organizationId },
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
        organizationId: req.user!.organizationId,
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

    await createAuditLog({
      organizationId: req.user!.organizationId,
      userId: currentUserId,
      action: 'TRANSFER_SUPER_ADMIN',
      entityType: 'USER',
      entityId: targetUserId,
      details: {
        transferredToName: targetUser.name,
        transferredToEmail: targetUser.email
      }
    });

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

    const existing = await prisma.workflowRule.findFirst({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Workflow rule not found' });
      return;
    }

    const workflow = await prisma.workflowRule.update({
      where: { id: existing.id },
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
    const { count } = await prisma.workflowRule.deleteMany({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId }
    });
    if (count === 0) {
      res.status(404).json({ error: 'Workflow rule not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/audit-logs
settingsRouter.get('/audit-logs', authorize('SUPER_ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        user: { select: { name: true, email: true, avatar: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/api-keys — List active API keys (Super Admin only)
settingsRouter.get('/api-keys', authorize('SUPER_ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { organizationId: req.user!.organizationId },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        createdAt: true,
        user: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(keys);
  } catch (error) {
    next(error);
  }
});

// POST /api/settings/api-keys — Generate new API key (Super Admin only)
settingsRouter.post('/api-keys', authorize('SUPER_ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const rawToken = 'fz_' + crypto.randomBytes(24).toString('hex');

    const apiKey = await prisma.apiKey.create({
      data: {
        key: rawToken,
        name: name.trim(),
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
      },
      select: {
        id: true,
        key: true,
        name: true,
        createdAt: true,
        user: { select: { id: true, name: true } }
      }
    });

    res.status(201).json(apiKey);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/settings/api-keys/:id — Revoke API key (Super Admin only)
settingsRouter.delete('/api-keys/:id', authorize('SUPER_ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: req.params.id as string,
        organizationId: req.user!.organizationId
      }
    });

    if (!apiKey) {
      res.status(404).json({ error: 'API Key not found' });
      return;
    }

    await prisma.apiKey.delete({
      where: { id: apiKey.id }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

