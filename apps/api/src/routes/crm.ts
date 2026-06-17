import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';

export const crmRouter = Router();
crmRouter.use(authenticate);

const leadSchema = z.object({
  contactName: z.string().min(1, "Contact or Company Name is required").optional(),
  companyName: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  source: z.enum(['EXCEL', 'MANUAL', 'API', 'REFERRAL', 'INBOUND', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'OTHER']).optional(),
  assignedToId: z.string().optional(),
  dealValue: z.number().optional(),
  expectedCloseDate: z.string().optional(),
  industry: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
}).refine(data => data.contactName || data.companyName, {
  message: "Either Contact Name or Company Name must be provided",
  path: ["contactName"]
});

// GET /api/crm/leads
crmRouter.get('/leads', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { stage, assignedToId } = req.query;

    const where: Record<string, unknown> = { organizationId: orgId };
    if (stage) where.stage = stage as string;
    if (assignedToId) where.assignedToId = assignedToId as string;

    const leads = await prisma.lead.findMany({
      where: where as any,
      include: {
        client: {
          select: { id: true, name: true, company: true, email: true, phone: true, city: true, industry: true }
        },
        assignedTo: {
          select: { id: true, name: true, avatar: true }
        },
        dealFields: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(leads);
  } catch (error) {
    next(error);
  }
});

// GET /api/crm/leads/:id
crmRouter.get('/leads/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      include: {
        client: true,
        assignedTo: { select: { id: true, name: true, avatar: true } },
        dealFields: true,
        stageHistory: {
          include: { changedBy: { select: { name: true, avatar: true } } },
          orderBy: { changedAt: 'desc' }
        },
        activities: {
          include: { user: { select: { name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json(lead);
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads
crmRouter.post('/leads', authorize('SUPER_ADMIN', 'ADMIN'), validate(leadSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { contactName, companyName, email, phone, source, assignedToId, dealValue, expectedCloseDate, industry, city, notes } = req.body;

    // 1. Create the Client (Status: PROSPECT)
    const client = await prisma.client.create({
      data: {
        name: contactName || companyName || 'Unknown',
        company: companyName || null,
        email: email || null,
        phone: phone || null,
        industry: industry || null,
        city: city || null,
        status: 'PROSPECT',
        organizationId: orgId,
      }
    });

    // 2. Create the Lead linked to the Client
    const lead = await prisma.lead.create({
      data: {
        clientId: client.id,
        organizationId: orgId,
        source: source || 'MANUAL',
        stage: 'LEAD',
        assignedToId: assignedToId || null,
        dealValue: dealValue || null,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      },
      include: {
        client: true,
        assignedTo: { select: { id: true, name: true, avatar: true } }
      }
    });

    // 3. Log Activity
    await prisma.activity.create({
      data: {
        type: 'LEAD_CREATED',
        message: `added lead "${client.name}" to the pipeline`,
        entityType: 'LEAD',
        entityId: lead.id,
        userId: req.user!.userId,
        leadId: lead.id,
        metadata: notes ? { notes } : {},
      },
    });

    // 4. Emit real-time event
    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', lead);

    res.status(201).json(lead);
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads/bulk
crmRouter.post('/leads/bulk', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { leads } = req.body;

    if (!Array.isArray(leads)) {
      res.status(400).json({ error: 'Leads must be an array' });
      return;
    }

    if (leads.length > 50) {
      res.status(400).json({ error: 'Bulk import limit exceeded. You can only import a maximum of 50 leads at a time.' });
      return;
    }

    const createdLeads = [];

    for (const data of leads) {
      if (!data.contactName && !data.companyName) continue;

      // 1. Create or find Client
      const client = await prisma.client.create({
        data: {
          name: data.contactName || data.companyName || 'Unknown',
          company: data.companyName || null,
          email: data.email || null,
          phone: data.phone || null,
          industry: data.industry || null,
          city: data.city || null,
          status: 'PROSPECT',
          organizationId: orgId,
        }
      });

      // Ensure stage is a valid LeadStage
      const validStages = [
        'LEAD', 'MQL', 'SQL', 'REACH_OUT', 'DISCOVERY', 'AUDIT', 'PRESENTATION',
        'PROPOSAL', 'NEGOTIATION', 'FINALIZATION', 'CONTRACT', 'ACTIVE_RETAINER',
        'ACTIVE_PROJECT', 'WON_CLOSED', 'LOST_CLOSED'
      ];
      const validStage = validStages.includes(data.stage) ? data.stage : 'LEAD';

      // 2. Create Lead
      const lead = await prisma.lead.create({
        data: {
          clientId: client.id,
          organizationId: orgId,
          source: data.source || 'EXCEL',
          stage: validStage,
          assignedToId: data.assignedToId || null,
          dealValue: data.dealValue ? parseFloat(data.dealValue) : null,
          expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        }
      });

      // 3. Log Activity
      await prisma.activity.create({
        data: {
          type: 'LEAD_CREATED',
          message: `bulk imported lead "${client.name}"`,
          entityType: 'LEAD',
          entityId: lead.id,
          userId: req.user!.userId,
          leadId: lead.id,
          metadata: data.notes ? { notes: data.notes } : {},
        },
      });

      createdLeads.push(lead);
    }

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', {});

    res.status(201).json({ count: createdLeads.length });
  } catch (error) {
    console.error('[Bulk Import Error (Leads)]:', error);
    res.status(400).json({ 
      error: 'Failed to process bulk import. Please check your CSV data format, ensure no required fields are missing, and try again.' 
    });
  }
});

const stageUpdateSchema = z.object({
  stage: z.enum(['LEAD', 'MQL', 'SQL', 'REACH_OUT', 'DISCOVERY', 'AUDIT', 'PRESENTATION', 'PROPOSAL', 'NEGOTIATION', 'FINALIZATION', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'WON_CLOSED', 'LOST_CLOSED']),
  notes: z.string().optional(),
  dealValue: z.number().optional(),
  expectedCloseDate: z.string().optional(),
  contractType: z.enum(['RETAINER', 'ONE_TIME']).optional(),
  lostReason: z.enum(['BUDGET', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'UNRESPONSIVE', 'SCOPE_MISMATCH', 'INTERNAL_CHANGE', 'OTHER']).optional(),
  fields: z.record(z.any()).optional(),
});

// POST /api/crm/leads/:id/stage
crmRouter.post('/leads/:id/stage', authorize('SUPER_ADMIN', 'ADMIN'), validate(stageUpdateSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const { stage, notes, dealValue, expectedCloseDate, contractType, lostReason, fields } = req.body;

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      include: { client: true }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const previousStage = existingLead.stage;

    // Build update data
    const updateData: any = { stage };
    if (dealValue !== undefined) updateData.dealValue = dealValue;
    if (expectedCloseDate !== undefined) updateData.expectedCloseDate = new Date(expectedCloseDate);
    if (contractType !== undefined) updateData.contractType = contractType;
    if (lostReason !== undefined) updateData.lostReason = lostReason;

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      include: {
        client: true,
        assignedTo: { select: { id: true, name: true, avatar: true } }
      }
    });

    // Create Stage History
    await prisma.stageHistory.create({
      data: {
        leadId,
        fromStage: previousStage,
        toStage: stage,
        notes: notes || null,
        changedById: req.user!.userId,
      }
    });

    // Upsert any dynamic fields passed
    if (fields && typeof fields === 'object') {
      for (const [key, value] of Object.entries(fields)) {
        // If value is an array (like a checklist), convert it to JSON string or comma separated
        const strValue = Array.isArray(value) ? value.join(', ') : (value ? String(value) : null);
        
        await prisma.dealField.upsert({
          where: { leadId_fieldKey: { leadId, fieldKey: key } },
          update: { fieldValue: strValue },
          create: { leadId, fieldKey: key, fieldValue: strValue }
        });
      }
    }

    // Auto-update Client Status if moving to Contract or beyond
    const activeStages = ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'];
    if (activeStages.includes(stage) && existingLead.client.status === 'PROSPECT') {
      await prisma.client.update({
        where: { id: existingLead.clientId },
        data: { status: 'ACTIVE' }
      });
    } else if (stage === 'LOST_CLOSED' && existingLead.client.status !== 'CHURNED') {
      await prisma.client.update({
        where: { id: existingLead.clientId },
        data: { status: 'CHURNED' }
      });
    }

    // Emit real-time event
    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);
    // Emit client updated because we may have changed client status
    emitToOrganization(io, orgId, 'client:updated', { id: existingLead.clientId });

    res.json(updatedLead);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/crm/leads/:id
crmRouter.patch('/leads/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const { source, assignedToId, dealValue, expectedCloseDate, contractType, healthStatus, lostReason } = req.body;

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const updateData: any = {};
    if (source !== undefined) updateData.source = source;
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId;
    if (dealValue !== undefined) updateData.dealValue = dealValue;
    if (expectedCloseDate !== undefined) updateData.expectedCloseDate = expectedCloseDate ? new Date(expectedCloseDate) : null;
    if (contractType !== undefined) updateData.contractType = contractType;
    if (healthStatus !== undefined) updateData.healthStatus = healthStatus;
    if (lostReason !== undefined) updateData.lostReason = lostReason;

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      include: {
        client: true,
        assignedTo: { select: { id: true, name: true, avatar: true } }
      }
    });

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);

    res.json(updatedLead);
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads/:id/fields
crmRouter.post('/leads/:id/fields', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const fields = req.body.fields; // Expecting { fieldKey: "value" } map

    if (!fields || typeof fields !== 'object') {
       res.status(400).json({ error: 'Invalid fields object' });
       return;
    }

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Upsert each field
    for (const [key, value] of Object.entries(fields)) {
      await prisma.dealField.upsert({
        where: { leadId_fieldKey: { leadId, fieldKey: key } },
        update: { fieldValue: value ? String(value) : null },
        create: { leadId, fieldKey: key, fieldValue: value ? String(value) : null }
      });
    }

    // Emit real-time event
    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', existingLead);

    res.json({ message: 'Fields updated successfully' });
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads/:id/notes
crmRouter.post('/leads/:id/notes', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const { note } = req.body;

    if (!note || typeof note !== 'string') {
      res.status(400).json({ error: 'Note text is required' });
      return;
    }

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Log Activity
    const activity = await prisma.activity.create({
      data: {
        type: 'NOTE_ADDED',
        message: `added a note`,
        entityType: 'LEAD',
        entityId: leadId,
        userId: req.user!.userId,
        leadId: leadId,
        metadata: { notes: note },
      },
      include: {
        user: { select: { name: true, avatar: true } }
      }
    });

    // Emit real-time event
    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', existingLead);

    res.status(201).json(activity);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/crm/leads/:id
crmRouter.delete('/leads/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const client = existingLead.clientId ? await prisma.client.findUnique({ where: { id: existingLead.clientId } }) : null;

    // Delete associated records first
    await prisma.stageHistory.deleteMany({ where: { leadId } });
    await prisma.dealField.deleteMany({ where: { leadId } });
    await prisma.activity.deleteMany({ where: { leadId } });

    // Delete the lead
    await prisma.lead.delete({
      where: { id: leadId }
    });

    // Clean up orphaned PROSPECT clients so they don't pollute the Reports page
    if (client && client.status === 'PROSPECT') {
      await prisma.activity.deleteMany({ where: { clientId: client.id } });
      await prisma.clientContact.deleteMany({ where: { clientId: client.id } });
      await prisma.client.delete({ where: { id: client.id } });
    }

    // Emit real-time event
    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', { id: leadId, deleted: true });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
