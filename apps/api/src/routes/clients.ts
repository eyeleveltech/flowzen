import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, requireModule, AuthRequest } from '../middleware/auth.js';
import { emitToOrganization } from '../sse.js';
import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';
import { NotificationService } from '../services/notifications.js';
import { whereIn, parsePagination } from '../utils/query.js';
import { createAuditLog } from '../utils/audit.js';
import { sanitizeRichText } from '../utils/html.js';
import { buildSearchFilter } from '../utils/search-utils.js';
import { createPipelineEntryForClient } from '../services/clientPipelineEntry.service.js';
import { loadUsedLeadPhones } from '../services/leadContact.service.js';
import { normalizePhone } from '../utils/leadId.js';

export const clientRouter = Router();
clientRouter.use(authenticate);

// GET /api/clients
clientRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { search, status, city, accountManagerId, engagementType, industry, includeArchived } = req.query;
    const { page, limit, skip, take } = parsePagination(req.query as any, { defaultLimit: 20 });

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
        take,
      }),
      prisma.client.count({ where: where as any }),
    ]);

    res.json({ clients, total, page, totalPages: Math.ceil(total / limit) });
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

// POST /api/clients — deliberately blocked. Clients are born from the pipeline (a lead being
// won) or from bulk CSV import (/clients/bulk, for onboarding pre-existing customers); there is
// no manual "add one client" path. This is an explicit 403, not a removed route, so a direct API
// call gets a clear reason instead of an ambiguous 404.
clientRouter.post('/', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), (_req: AuthRequest, res: Response) => {
  res.status(403).json({ error: 'Clients cannot be created directly. Win a deal in the pipeline, or use bulk import to onboard existing clients.' });
});

// POST /api/clients/bulk
// Onboards pre-existing customers. Every row is validated individually: valid rows import,
// invalid rows come back with a rejection_reason so the caller can build a report and re-upload
// just those. A bad row never blocks the good ones, and never leaves the caller believing the
// whole import failed when part of it committed (the old behaviour: one throw aborted the loop
// and returned a blanket 400, so a retry duplicated everything created before the failure).
clientRouter.post('/bulk', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const clientsData = req.body.clients;

    if (!Array.isArray(clientsData) || clientsData.length === 0) {
      res.status(400).json({ error: 'Invalid or empty clients array' });
      return;
    }
    if (clientsData.length > 500) {
      res.status(400).json({ error: 'Bulk import limit exceeded. You can import a maximum of 500 clients at a time.' });
      return;
    }

    const validStatuses = ['PROSPECT', 'ACTIVE', 'ONHOLD', 'CHURNED', 'PROJECT_COMPLETED'];
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

    // Account managers are addressed by email in the CSV — nobody filling a spreadsheet knows a
    // cuid. Resolved once, scoped to the caller's org, so a foreign or unknown id can't attach.
    const orgUsers = await prisma.user.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      select: { id: true, email: true },
    });
    const usersByEmail = new Map(orgUsers.map((u) => [u.email.toLowerCase(), u.id]));
    const orgUserIds = new Set(orgUsers.map((u) => u.id));

    // Phone numbers already claimed by a lead in this org — across both the lead rows and their
    // contacts. Preloaded once so the per-row pipeline entry doesn't issue its own lookup, and so
    // two rows in the same file can't claim the same number.
    const takenPhones = await loadUsedLeadPhones(prisma, orgId, normalizePhone);

    // Client names are unique per org, case-insensitive — the same rule the (now removed) single
    // create enforced, and the one PUT still applies on rename. Without it here, re-uploading a
    // file silently minted twin accounts that could never afterwards be renamed, because any
    // rename would collide with its own twin. Seeded from the DB, then extended as rows land so
    // one file can't contain its own duplicates either.
    const existingClients = await prisma.client.findMany({
      where: { organizationId: orgId },
      select: { name: true },
    });
    const takenNames = new Set(existingClients.map((c) => c.name.trim().toLowerCase()));

    let imported = 0;
    let pipelineEntries = 0;
    const rejected: any[] = [];

    for (const data of clientsData) {
      const name = (data.name || '').toString().trim();
      const email = (data.email || data.contactEmail || '').toString().trim();
      const phone = (data.phone || data.contactPhone || '').toString().trim();

      if (name.length < 2) {
        rejected.push({ ...data, rejection_reason: 'Client name is required (min 2 characters).' });
        continue;
      }
      if (email && !emailRe.test(email)) {
        rejected.push({ ...data, rejection_reason: 'Email is not a valid address.' });
        continue;
      }
      if (takenNames.has(name.toLowerCase())) {
        rejected.push({ ...data, rejection_reason: `A client named "${name}" already exists.` });
        continue;
      }

      // Money stays a string all the way to Prisma's Decimal — parseFloat would round-trip it
      // through a binary float (FZ-020).
      let contractValue: string | null = null;
      if (data.contractValue !== undefined && data.contractValue !== null && data.contractValue !== '') {
        const raw = data.contractValue.toString().replace(/[,\s]/g, '');
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
          rejected.push({ ...data, rejection_reason: 'Contract value must be a non-negative number with at most 2 decimal places.' });
          continue;
        }
        contractValue = raw;
      }

      let startDate: Date | null = null;
      if (data.startDate) {
        const parsed = new Date(data.startDate);
        if (isNaN(parsed.getTime())) {
          rejected.push({ ...data, rejection_reason: 'Start date must be a valid date (YYYY-MM-DD).' });
          continue;
        }
        startDate = parsed;
      }

      let accountManagerId: string | null = null;
      if (data.accountManagerEmail) {
        const resolved = usersByEmail.get(data.accountManagerEmail.toString().trim().toLowerCase());
        if (!resolved) {
          rejected.push({ ...data, rejection_reason: 'Account manager email does not match an active user in your organization.' });
          continue;
        }
        accountManagerId = resolved;
      } else if (data.accountManagerId) {
        if (!orgUserIds.has(data.accountManagerId)) {
          rejected.push({ ...data, rejection_reason: 'Account manager not found in your organization.' });
          continue;
        }
        accountManagerId = data.accountManagerId;
      }

      const status = validStatuses.includes(data.status?.toString().toUpperCase())
        ? data.status.toString().toUpperCase()
        : 'PROSPECT';

      try {
        const created = await prisma.client.create({
          data: {
            name,
            company: data.company || null,
            industry: data.industry || null,
            engagementType: data.engagementType || null,
            status,
            website: data.website || null,
            // Mirrored onto the client itself, not just the nested contact. findMatchingClient
            // dedups on client.email / client.phone, so an imported account without them would
            // never match when the same customer's next deal is won — creating a duplicate.
            email: email || null,
            phone: phone || null,
            city: data.city || null,
            state: data.state || null,
            zip: data.zip || null,
            country: data.country || null,
            address: data.address || null,
            // Billing identity — drives quotation auto-fill and the CGST/SGST vs IGST split.
            billingAddress: data.billingAddress || null,
            gstNumber: data.gstNumber || null,
            scope: sanitizeRichText(data.scope) || null,
            assetLinks: data.assetLinks || null,
            startDate,
            contractValue,
            accountManagerId,
            organizationId: orgId,
            contacts: (data.contactName || data.contactEmail || data.contactPhone) ? {
              create: [{
                name: data.contactName || 'Primary Contact',
                designation: data.contactDesignation || null,
                email: data.contactEmail || null,
                phone: data.contactPhone || null,
              }]
            } : undefined
          },
          include: { contacts: true },
        });
        imported++;
        takenNames.add(name.toLowerCase());

        // Give the imported customer its deal card, so it appears on the Pipeline board and —
        // for retainers — in Renewals. A failure here must not lose the client: the account is
        // the import's actual product, the pipeline entry is a convenience the backfill script
        // (scripts/backfill-client-pipeline-entries.ts) can add later.
        try {
          const entry = await createPipelineEntryForClient(prisma, created, {
            takenPhones,
            changedById: req.user!.userId,
          });
          if (entry) pipelineEntries++;
        } catch (leadErr: any) {
          console.error(`[Bulk Import (Clients)] pipeline entry failed for "${name}":`, leadErr?.message || leadErr);
        }
      } catch (createErr: any) {
        rejected.push({ ...data, rejection_reason: 'Could not be saved. Check the field formats on this row.' });
        console.error('[Bulk Import Error (Clients)] row failed:', createErr?.message || createErr);
      }
    }

    if (imported > 0) {
      await prisma.activity.create({
        data: {
          type: 'CLIENT_CREATED',
          message: `bulk imported ${imported} clients`,
          entityType: 'ORGANIZATION',
          entityId: orgId,
          userId: req.user!.userId,
        },
      });

      const io = req.app.get('io');
      emitToOrganization(io, orgId, 'client:created', { bulk: true });
      if (pipelineEntries > 0) emitToOrganization(io, orgId, 'lead:updated', {});
      await invalidateOrganizationCache(orgId);
    }

    res.status(201).json({ imported, pipelineEntries, rejectedCount: rejected.length, rejected, count: imported });
  } catch (error) {
    next(error);
  }
});

// PUT /api/clients/:id
// PUT /api/clients/:id — deliberately blocked. This was a dead duplicate of PUT /api/crm/clients/:id
// (the route the client edit form actually calls) that additionally spread req.body straight into
// prisma.client.update with no key-stripping — a mass-assignment hole, and another way `status`
// could be changed with none of the pipeline's cascade logic. Removed rather than left as a landmine.
clientRouter.put('/:id', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), (_req: AuthRequest, res: Response) => {
  res.status(403).json({ error: 'Use /api/crm/clients/:id to edit a client.' });
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
