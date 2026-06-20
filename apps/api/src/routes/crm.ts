import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';

export const crmRouter = Router();
crmRouter.use(authenticate);

const leadSchema = z.object({
  clientId: z.string().optional(),
  contactName: z.string().min(1, "Contact or Company Name is required").optional(),
  companyName: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  source: z.enum(['EXCEL', 'MANUAL', 'API', 'REFERRAL', 'INBOUND', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'OTHER', 'OUTBOUND', 'SOCIAL_MEDIA', 'EVENT', 'COLD_CALL', 'EXISTING_CLIENT']).optional(),
  assignedToId: z.string().optional(),
  dealValue: z.number().optional(),
  expectedRevenue: z.number().optional(),
  expectedCloseDate: z.string().optional(),
  followUpDate: z.string().optional(),
  industry: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
}).refine(data => data.clientId || data.contactName || data.companyName, {
  message: "Either Client ID, Contact Name or Company Name must be provided",
  path: ["contactName"],
});

// GET /api/crm/leads
crmRouter.get('/leads', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { 
      stage, 
      assignedToId,
      minDealValue,
      maxDealValue,
      leadSource,
      priority,
      closeDateFrom,
      closeDateTo,
      dateAddedFrom,
      dateAddedTo
    } = req.query;

    const where: Record<string, unknown> = { organizationId: orgId };
    
    if (stage) where.stage = stage as string;
    if (assignedToId) where.assignedToId = assignedToId as string;
    if (leadSource) where.source = leadSource as string;
    if (priority) where.priority = priority as string;

    if (minDealValue || maxDealValue) {
      where.dealValue = {};
      if (minDealValue) (where.dealValue as any).gte = parseFloat(minDealValue as string);
      if (maxDealValue) (where.dealValue as any).lte = parseFloat(maxDealValue as string);
    }

    if (closeDateFrom || closeDateTo) {
      where.expectedCloseDate = {};
      if (closeDateFrom) (where.expectedCloseDate as any).gte = new Date(closeDateFrom as string);
      if (closeDateTo) (where.expectedCloseDate as any).lte = new Date(closeDateTo as string);
    }

    if (dateAddedFrom || dateAddedTo) {
      where.createdAt = {};
      if (dateAddedFrom) (where.createdAt as any).gte = new Date(dateAddedFrom as string);
      if (dateAddedTo) (where.createdAt as any).lte = new Date(dateAddedTo as string);
    }

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
        },
        notes: {
          include: { author: { select: { name: true, avatar: true } } },
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
    const { clientId, contactName, companyName, email, phone, jobTitle, source, assignedToId, dealValue, expectedRevenue, expectedCloseDate, followUpDate, industry, city, notes, priority } = req.body;

    let client;
    if (clientId) {
      client = await prisma.client.findUnique({ where: { id: clientId, organizationId: orgId } });
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
    } else {
      // 1. Create the Client (Status: PROSPECT)
      client = await prisma.client.create({
        data: {
          name: contactName || companyName || 'Unknown',
          company: companyName || null,
          email: email || null,
          phone: phone || null,
          industry: industry || null,
          city: city || null,
          status: 'PROSPECT',
          organizationId: orgId,
          ...(jobTitle && contactName ? {
            contacts: {
              create: {
                name: contactName,
                designation: jobTitle,
                email: email || null,
                phone: phone || null,
              }
            }
          } : {})
        }
      });
    }

    // 2. Create the Lead linked to the Client
    const lead = await prisma.lead.create({
      data: {
        clientId: client.id,
        organizationId: orgId,
        source: source || 'MANUAL',
        stage: 'LEAD',
        assignedToId: assignedToId || null,
        dealValue: dealValue || null,
        expectedRevenue: expectedRevenue || null,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        priority: priority || 'MEDIUM',
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

    // Auto-update Client Status (lifecycle: Prospect -> Active on won/contract, Churned on lost)
    const activeStages = ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'WON_CLOSED'];
    if (activeStages.includes(stage) && existingLead.client.status !== 'ACTIVE') {
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

    // Log a Won/Lost activity so it shows in the lead's Activity tab
    if (stage === 'WON_CLOSED' || stage === 'LOST_CLOSED') {
      const reasonLabel = lostReason ? String(lostReason).replace(/_/g, ' ') : null;
      await prisma.activity.create({
        data: {
          type: 'STAGE_CHANGED',
          message: stage === 'WON_CLOSED' ? 'marked this deal as Won 🎉' : 'marked this deal as Lost',
          entityType: 'LEAD',
          entityId: leadId,
          userId: req.user!.userId,
          leadId,
          metadata: stage === 'LOST_CLOSED'
            ? { notes: [reasonLabel ? `Reason: ${reasonLabel}` : null, notes || null].filter(Boolean).join(' — ') || null }
            : undefined,
        }
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
    const { source, assignedToId, dealValue, expectedRevenue, expectedCloseDate, followUpDate, contractType, healthStatus, lostReason, priority, stage } = req.body;

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      include: { client: true }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const updateData: any = {};
    const changes: string[] = [];

    if (source !== undefined && existingLead.source !== source) { updateData.source = source; changes.push(`changed Source to ${source}`); }
    if (assignedToId !== undefined && existingLead.assignedToId !== assignedToId) { updateData.assignedToId = assignedToId; changes.push(`reassigned lead`); }
    if (dealValue !== undefined && existingLead.dealValue !== dealValue) { updateData.dealValue = dealValue; changes.push(`changed Deal Value to ${dealValue}`); }
    if (expectedRevenue !== undefined && existingLead.expectedRevenue !== expectedRevenue) { updateData.expectedRevenue = expectedRevenue; changes.push(`changed Expected Revenue to ${expectedRevenue}`); }
    if (expectedCloseDate !== undefined) {
      const newDate = expectedCloseDate ? new Date(expectedCloseDate) : null;
      if (existingLead.expectedCloseDate?.getTime() !== newDate?.getTime()) {
        updateData.expectedCloseDate = newDate;
        changes.push(`changed Close Date`);
      }
    }
    if (followUpDate !== undefined) {
      const newDate = followUpDate ? new Date(followUpDate) : null;
      if (existingLead.followUpDate?.getTime() !== newDate?.getTime()) {
        updateData.followUpDate = newDate;
        changes.push(`changed Follow-up Date`);
      }
    }
    if (contractType !== undefined && existingLead.contractType !== contractType) { updateData.contractType = contractType; changes.push(`changed Contract Type to ${contractType}`); }
    if (healthStatus !== undefined && existingLead.healthStatus !== healthStatus) { updateData.healthStatus = healthStatus; changes.push(`changed Health Status to ${healthStatus}`); }
    if (lostReason !== undefined && existingLead.lostReason !== lostReason) { updateData.lostReason = lostReason; changes.push(`changed Lost Reason`); }
    if (priority !== undefined && existingLead.priority !== priority) { updateData.priority = priority; changes.push(`changed Priority to ${priority}`); }
    if (stage !== undefined && existingLead.stage !== stage) { 
      updateData.stage = stage; 
      changes.push(`changed Stage from ${existingLead.stage} to ${stage}`); 
      // Auto-update Client Status
      const activeStages = ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'];
      if (activeStages.includes(stage) && existingLead.client.status === 'PROSPECT') {
        await prisma.client.update({ where: { id: existingLead.clientId }, data: { status: 'ACTIVE' } });
        const io = req.app.get('io');
        emitToOrganization(io, orgId, 'client:updated', { id: existingLead.clientId });
      } else if (stage === 'LOST_CLOSED' && existingLead.client.status !== 'CHURNED') {
        await prisma.client.update({ where: { id: existingLead.clientId }, data: { status: 'CHURNED' } });
        const io = req.app.get('io');
        emitToOrganization(io, orgId, 'client:updated', { id: existingLead.clientId });
      }
    }

    if (Object.keys(updateData).length === 0) {
      res.json(existingLead);
      return;
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      include: {
        client: true,
        assignedTo: { select: { id: true, name: true, avatar: true } }
      }
    });

    // Log Activity for all changes combined
    if (changes.length > 0) {
      await prisma.activity.create({
        data: {
          type: 'LEAD_UPDATED',
          message: changes.join(', '),
          entityType: 'LEAD',
          entityId: leadId,
          userId: req.user!.userId,
          leadId: leadId,
        }
      });
    }

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);

    res.json(updatedLead);
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads/:id/notes
crmRouter.post('/leads/:id/notes', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId }
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const note = await prisma.note.create({
      data: {
        content,
        leadId,
        authorId: req.user!.userId,
      },
      include: { author: { select: { name: true, avatar: true } } }
    });

    // Log Activity
    await prisma.activity.create({
      data: {
        type: 'NOTE_ADDED',
        message: 'added a note',
        entityType: 'LEAD',
        entityId: leadId,
        userId: req.user!.userId,
        leadId,
        metadata: { notes: content }
      }
    });

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', lead);

    res.status(201).json(note);
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
