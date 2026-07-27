import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, requireModule, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';
import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';
import { NotificationService } from '../services/notifications.js';
import { whereIn } from '../utils/query.js';
import { createAuditLog } from '../utils/audit.js';
import { sanitizeRichText } from '../utils/html.js';
import { buildSearchFilter } from '../utils/search-utils.js';

export const clientRouter = Router();
clientRouter.use(authenticate);

const clientSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  industry: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  contractValue: z.number().optional(),
  startDate: z.string().optional(),
  engagementType: z.string().optional(),
  website: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  billingAddress: z.string().optional(),
  gstNumber: z.string().optional(),
  scope: z.string().optional(),
  assetLinks: z.string().optional(),
  accountManagerId: z.string().optional(),
  status: z.enum(['PROSPECT', 'ACTIVE', 'ONHOLD', 'CHURNED', 'PROJECT_COMPLETED']).optional(),
  contacts: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    designation: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  })).max(5).optional(),
});

// GET /api/clients
clientRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { search, status, city, accountManagerId, engagementType, industry, includeArchived, page = '1', limit = '20' } = req.query;

    const where: Record<string, unknown> = {
      organizationId: orgId,
    };
    if (includeArchived !== 'true') where.archivedAt = null;
    if (status) where.status = whereIn(status);
    if (city) where.city = { contains: city as string, mode: 'insensitive' };
    if (accountManagerId) where.accountManagerId = whereIn(accountManagerId);
    if (engagementType) {
      where.engagementType = whereIn(engagementType);
    } else {
      where.AND = [
        {
          OR: [
            { engagementType: null },
            { engagementType: { not: 'INTERNAL' } }
          ]
        },
        {
          name: { notIn: ['Internal', 'internal'] }
        },
        {
          NOT: { name: { contains: '(Internal)', mode: 'insensitive' } }
        }
      ];
    }
    if (industry) where.industry = whereIn(industry);
    if (search) {
      where.OR = buildSearchFilter(
        ['name', 'company', { contacts: { some: { name: { contains: search as string, mode: 'insensitive' } } } }],
        search as string
      ).OR;
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where: where as any,
        include: {
          contacts: true,
          // Most recent deal only — an account can have been won several times over.
        [('leads' as any)]: { select: { id: true, stage: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { projects: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.client.count({ where: where as any }),
    ]);

    res.json({ clients, total, page: parseInt(page as string), totalPages: Math.ceil(total / parseInt(limit as string)) });
  } catch (error) {
    next(error);
  }
});

// GET /api/clients/:id
clientRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: (req.params.id as string), organizationId: req.user!.organizationId },
      include: {
        contacts: true,
        // Most recent deal only — an account can have been won several times over.
        [('leads' as any)]: { select: { id: true, stage: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        projects: {
          include: {
            owner: { select: { id: true, name: true, avatar: true } },
            _count: { select: { tasks: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        accountManager: { select: { id: true, name: true, avatar: true } },
        notes: {
          include: { author: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: { select: { projects: true } },
      },
    });

    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    res.json(client);
  } catch (error) {
    next(error);
  }
});

// POST /api/clients
clientRouter.post('/', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), validate(clientSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { contacts, startDate, ...data } = req.body;
    // Scope is rich-text HTML rendered raw in the UI — strip anything executable on write.
    data.scope = sanitizeRichText(data.scope);

    // Rule: a client must have at least one contact phone number.
    const hasContactPhone = Array.isArray(contacts) && contacts.some((c: any) => c.phone && String(c.phone).trim());
    if (!hasContactPhone) {
      res.status(400).json({ error: 'A contact phone number is required to create a client.' });
      return;
    }

    // Rule: client names are unique within the organization (case-insensitive).
    const clientName = String(data.name || '').trim();
    const duplicate = await prisma.client.findFirst({
      where: { organizationId: req.user!.organizationId, name: { equals: clientName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (duplicate) {
      res.status(409).json({ error: `A client named "${clientName}" already exists.` });
      return;
    }

    const client = await prisma.client.create({
      data: {
        ...data,
        name: clientName,
        accountManagerId: data.accountManagerId || null,
        startDate: startDate ? new Date(startDate) : undefined,
        organizationId: req.user!.organizationId,
        contacts: contacts ? {
          create: contacts.map((c: any) => ({
            name: c.name,
            designation: c.designation,
            email: c.email,
            phone: c.phone
          }))
        } : undefined,
      },
      include: { contacts: true }
    });

    // Activity log
    await prisma.activity.create({
      data: {
        type: 'CLIENT_CREATED',
        message: `added client "${client.name}"`,
        entityType: 'CLIENT',
        entityId: client.id,
        userId: req.user!.userId,
        clientId: client.id,
      },
    });

    // Real-time notification
    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:created', client);
    await invalidateOrganizationCache(req.user!.organizationId);

    await createAuditLog({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      action: 'CLIENT_CREATE',
      entityType: 'CLIENT',
      entityId: client.id,
      details: { name: client.name, company: client.company }
    });

    res.status(201).json(client);
  } catch (error) {
    next(error);
  }
});

// POST /api/clients/bulk
clientRouter.post('/bulk', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const clientsData = req.body.clients;
    if (!Array.isArray(clientsData) || clientsData.length === 0) {
      res.status(400).json({ error: 'Invalid or empty clients array' });
      return;
    }

    let createdCount = 0;

    // Process sequentially or use a transaction depending on complexity. 
    // Sequential allows us to skip invalid rows easily or handle constraints.
    for (const data of clientsData) {
      if (!data.name) continue;

      await prisma.client.create({
        data: {
          name: data.name,
          company: data.company || null,
          industry: data.industry || null,
          engagementType: data.engagementType || null,
          status: ['PROSPECT', 'ACTIVE', 'ONHOLD', 'CHURNED', 'PROJECT_COMPLETED'].includes(data.status?.toUpperCase()) ? data.status.toUpperCase() : 'PROSPECT',
          website: data.website || null,
          city: data.city || null,
          address: data.address || null,
          scope: sanitizeRichText(data.scope) || null,
          assetLinks: data.assetLinks || null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          contractValue: data.contractValue ? parseFloat(data.contractValue) : null,
          accountManagerId: data.accountManagerId || null,
          organizationId: req.user!.organizationId,
          contacts: (data.contactName || data.contactEmail) ? {
            create: [{
              name: data.contactName || 'Primary Contact',
              designation: data.contactDesignation || null,
              email: data.contactEmail || null,
              phone: data.contactPhone || null
            }]
          } : undefined
        }
      });
      createdCount++;
    }

    // Activity log
    await prisma.activity.create({
      data: {
        type: 'CLIENT_CREATED',
        message: `bulk imported ${createdCount} clients`,
        entityType: 'ORGANIZATION',
        entityId: req.user!.organizationId,
        userId: req.user!.userId,
      },
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:created', { bulk: true });
    await invalidateOrganizationCache(req.user!.organizationId);

    res.status(201).json({ message: `Successfully imported ${createdCount} clients`, count: createdCount });
  } catch (error) {
    console.error('[Bulk Import Error (Clients)]:', error);
    res.status(400).json({
      error: 'Failed to process bulk import. Please check your CSV data format, ensure no required fields are missing, and try again.'
    });
  }
});

// PUT /api/clients/:id
clientRouter.put('/:id', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), validate(clientSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: (req.params.id as string), organizationId: req.user!.organizationId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    if (existing.name === 'Internal') {
      res.status(403).json({ error: 'The Internal client syncs automatically and cannot be manually edited' });
      return;
    }

    const { contacts, startDate, ...data } = req.body;
    // Scope is rich-text HTML rendered raw in the UI — strip anything executable on write.
    data.scope = sanitizeRichText(data.scope);

    // Enforce unique client name when renaming (case-insensitive, excluding self).
    const newName = String(data.name || '').trim();
    if (newName && newName.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.client.findFirst({
        where: { organizationId: req.user!.organizationId, name: { equals: newName, mode: 'insensitive' }, id: { not: existing.id } },
        select: { id: true },
      });
      if (duplicate) {
        res.status(409).json({ error: `A client named "${newName}" already exists.` });
        return;
      }
    }

    const updateData: any = {
      ...data,
      name: newName || existing.name,
      accountManagerId: data.accountManagerId || null,
      startDate: startDate ? new Date(startDate) : undefined,
    };

    // Only replace contacts when the request actually sends a contacts array. The previous
    // unconditional `deleteMany: {}` meant ANY update that omitted contacts (e.g. changing
    // just the GST number or status) silently deleted every contact on the client. A partial
    // update must leave contacts it didn't mention untouched.
    if (Array.isArray(contacts)) {
      updateData.contacts = {
        deleteMany: {},
        create: contacts.map((c: any) => ({
          name: c.name,
          designation: c.designation,
          email: c.email,
          phone: c.phone,
        })),
      };
    }

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: updateData,
      include: { contacts: true }
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:updated', updated);
    await invalidateOrganizationCache(req.user!.organizationId);

    await createAuditLog({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      action: 'CLIENT_UPDATE',
      entityType: 'CLIENT',
      entityId: updated.id,
      details: { name: updated.name, company: updated.company }
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/clients/:id — soft-delete (archive)
clientRouter.delete('/:id', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: (req.params.id as string), organizationId: req.user!.organizationId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    if (existing.name === 'Internal' || existing.engagementType === 'INTERNAL') {
      res.status(403).json({ error: 'The Internal client cannot be deleted or archived' });
      return;
    }

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), status: 'CHURNED' },
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:deleted', { id: existing.id });
    await invalidateOrganizationCache(req.user!.organizationId);

    await createAuditLog({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      action: 'CLIENT_DELETE',
      entityType: 'CLIENT',
      entityId: existing.id,
      details: { name: existing.name, company: existing.company, archivedAt: updated.archivedAt }
    });

    res.json({ message: 'Client archived successfully', client: updated });
  } catch (error) {
    next(error);
  }
});

// POST /api/clients/:id/restore — restore an archived client
clientRouter.post('/:id/restore', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: (req.params.id as string), organizationId: req.user!.organizationId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    if (!existing.archivedAt) {
      res.status(400).json({ error: 'Client is not archived' });
      return;
    }

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: { archivedAt: null, status: 'ACTIVE' },
    });

    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:updated', { id: existing.id });
    await invalidateOrganizationCache(req.user!.organizationId);

    await createAuditLog({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      action: 'CLIENT_RESTORE',
      entityType: 'CLIENT',
      entityId: existing.id,
      details: { name: existing.name, company: existing.company }
    });

    res.json({ message: 'Client restored successfully', client: updated });
  } catch (error) {
    next(error);
  }
});

// POST /api/clients/:id/notes
clientRouter.post('/:id/notes', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    // The client must belong to the caller's org (else this writes a note onto another org's client).
    const client = await prisma.client.findFirst({
      where: { id: req.params.id as string, organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const note = await prisma.note.create({
      data: {
        content: req.body.content,
        type: req.body.type || 'INTERNAL',
        clientId: (req.params.id as string),
        authorId: req.user!.userId,
      },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });

    res.status(201).json(note);
  } catch (error) {
    next(error);
  }
});
