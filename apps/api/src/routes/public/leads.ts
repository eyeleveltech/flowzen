import { Router, Request, Response } from 'express';
import { PrismaClient, LeadStage, LeadSource, ActivityEntityType, LostReason, ClientStatus } from '@prisma/client';

const prisma = new PrismaClient();
const leadRouter = Router();

// --- Translators ---

const stageMapToEnum: Record<string, LeadStage> = {
  '1. New Lead': 'NEW_LEAD',
  '2. First Contact Made': 'OUTREACH',
  '3. Discovery Scheduled': 'OUTREACH',
  '4. Discovery Done': 'MEETING',
  '5. Proposal Building': 'MEETING',
  '6. Proposal Sent': 'PROPOSAL',
  '7. Negotiation': 'NEGOTIATION',
  '8. Closed Won': 'CONTRACT',
  '9. Closed Lost': 'CHURNED',
  '10. Dead / No Response': 'CHURNED',
};

const stageEnumToMap: Record<LeadStage, string> = {
  NEW_LEAD: '1. New Lead',
  OUTREACH: '2. First Contact Made',
  MEETING: '4. Discovery Done',
  PROPOSAL: '6. Proposal Sent',
  NEGOTIATION: '7. Negotiation',
  CONTRACT: '8. Closed Won',
  ACTIVE_RETAINER: '8. Closed Won',
  ACTIVE_PROJECT: '8. Closed Won',
  PROJECT_COMPLETED: '8. Closed Won',
  CHURNED: '9. Closed Lost',
  ON_HOLD: 'On Hold',
};

const mapStageToEnum = (aiStage: string): LeadStage => stageMapToEnum[aiStage] || 'NEW_LEAD';
const mapEnumToStage = (dbStage: LeadStage): string => stageEnumToMap[dbStage] || '1. New Lead';

const mapSourceToEnum = (aiSource: string): LeadSource => {
  switch (aiSource) {
    case 'LinkedIn Outreach': return 'LINKEDIN';
    case 'Referral': return 'REFERRAL';
    case 'Inbound': return 'INBOUND';
    case 'Cold Email': return 'API'; // or MANUAL
    case 'Event': return 'OTHER';
    default: return 'OTHER';
  }
};

const mapEnumToSource = (dbSource: LeadSource): string => {
  switch (dbSource) {
    case 'LINKEDIN': return 'LinkedIn Outreach';
    case 'REFERRAL': return 'Referral';
    case 'INBOUND': return 'Inbound';
    default: return 'Other';
  }
};

// Formats a DB Lead to match the AI Brief JSON requirement
const formatLeadResponse = (dbLead: any) => {
  const now = new Date();
  const lastContact = dbLead.activities?.[0]?.createdAt;
  const daysSinceContact = lastContact ? Math.floor((now.getTime() - lastContact.getTime()) / (1000 * 3600 * 24)) : 0;
  
  // Calculate days in current stage from StageHistory if possible
  let daysInStage = 0;
  if (dbLead.stageHistory && dbLead.stageHistory.length > 0) {
    const lastChange = dbLead.stageHistory[0].changedAt;
    daysInStage = Math.floor((now.getTime() - lastChange.getTime()) / (1000 * 3600 * 24));
  } else {
    daysInStage = Math.floor((now.getTime() - dbLead.createdAt.getTime()) / (1000 * 3600 * 24));
  }

  let notes = "";
  if (dbLead.client?.notes && dbLead.client.notes.length > 0) {
    notes = dbLead.client.notes[0].content;
  } else if (dbLead.notes && dbLead.notes.length > 0) {
    notes = dbLead.notes[0].content;
  }

  return {
    id: dbLead.id,
    company_name: dbLead.client?.company || dbLead.companyName || 'Unknown Company',
    contact_name: dbLead.client?.contactPerson || dbLead.client?.name || dbLead.contactName || 'Unknown Lead',
    contact_email: dbLead.client?.email || dbLead.contactEmail || '',
    contact_phone: dbLead.client?.phone || dbLead.contactPhone || '',
    contact_whatsapp: dbLead.client?.phone || dbLead.contactPhone || '',
    vertical: dbLead.client?.industry || '',
    source: mapEnumToSource(dbLead.source),
    stage: mapEnumToStage(dbLead.stage),
    monthly_value: dbLead.dealValue || 0,
    assigned_to: dbLead.assignedTo ? {
      id: dbLead.assignedTo.id,
      name: dbLead.assignedTo.name,
      role: dbLead.assignedTo.role
    } : null,
    last_contact_date: lastContact ? lastContact.toISOString().split('T')[0] : null,
    next_followup_date: dbLead.expectedCloseDate ? dbLead.expectedCloseDate.toISOString().split('T')[0] : null,
    days_since_contact: daysSinceContact,
    days_in_current_stage: daysInStage,
    notes: notes,
    created_at: dbLead.createdAt,
    updated_at: dbLead.updatedAt
  };
};


// --- Endpoints ---

// GET /leads
leadRouter.get('/', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.organizationId;
    const {
      stage,
      stage_not,
      vertical,
      assigned_to_id,
      assigned,
      days_since_contact_gte,
      next_followup_before,
      next_followup_on,
      monthly_value_gte,
      from,
      to,
      limit,
      page
    } = req.query;

    const where: any = { organizationId: orgId };

    if (stage) {
      where.stage = mapStageToEnum(stage as string);
    }
    
    if (stage_not) {
      const excludedStages = (stage_not as string).split(',').map(s => mapStageToEnum(s.trim()));
      where.stage = { notIn: excludedStages };
    }

    const finalAssignee = assigned_to_id || assigned;
    if (finalAssignee) {
      where.assignedToId = finalAssignee as string;
    }

    if (monthly_value_gte) {
      where.dealValue = { gte: parseFloat(monthly_value_gte as string) };
    }

    if (vertical) {
      where.client = { industry: vertical };
    }

    if (next_followup_on) {
      const date = new Date(next_followup_on as string);
      where.expectedCloseDate = {
        gte: new Date(date.setHours(0,0,0,0)),
        lt: new Date(date.setHours(23,59,59,999))
      };
    } else if (next_followup_before) {
      where.expectedCloseDate = { lte: new Date(next_followup_before as string) };
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from as string);
      if (to) where.createdAt.lte = new Date(to as string);
    }

    // Pagination calculations
    const parsedLimit = limit ? parseInt(limit as string, 10) : 100;
    const parsedPage = page ? parseInt(page as string, 10) : 1;
    const skip = (parsedPage - 1) * parsedLimit;

    // Fetch leads
    const leads = await prisma.lead.findMany({
      where,
      include: {
        client: { include: { notes: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        assignedTo: true,
        activities: { orderBy: { createdAt: 'desc' }, take: 1 },
        stageHistory: { orderBy: { changedAt: 'desc' }, take: 1 }
      },
      skip,
      take: parsedLimit,
      orderBy: { createdAt: 'desc' }
    });

    // Post-process filters (like days_since_contact_gte which can't easily be queried natively)
    let processedLeads = leads.map(formatLeadResponse);

    if (days_since_contact_gte) {
      const minDays = parseInt(days_since_contact_gte as string, 10);
      processedLeads = processedLeads.filter(l => l.days_since_contact >= minDays);
    }

    const total = await prisma.lead.count({ where });

    res.json({
      success: true,
      data: processedLeads,
      meta: {
        page: parsedPage,
        limit: parsedLimit,
        total
      }
    });
  } catch (error) {
    console.error('[Public API GET /leads Error]:', error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// GET /leads/:id
leadRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id as string, organizationId: (req as any).user.organizationId },
      include: {
        client: { include: { notes: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        assignedTo: true,
        activities: { 
          orderBy: { createdAt: 'desc' },
          include: { user: true }
        },
        stageHistory: { orderBy: { changedAt: 'desc' }, take: 1 }
      }
    });

    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found', code: 404 });

    const formattedLead = formatLeadResponse(lead) as any;
    
    // Add full activity timeline
    formattedLead.activities = (lead as any).activities.map((act: any) => ({
      id: act.id,
      lead_id: act.leadId,
      type: act.type,
      direction: act.direction || 'outbound',
      summary: act.message,
      done_by: {
        id: act.userId,
        name: act.user?.name || 'System'
      },
      activity_date: act.createdAt,
      created_at: act.createdAt
    }));

    res.json({ success: true, data: formattedLead });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// POST /leads
leadRouter.post('/', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.organizationId;
    const { company_name, contact_name, contact_email, contact_phone, vertical, source, stage, monthly_value, assigned_to_id, next_followup_date, notes } = req.body;

    const dbStage = mapStageToEnum(stage);
    const dbSource = mapSourceToEnum(source);

    // Create client wrapper first
    const client = await prisma.client.create({
      data: {
        name: contact_name || company_name || 'Unknown Lead',
        company: company_name,
        email: contact_email,
        phone: contact_phone,
        industry: vertical,
        organizationId: orgId,
        status: 'PROSPECT',
      }
    });

    const lead = await prisma.lead.create({
      data: {
        clientId: client.id,
        organizationId: orgId,
        source: dbSource,
        stage: dbStage,
        dealValue: monthly_value,
        assignedToId: assigned_to_id || (req as any).user.userId,
        expectedCloseDate: next_followup_date ? new Date(next_followup_date) : undefined,
        notes: notes ? {
          create: {
            content: notes,
            authorId: (req as any).user.userId,
            clientId: client.id
          }
        } : undefined
      },
      include: {
        client: { include: { notes: true } },
        assignedTo: true,
        activities: true,
        stageHistory: true,
        notes: true
      }
    });

    await prisma.activity.create({
      data: {
        type: 'LEAD_CREATED',
        message: `added lead "${client.name}" to the pipeline via EyeLevel AI`,
        entityType: 'LEAD',
        entityId: lead.id,
        userId: (req as any).user.userId,
        leadId: lead.id,
        metadata: notes ? { notes } : {},
      },
    });

    const io = req.app.get('io');
    if (io) {
      // Import emitToOrganization dynamically to avoid circular dependencies if needed, or assume it's loaded
      // The CRM router uses it to update the UI real-time
      io.to(`org_${orgId}`).emit('lead:updated', lead);
    }

    res.status(201).json({ success: true, data: formatLeadResponse(lead) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// PATCH /leads/:id
leadRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { stage, next_followup_date, close_date, monthly_value, value, assigned_to_id, assigned_user_id, notes } = req.body;
    
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id as string, organizationId: (req as any).user.organizationId }, include: { client: true } });
    if (!existing) return res.status(404).json({ success: false, error: 'Lead not found', code: 404 });

    const updateData: any = {};
    if (stage) updateData.stage = mapStageToEnum(stage);
    
    const finalFollowup = next_followup_date || close_date;
    if (finalFollowup) updateData.expectedCloseDate = new Date(finalFollowup);

    const finalValue = monthly_value !== undefined ? monthly_value : value;
    if (finalValue !== undefined) updateData.dealValue = Number(finalValue);

    const finalAssignee = assigned_to_id || assigned_user_id;
    if (finalAssignee) updateData.assignedToId = finalAssignee;

    // If stage is dead, set lost reason
    if (stage === '10. Dead / No Response') {
      updateData.lostReason = 'UNRESPONSIVE';
    }

    const lead = await prisma.lead.update({
      where: { id: req.params.id as string },
      data: updateData,
      include: {
        client: { include: { notes: true } },
        assignedTo: true,
        activities: true,
        stageHistory: true,
        notes: true
      }
    });

    if (notes) {
      await prisma.note.create({
        data: {
          content: notes,
          clientId: lead.clientId,
          leadId: lead.id,
          authorId: (req as any).user.userId
        }
      });
    }

    res.json({ success: true, data: formatLeadResponse(lead) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// POST /leads/:id/activities
leadRouter.post('/:id/activities', async (req: Request, res: Response) => {
  try {
    const { type, direction, summary, done_by_id, activity_date } = req.body;
    
    const activity = await prisma.activity.create({
      data: {
        type: type,
        direction: direction || 'outbound',
        message: summary,
        entityType: 'LEAD',
        entityId: req.params.id as string,
        leadId: req.params.id as string,
        userId: done_by_id || (req as any).user.userId,
        createdAt: activity_date ? new Date(activity_date) : new Date()
      },
      include: { user: true }
    });

    res.status(201).json({
      success: true,
      data: {
        id: activity.id,
        lead_id: activity.leadId,
        type: activity.type,
        direction: activity.direction,
        summary: activity.message,
        done_by: { id: activity.userId, name: (activity as any).user?.name },
        activity_date: activity.createdAt,
        created_at: activity.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// POST /leads/:id/convert
leadRouter.post('/:id/convert', async (req: Request, res: Response) => {
  try {
    const { poc_name, poc_email, poc_phone, monthly_retainer, retainer_start_date } = req.body;

    const lead = await prisma.lead.findFirst({ where: { id: req.params.id as string, organizationId: (req as any).user.organizationId }, include: { client: true } });
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found', code: 404 });
    if (!lead.clientId) return res.status(400).json({ success: false, error: 'Lead has no client yet — move it to the MEETING stage first.', code: 400 });

    // Update Client record to Active
    const client = await prisma.client.update({
      where: { id: lead.clientId },
      data: {
        status: 'ACTIVE',
        contactPerson: poc_name || (lead as any).client.contactPerson,
        email: poc_email || (lead as any).client.email,
        phone: poc_phone || (lead as any).client.phone,
        contractValue: monthly_retainer || lead.dealValue,
        startDate: retainer_start_date ? new Date(retainer_start_date) : new Date(),
      }
    });

    // Create a new Project for this client automatically
    const project = await prisma.project.create({
      data: {
        name: `${client.name} — Onboarding`,
        clientId: client.id,
        ownerId: lead.assignedToId || (req as any).user.userId,
        status: 'IN_PROGRESS',
        type: 'RETAINER',
        startDate: client.startDate,
        description: 'Auto-generated via AI Client Conversion'
      }
    });

    res.status(200).json({
      success: true,
      data: {
        id: client.id,
        name: client.name,
        lead_id: lead.id,
        poc_name: client.contactPerson,
        poc_email: client.email,
        poc_phone: client.phone,
        vertical: client.industry,
        monthly_retainer: client.contractValue,
        retainer_start_date: client.startDate?.toISOString().split('T')[0],
        status: 'active',
        created_at: client.createdAt,
        project_id: project.id,
        project_name: project.name
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

export default leadRouter;
