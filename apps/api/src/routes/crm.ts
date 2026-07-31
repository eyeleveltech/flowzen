import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, requireModule, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';
import { whereIn } from '../utils/query.js';
import { generateLeadId, normalizePhone } from '../utils/leadId.js';
import { runIntelligence } from '../services/intelligence.service.js';
import { ensureClientForLead, LEAD_IDENTITY_FIELDS } from '../services/clientConversion.service.js';
import { applyLeadStageEffects, stageTransitionError } from '../services/leadStage.service.js';
import { logActivity, ActivityType, ACTIVITY_CATEGORIES } from '../services/activity.service.js';
import { createAuditLog } from '../utils/audit.js';

export const crmRouter = Router();
crmRouter.use(authenticate);

// Lead Entry Gateway: name is required, plus at least one of email or phone.
const leadSchema = z.object({
  clientId: z.string().optional(),
  contactName: z.string().min(2, 'Full name is required (min 2 characters)'),
  companyName: z.string().optional(),
  email: z.union([z.string().email('A valid email is required'), z.literal('')]).optional(),
  phone: z.union([
    z.string().refine((v) => !v || v.replace(/\D/g, '').length >= 10, { message: 'Phone number must be at least 10 digits' }),
    z.literal('')
  ]).optional(),
  jobTitle: z.string().optional(),
  linkedinUrl: z.string().optional(),
  companySize: z.string().optional(),
  landlinePhone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  billingAddress: z.string().optional(),
  gstNumber: z.string().optional(),
  website: z.string().optional(),
  instagramHandle: z.string().optional(),
  facebookPage: z.string().optional(),
  industry: z.string().optional(),
  source: z.enum(['EXCEL', 'MANUAL', 'API', 'REFERRAL', 'INBOUND', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'OTHER', 'OUTBOUND', 'SOCIAL_MEDIA', 'EVENT', 'COLD_CALL', 'EXISTING_CLIENT']).optional(),
  assignedToId: z.string().optional(),
  dealValue: z.number().min(0, 'Deal value cannot be negative').optional(),
  expectedRevenue: z.number().min(0, 'Expected revenue cannot be negative').optional(),
  expectedCloseDate: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Expected close date must be a valid date string' }).optional(),
  followUpDate: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Follow-up date must be a valid date string' }).optional(),
  notes: z.string().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
}).superRefine((data, ctx) => {
  const hasEmail = !!data.email && data.email.trim().length > 0;
  const hasPhone = !!data.phone && data.phone.trim().length > 0;
  if (!hasEmail && !hasPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Email or phone number is required.',
      path: ['email'],
    });
  }
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
      dateAddedTo,
      sort
    } = req.query;

    const where: Record<string, unknown> = { organizationId: orgId };
    
    if (stage) where.stage = whereIn(stage);
    if (assignedToId) where.assignedToId = whereIn(assignedToId);
    if (leadSource) where.source = whereIn(leadSource);
    if (priority) where.priority = whereIn(priority);

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
    // Pagination is optional here — the pipeline board pulls every lead. But when a limit IS
    // supplied, sanitize it: floor page at 1 and cap the page size so ?limit=99999999 can't
    // ask for the whole table, and NaN/negative values fall back to sane bounds (FZ-023).
    const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : NaN;
    const limitNum = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 100) : undefined;
    const rawPage = req.query.page ? parseInt(req.query.page as string, 10) : NaN;
    const pageNum = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : (limitNum ? 1 : undefined);
    const skip = pageNum && limitNum ? (pageNum - 1) * limitNum : undefined;
    const take = limitNum ? limitNum : undefined;

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
      orderBy: sort === 'client_asc' ? [{ contactName: 'asc' }]
             : sort === 'client_desc' ? [{ contactName: 'desc' }]
             : sort === 'stage_asc' ? [{ stage: 'asc' }]
             : sort === 'stage_desc' ? [{ stage: 'desc' }]
             : sort === 'dealValue_asc' ? [{ dealValue: 'asc' }]
             : sort === 'dealValue_desc' ? [{ dealValue: 'desc' }]
             : sort === 'closeDate_asc' ? [{ expectedCloseDate: 'asc' }]
             : sort === 'closeDate_desc' ? [{ expectedCloseDate: 'desc' }]
             : sort === 'owner_asc' ? [{ assignedTo: { name: 'asc' } }]
             : sort === 'owner_desc' ? [{ assignedTo: { name: 'desc' } }]
             : [{ stage: 'asc' }, { position: 'asc' }, { createdAt: 'desc' }],
      ...(skip !== undefined ? { skip } : {}),
      ...(take !== undefined ? { take } : {}),
    });

    res.json(leads);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/crm/leads/reorder — Batch reorder cards within a column or across columns
crmRouter.patch('/leads/reorder', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { items } = req.body; // Array of { id: string, position: number, stage?: string }

    if (!Array.isArray(items) || !items.length) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }

    await prisma.$transaction(
      items.map((item: any) =>
        prisma.lead.updateMany({
          where: { id: item.id, organizationId: orgId },
          data: {
            position: Number(item.position) || 0,
            ...(item.stage ? { stage: item.stage } : {}),
          },
        })
      )
    );

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', { reordered: true });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

const FORECAST_STAGE_WEIGHTS: Record<string, number> = {
  NEW_LEAD: 0.10, OUTREACH: 0.20, MEETING: 0.30, PROPOSAL: 0.40, NEGOTIATION: 0.70,
  CONTRACT: 0.90, ACTIVE_RETAINER: 1.00, ACTIVE_PROJECT: 1.00, ON_HOLD: 0.10,
  PROJECT_COMPLETED: 1.00, CHURNED: 0.00,
};

// GET /api/crm/forecast — Server-side pipeline & forecast aggregates
crmRouter.get('/forecast', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;

    const leads = await prisma.lead.findMany({
      where: { organizationId: orgId },
      select: { stage: true, dealValue: true, expectedCloseDate: true },
    });

    let totalPipelineValue = 0;
    let wonValue = 0;
    let weightedForecastValue = 0;
    let totalCount = leads.length;
    let wonCount = 0;
    const stageCounts: Record<string, number> = {};
    const stageValues: Record<string, number> = {};

    for (const l of leads) {
      const val = Number(l.dealValue) || 0;
      const st = l.stage || 'NEW_LEAD';

      stageCounts[st] = (stageCounts[st] || 0) + 1;
      stageValues[st] = (stageValues[st] || 0) + val;

      if (['ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'CONTRACT', 'PROJECT_COMPLETED'].includes(st)) {
        wonValue += val;
        wonCount++;
      }
      if (st !== 'CHURNED') {
        totalPipelineValue += val;
        const weight = FORECAST_STAGE_WEIGHTS[st] ?? 0.10;
        weightedForecastValue += val * weight;
      }
    }

    const averageDealSize = totalCount > 0 ? totalPipelineValue / totalCount : 0;
    const winRate = totalCount > 0 ? (wonCount / totalCount) * 100 : 0;

    res.json({
      totalLeads: totalCount,
      totalPipelineValue,
      wonValue,
      weightedForecastValue,
      averageDealSize,
      winRate,
      stageCounts,
      stageValues,
    });
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
        // Timeline is loaded via the paginated GET /leads/:id/activity endpoint (not eagerly here).
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

// GET /api/crm/leads/:id/activity — paginated, filterable lead timeline (Module E)
crmRouter.get('/leads/:id/activity', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, select: { id: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    const take = Math.min(Number(req.query.take) || 20, 100);
    const skip = Number(req.query.skip) || 0;
    const category = String(req.query.category || 'all');
    const where: any = { leadId };
    if (category !== 'all' && ACTIVITY_CATEGORIES[category]) where.type = { in: ACTIVITY_CATEGORIES[category] };

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({ where, include: { user: { select: { name: true, avatar: true } } }, orderBy: { createdAt: 'desc' }, take, skip }),
      prisma.activity.count({ where }),
    ]);
    res.json({ activities, total, hasMore: skip + activities.length < total });
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads/:id/activity — manually log a call / meeting / note / email (Module E)
const manualActivitySchema = z.object({
  kind: z.enum(['call', 'meeting', 'note', 'email']),
  body: z.string().optional(),
  // call
  callDate: z.string().optional(), duration: z.number().optional(), outcome: z.string().optional(),
  followUpRequired: z.boolean().optional(), followUpDate: z.string().optional(),
  // meeting
  meetingDate: z.string().optional(), meetingFormat: z.string().optional(), attendees: z.string().optional(), nextStep: z.string().optional(),
  // note
  internal: z.boolean().optional(),
  // email
  subject: z.string().optional(), direction: z.string().optional(), emailDate: z.string().optional(),
});

crmRouter.post('/leads/:id/activity', validate(manualActivitySchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const b = req.body;
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, select: { id: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    let type: string, message: string;
    const metadata: Record<string, any> = {};
    if (b.kind === 'call') {
      type = ActivityType.CALL_LOGGED;
      message = `logged a call${b.outcome ? ` (${b.outcome})` : ''}`;
      Object.assign(metadata, { callDate: b.callDate, duration: b.duration, outcome: b.outcome });
    } else if (b.kind === 'meeting') {
      type = ActivityType.MEETING_LOGGED;
      message = `logged a meeting${b.meetingFormat ? ` (${b.meetingFormat})` : ''}`;
      Object.assign(metadata, { meetingDate: b.meetingDate, meetingFormat: b.meetingFormat, attendees: b.attendees, nextStep: b.nextStep });
    } else if (b.kind === 'email') {
      type = ActivityType.EMAIL_LOGGED;
      message = `logged an email${b.direction ? ` (${b.direction})` : ''}`;
      Object.assign(metadata, { subject: b.subject, direction: b.direction, emailDate: b.emailDate });
    } else {
      type = ActivityType.NOTE_ADDED;
      message = 'added a note';
      metadata.internal = b.internal !== false;
    }

    const io = req.app.get('io');
    const activity = await logActivity({ leadId, type, message, userId: req.user!.userId, body: b.body || null, metadata, io, orgId });

    // A call with a required follow-up sets the lead's followUpDate and logs it.
    if (b.kind === 'call' && b.followUpRequired && b.followUpDate) {
      await prisma.lead.update({ where: { id: leadId }, data: { followUpDate: new Date(b.followUpDate) } });
      await logActivity({ leadId, type: ActivityType.FOLLOW_UP_SET, message: `set a follow-up for ${new Date(b.followUpDate).toLocaleDateString('en-IN')}`, userId: req.user!.userId, io, orgId });
      emitToOrganization(io, orgId, 'lead:updated', { id: leadId });
    }

    res.status(201).json(activity);
  } catch (error) {
    next(error);
  }
});

// ── Module K: renewal & retainer expiry tracker ─────────────────────────────
const renewalSelect = {
  id: true, leadId: true, companyName: true, contactName: true, dealValue: true,
  contractStartDate: true, contractEndDate: true, nextRenewalDate: true, autoRenewal: true,
  renewalStatus: true, renewalNotes: true, clientId: true,
  assignedTo: { select: { id: true, name: true, avatar: true } },
} as const;

// GET /api/crm/renewals — retainer leads with renewal data, most urgent first.
crmRouter.get('/renewals', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { status, salesperson, minValue, maxValue } = req.query as Record<string, string>;
    const where: any = { organizationId: orgId, stage: 'ACTIVE_RETAINER' };
    if (status) where.renewalStatus = status;
    if (salesperson) where.assignedToId = salesperson;
    if (minValue || maxValue) where.dealValue = { ...(minValue ? { gte: Number(minValue) } : {}), ...(maxValue ? { lte: Number(maxValue) } : {}) };
    const leads = await prisma.lead.findMany({ where, select: renewalSelect });
    leads.sort((a, b) => (a.contractEndDate ? +new Date(a.contractEndDate) : Infinity) - (b.contractEndDate ? +new Date(b.contractEndDate) : Infinity));
    res.json(leads);
  } catch (error) { next(error); }
});

// GET /api/crm/renewals/summary — top-strip totals.
crmRouter.get('/renewals/summary', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leads = await prisma.lead.findMany({ where: { organizationId: orgId, stage: 'ACTIVE_RETAINER' }, select: { dealValue: true, contractEndDate: true, renewalStatus: true } });
    // Day boundaries in IST (consistent with the notification scanners), not server-local —
    // otherwise a UTC host shifts the 30-day window by ~5.5h and mis-buckets contracts ending today.
    const IST_OFFSET = 330 * 60000;
    const dayIdx = Math.floor((Date.now() + IST_OFFSET) / 86400000);
    const today = new Date(dayIdx * 86400000 - IST_OFFSET);
    const in30 = new Date((dayIdx + 31) * 86400000 - IST_OFFSET); // exclusive: covers today .. today+30 inclusive
    let totalMrr = 0, due30Count = 0, due30Value = 0, atRiskCount = 0, atRiskValue = 0;
    for (const l of leads) {
      if (l.renewalStatus === 'CHURNED') continue; // churned retainers don't count toward live MRR
      const v = Number(l.dealValue) || 0; totalMrr += v;
      if (l.contractEndDate) { const e = new Date(l.contractEndDate); if (e >= today && e < in30) { due30Count++; due30Value += v; } }
      if (l.renewalStatus === 'AT_RISK') { atRiskCount++; atRiskValue += v; }
    }
    res.json({ totalMrr, due30: { count: due30Count, value: due30Value }, atRisk: { count: atRiskCount, value: atRiskValue } });
  } catch (error) { next(error); }
});

// POST /api/crm/renewals/backfill — backfill missing renewalStatus on active retainers
crmRouter.post('/renewals/backfill', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const result = await prisma.lead.updateMany({
      where: {
        organizationId: orgId,
        stage: 'ACTIVE_RETAINER',
        renewalStatus: null,
      },
      data: {
        renewalStatus: 'UPCOMING',
      },
    });
    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', {});
    res.json({ count: result.count, message: `Successfully backfilled ${result.count} renewal records to UPCOMING status.` });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/crm/leads/:id/renewal — update renewal status / notes / dates.
crmRouter.patch('/leads/:id/renewal', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, select: { id: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const b = req.body || {};
    const data: any = {};
    if (b.renewalStatus !== undefined) data.renewalStatus = b.renewalStatus || null;
    if (b.renewalNotes !== undefined) data.renewalNotes = b.renewalNotes || null;
    if (b.contractStartDate !== undefined) data.contractStartDate = b.contractStartDate ? new Date(b.contractStartDate) : null;
    if (b.contractEndDate !== undefined) data.contractEndDate = b.contractEndDate ? new Date(b.contractEndDate) : null;
    if (b.nextRenewalDate !== undefined) data.nextRenewalDate = b.nextRenewalDate ? new Date(b.nextRenewalDate) : null;
    if (b.autoRenewal !== undefined) data.autoRenewal = !!b.autoRenewal;
    const updated = await prisma.lead.update({ where: { id: leadId }, data, select: renewalSelect });
    emitToOrganization(req.app.get('io'), orgId, 'lead:updated', { id: leadId });
    res.json(updated);
  } catch (error) { next(error); }
});

// ── Module G: secondary contacts on a lead ──────────────────────────────────
const contactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  designation: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  linkedinUrl: z.string().optional(),
  role: z.enum(['DECISION_MAKER', 'INFLUENCER', 'GATEKEEPER', 'CHAMPION', 'CC_ONLY']),
  notes: z.string().optional(),
});
const contactData = (b: any) => ({
  name: b.name, designation: b.designation || null, email: b.email || null, phone: b.phone || null,
  linkedinUrl: b.linkedinUrl || null, role: b.role, notes: b.notes || null,
});

// GET /api/crm/leads/:id/contacts
crmRouter.get('/leads/:id/contacts', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, select: { id: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const contacts = await prisma.leadContact.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } });
    res.json(contacts);
  } catch (error) { next(error); }
});

// POST /api/crm/leads/:id/contacts
crmRouter.post('/leads/:id/contacts', authorize('SUPER_ADMIN', 'ADMIN'), validate(contactSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, select: { id: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    const contact = await prisma.leadContact.create({ data: { leadId, ...contactData(req.body) } });

    const io = req.app.get('io');
    await logActivity({ leadId, type: ActivityType.CONTACT_ADDED, message: `added ${contact.name} as a contact (${String(req.body.role).replace(/_/g, ' ').toLowerCase()})`, userId: req.user!.userId, io, orgId });
    emitToOrganization(io, orgId, 'lead:updated', { id: leadId });
    res.status(201).json(contact);
  } catch (error) { next(error); }
});

// PATCH /api/crm/leads/:id/contacts/:contactId
crmRouter.patch('/leads/:id/contacts/:contactId', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { id: leadId, contactId } = req.params as { id: string; contactId: string };
    const existing = await prisma.leadContact.findFirst({ where: { id: contactId, lead: { id: leadId, organizationId: orgId } }, select: { id: true } });
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return; }
    const b = req.body || {};
    const data: any = {};
    for (const k of ['name', 'designation', 'email', 'phone', 'linkedinUrl', 'role', 'notes']) {
      if (b[k] !== undefined) data[k] = b[k] === '' ? null : b[k];
    }
    const updated = await prisma.leadContact.update({ where: { id: contactId }, data });
    res.json(updated);
  } catch (error) { next(error); }
});

// DELETE /api/crm/leads/:id/contacts/:contactId
crmRouter.delete('/leads/:id/contacts/:contactId', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { id: leadId, contactId } = req.params as { id: string; contactId: string };
    const existing = await prisma.leadContact.findFirst({ where: { id: contactId, lead: { id: leadId, organizationId: orgId } }, select: { id: true } });
    if (!existing) { res.status(404).json({ error: 'Contact not found' }); return; }
    await prisma.leadContact.delete({ where: { id: contactId } });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// POST /api/crm/leads/:id/contacts/:contactId/intelligence — run Intelligence on one contact
crmRouter.post('/leads/:id/contacts/:contactId/intelligence', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { id: leadId, contactId } = req.params as { id: string; contactId: string };
    const contact = await prisma.leadContact.findFirst({ where: { id: contactId, lead: { id: leadId, organizationId: orgId } } });
    if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }

    const linkedinUrl = (req.body?.linkedinUrl as string) || contact.linkedinUrl || '';
    if (!linkedinUrl) { res.status(400).json({ success: false, error: 'This contact has no LinkedIn URL.' }); return; }

    await prisma.leadContact.update({ where: { id: contactId }, data: { dossierStatus: 'pending', ...(req.body?.linkedinUrl ? { linkedinUrl } : {}) } });
    const result = await runIntelligence(linkedinUrl);
    if (!result.success) {
      await prisma.leadContact.update({ where: { id: contactId }, data: { dossierStatus: 'failed' } });
      res.status(502).json({ success: false, error: result.error });
      return;
    }
    const updated = await prisma.leadContact.update({ where: { id: contactId }, data: { dossierJson: result.dossier, dossierStatus: 'complete', dossierGeneratedAt: new Date() } });

    const io = req.app.get('io');
    await logActivity({ leadId, type: ActivityType.INTELLIGENCE_RUN, message: `ran LinkedIn Intelligence on ${contact.name}`, userId: req.user!.userId, io, orgId });
    emitToOrganization(io, orgId, 'lead:updated', { id: leadId });
    res.json({ success: true, dossier: result.dossier, contact: updated });
  } catch (error) { next(error); }
});

// POST /api/crm/leads
crmRouter.post('/leads', authorize('SUPER_ADMIN', 'ADMIN'), validate(leadSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { clientId, contactName, companyName, email, phone, jobTitle, linkedinUrl, source, assignedToId, dealValue, expectedRevenue, expectedCloseDate, followUpDate, notes, priority,
      companySize, landlinePhone, address, city, state, zip, country, billingAddress, gstNumber, website, instagramHandle, facebookPage, industry } = req.body;

    // Phone uniqueness (per organization): reject duplicates with the existing Lead ID.
    // Compared on normalized digits so formatting differences still match.
    const digits = normalizePhone(phone);
    if (digits) {
      const orgLeads = await prisma.lead.findMany({
        where: { organizationId: orgId, contactPhone: { not: null } },
        select: { leadId: true, contactPhone: true },
      });
      const existing = orgLeads.find((l) => normalizePhone(l.contactPhone) === digits);
      if (existing) {
        res.status(409).json({ error: `A lead with this phone number already exists. Lead ID: ${existing.leadId}.` });
        return;
      }
    }

    // A client is only linked at the OUTREACH stage. If an existing client is
    // explicitly chosen, validate it; otherwise the lead starts with no client.
    let client = null as { id: string } | null;
    if (clientId) {
      client = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId, archivedAt: null }, select: { id: true } });
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
    }

    if (assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: { id: assignedToId, organizationId: orgId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!assignee) {
        res.status(400).json({ error: 'Assigned user not found in your organization' });
        return;
      }
    }

    let lead: any = null;
    let attempts = 0;
    while (!lead && attempts < 3) {
      attempts++;
      const currentLeadId = await generateLeadId(orgId);
      try {
        lead = await prisma.lead.create({
          data: {
            leadId: currentLeadId,
            clientId: client ? client.id : null,
            organizationId: orgId,
            source: source || 'MANUAL',
            stage: 'NEW_LEAD',
            assignedToId: assignedToId || null,
            dealValue: dealValue ?? null,
            expectedRevenue: expectedRevenue ?? null,
            expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
            followUpDate: followUpDate ? new Date(followUpDate) : null,
            priority: priority || 'MEDIUM',
            contactName,
            companyName: companyName || null,
            contactEmail: email,
            contactPhone: phone,
            jobTitle: jobTitle || null,
            linkedinUrl: linkedinUrl || null,
            companySize: companySize || null,
            landlinePhone: landlinePhone || null,
            address: address || null,
            city: city || null,
            state: state || null,
            zip: zip || null,
            country: country || null,
            website: website || null,
            instagramHandle: instagramHandle || null,
            facebookPage: facebookPage || null,
            industry: industry || null,
            billingAddress: billingAddress || null,
            gstNumber: gstNumber || null,
          },
          include: {
            client: true,
            assignedTo: { select: { id: true, name: true, avatar: true } }
          }
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('leadId') && attempts < 3) {
          continue;
        }
        throw err;
      }
    }

    // Log Activity
    await prisma.activity.create({
      data: {
        type: 'LEAD_CREATED',
        message: `added lead "${contactName || companyName}" to the pipeline`,
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

    await createAuditLog({
      organizationId: orgId,
      userId: req.user!.userId,
      action: 'LEAD_CREATE',
      entityType: 'LEAD',
      entityId: lead.id,
      details: { contactName: lead.contactName, companyName: lead.companyName }
    });

    res.status(201).json(lead);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: 'A lead with this phone number already exists in your organization.' });
      return;
    }
    next(error);
  }
});

// POST /api/crm/leads/bulk
// Lead Entry Gateway for bulk upload: every row is validated; valid rows are imported,
// invalid rows are returned with a rejection_reason so the client can build a report.
// Bad rows never block the good ones.
crmRouter.post('/leads/bulk', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { leads } = req.body;

    if (!Array.isArray(leads)) {
      res.status(400).json({ error: 'Leads must be an array' });
      return;
    }

    if (leads.length > 500) {
      res.status(400).json({ error: 'Bulk import limit exceeded. You can import a maximum of 500 leads at a time.' });
      return;
    }

    const validStages = [
      'NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
      'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'ON_HOLD', 'PROJECT_COMPLETED', 'CHURNED'
    ];
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

    // Existing phone digits in the org, plus those seen earlier in this batch, for dedup.
    const orgLeads = await prisma.lead.findMany({
      where: { organizationId: orgId, contactPhone: { not: null } },
      select: { contactPhone: true },
    });
    const seenPhones = new Set(orgLeads.map((l) => normalizePhone(l.contactPhone)).filter(Boolean));

    let imported = 0;
    const rejected: any[] = [];

    for (const data of leads) {
      // Lead Entry Gateway: name is required, plus at least one of email or phone.
      const name = (data.contactName || '').toString().trim();
      const email = (data.email || '').toString().trim();
      const digits = normalizePhone(data.phone);

      if (name.length < 2) { rejected.push({ ...data, rejection_reason: 'Full name is required (min 2 characters).' }); continue; }
      if (email && !emailRe.test(email)) { rejected.push({ ...data, rejection_reason: 'A valid email is required.' }); continue; }
      if (digits && digits.length < 10) { rejected.push({ ...data, rejection_reason: 'Phone number must be at least 10 digits.' }); continue; }
      if (!email && !digits) { rejected.push({ ...data, rejection_reason: 'Email or phone number is required.' }); continue; }
      if (digits && digits.length >= 10 && seenPhones.has(digits)) { rejected.push({ ...data, rejection_reason: 'Duplicate phone number (already exists).' }); continue; }
      if (digits && digits.length >= 10) { seenPhones.add(digits); }

      if (data.assignedToId) {
        const assignee = await prisma.user.findFirst({
          where: { id: data.assignedToId, organizationId: orgId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!assignee) {
          rejected.push({ ...data, rejection_reason: 'Assigned user not found in your organization.' });
          continue;
        }
      }

      const parsedDealValue = data.dealValue !== undefined && data.dealValue !== '' ? parseFloat(data.dealValue) : null;
      if (parsedDealValue !== null && (isNaN(parsedDealValue) || parsedDealValue < 0)) {
        rejected.push({ ...data, rejection_reason: 'Deal value must be a non-negative number.' });
        continue;
      }
      if (data.expectedCloseDate && isNaN(Date.parse(data.expectedCloseDate))) {
        rejected.push({ ...data, rejection_reason: 'Expected close date must be a valid date string.' });
        continue;
      }

      // No client is created at import — contact identity lives on the lead until OUTREACH.
      const validStage = validStages.includes(data.stage) ? data.stage : 'NEW_LEAD';
      const newLeadId = await generateLeadId(orgId);

      let lead;
      try {
        lead = await prisma.lead.create({
          data: {
            leadId: newLeadId,
            organizationId: orgId,
            source: 'EXCEL', // bulk upload
            stage: validStage,
            assignedToId: data.assignedToId || null,
            dealValue: parsedDealValue,
            expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
            contactName: name,
            companyName: data.companyName || null,
            contactEmail: email,
            contactPhone: (data.phone || '').toString(),
            jobTitle: data.jobTitle || null,
            linkedinUrl: data.linkedinUrl || null,
            companySize: data.companySize || null,
            website: data.website || null,
            industry: data.industry || null,
            city: data.city || null,
          }
        });
      } catch (createErr: any) {
        if (createErr?.code === 'P2002') {
          rejected.push({ ...data, rejection_reason: 'Duplicate phone number (already exists in organization).' });
          seenPhones.add(digits);
          continue;
        }
        throw createErr;
      }

      await prisma.activity.create({
        data: {
          type: 'LEAD_CREATED',
          message: `bulk imported lead "${name}"`,
          entityType: 'LEAD',
          entityId: lead.id,
          userId: req.user!.userId,
          leadId: lead.id,
          metadata: data.notes ? { notes: data.notes } : {},
        },
      });

      imported++;
    }

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', {});

    res.status(201).json({ imported, rejectedCount: rejected.length, rejected });
  } catch (error) {
    next(error);
  }
});

// CONVERSION_STAGES (imported) are where the deal is won and delivery/billing begins — the
// Client account is created on entering any of these. Everything before CONTRACT stays
// lead-only: no Client record exists while the deal is still being chased, so there is
// nothing to duplicate. A stage change never deletes a Client — dragging a card backwards
// only moves the card; the account and all its data are left untouched.

const stageUpdateSchema = z.object({
  stage: z.enum(['NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'ON_HOLD', 'PROJECT_COMPLETED', 'CHURNED']),
  notes: z.string().optional(),
  dealValue: z.number().min(0, 'Deal value cannot be negative').optional(),
  expectedCloseDate: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Expected close date must be a valid date string' }).optional(),
  contractType: z.enum(['RETAINER', 'ONE_TIME']).optional(),
  contractStartDate: z.string().optional(),
  contractEndDate: z.string().optional(),
  lostReason: z.enum(['BUDGET', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'UNRESPONSIVE', 'SCOPE_MISMATCH', 'INTERNAL_CHANGE', 'OTHER']).optional(),
  fields: z.record(z.any()).optional(),
  followUpDate: z.string().optional().nullable(),
  lastContactedDate: z.string().optional().nullable(),
  position: z.number().optional(), // optional card position when a drag both moves stage and reorders
  reopen: z.boolean().optional(), // explicit intent to reopen a closed (CHURNED/PROJECT_COMPLETED) deal
});

// POST /api/crm/leads/:id/stage
crmRouter.post('/leads/:id/stage', authorize('SUPER_ADMIN', 'ADMIN'), validate(stageUpdateSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const { stage, notes, dealValue, expectedCloseDate, contractType, contractStartDate, contractEndDate, lostReason, fields, followUpDate, lastContactedDate, position, reopen } = req.body;

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      include: { client: true }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const previousStage = existingLead.stage;

    // State-machine guard: a closed deal can't be silently reopened into the funnel.
    const transitionErr = stageTransitionError(previousStage, stage, reopen);
    if (transitionErr) {
      res.status(409).json({ error: transitionErr, code: 'DEAL_CLOSED' });
      return;
    }

    // Build update data
    const updateData: any = { stage };
    if (dealValue !== undefined) updateData.dealValue = dealValue;
    if (expectedCloseDate !== undefined) updateData.expectedCloseDate = new Date(expectedCloseDate);
    if (followUpDate !== undefined) updateData.followUpDate = followUpDate ? new Date(followUpDate) : null;
    if (lastContactedDate !== undefined) updateData.lastContactedDate = lastContactedDate ? new Date(lastContactedDate) : null;
    if (contractType !== undefined) updateData.contractType = contractType;
    if (contractStartDate !== undefined) updateData.contractStartDate = new Date(contractStartDate);
    if (contractEndDate !== undefined) {
      updateData.contractEndDate = new Date(contractEndDate);
      // Only seed UPCOMING on first set — never clobber an admin's AT_RISK / IN_DISCUSSION.
      if (!existingLead.renewalStatus) updateData.renewalStatus = 'UPCOMING';
    }
    if (position !== undefined) updateData.position = Number(position) || 0;
    if (stage === 'CHURNED') updateData.renewalStatus = 'CHURNED'; // keep renewal state coherent with churn
    if (lostReason !== undefined) updateData.lostReason = lostReason;

    const { updatedLead, finalClientId, newClientId } = await prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id: leadId },
        data: updateData,
        include: {
          client: true,
          assignedTo: { select: { id: true, name: true, avatar: true } }
        }
      });

      // Upsert any dynamic fields passed
      if (fields && typeof fields === 'object') {
        for (const [key, value] of Object.entries(fields)) {
          const strValue = Array.isArray(value) ? value.join(', ') : (value ? String(value) : null);
          await tx.dealField.upsert({
            where: { leadId_fieldKey: { leadId, fieldKey: key } },
            update: { fieldValue: strValue },
            create: { leadId, fieldKey: key, fieldValue: strValue }
          });
        }
      }

      // All stage consequences — history, conversion, client status, idempotent revenue — live
      // in one shared service (also used by PATCH /leads/:id) so both entry points behave identically.
      const { clientId: currentClientId, newClientId: outNewClientId } = await applyLeadStageEffects(tx, {
        lead: existingLead,
        orgId,
        userId: req.user!.userId,
        toStage: stage,
        previousStage,
        notes,
        dealValue: dealValue ?? existingLead.dealValue ?? undefined,
        contractStartDate,
        contractEndDate,
        billingFrequency: contractType === 'RETAINER' ? fields?.billingFrequency : undefined,
        reopen,
      });
      if (currentClientId) updated.clientId = currentClientId;

      const reasonLabel = lostReason ? String(lostReason).replace(/_/g, ' ') : null;
      const stageMsg = stage === 'CONTRACT' ? 'signed the contract 🎉'
        : stage === 'CHURNED' ? 'marked this deal as Churned'
        : `moved this lead to ${stage.replace(/_/g, ' ')}`;
      
      await tx.activity.create({
        data: {
          type: 'STAGE_CHANGED',
          message: stageMsg,
          entityType: 'LEAD',
          entityId: leadId,
          userId: req.user!.userId,
          leadId,
          metadata: { from: previousStage, to: stage, body: [stage === 'CHURNED' && reasonLabel ? `Reason: ${reasonLabel}` : null, notes || null].filter(Boolean).join(' — ') || null },
        }
      });

      return { updatedLead: updated, finalClientId: currentClientId, newClientId: outNewClientId };
    }, {
      isolationLevel: 'ReadCommitted' // Keeps transaction short while preventing dirty reads
    });

    const io = req.app.get('io');
    
    // Log Activity socket emit manually since we bypassed logActivity function
    if (io && typeof io.to === 'function') {
      io.to(orgId).emit('activity:new', { leadId });
    }
    
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);
    if (finalClientId) emitToOrganization(io, orgId, 'client:updated', { id: finalClientId });
    if (newClientId) emitToOrganization(io, orgId, 'client:created', { id: newClientId });

    res.json(updatedLead);
  } catch (error: any) {
    // Lost a concurrency race: a parallel stage change for THIS lead already created the single
    // subscription/contract (unique sourceLeadId). Our transaction rolled back cleanly, so no
    // double revenue was written. The winner already set the target stage — return current state
    // so a double-fired drag resolves as a harmless no-op instead of a 500.
    if (error?.code === 'P2002' && String(error?.meta?.target ?? '').includes('sourceLeadId')) {
      const current = await prisma.lead.findFirst({
        where: { id: req.params.id as string, organizationId: req.user!.organizationId },
        include: { client: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
      });
      if (current) { res.json(current); return; }
    }
    next(error);
  }
});

// POST /api/crm/leads/:id/intelligence — run the LinkedIn Intelligence Engine (Module A).
crmRouter.post('/leads/:id/intelligence', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } });
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const linkedinUrl = (req.body?.linkedinUrl as string) || lead.linkedinUrl || '';
    if (!linkedinUrl) {
      res.status(400).json({ success: false, error: 'This lead has no LinkedIn URL.' });
      return;
    }

    await prisma.lead.update({ where: { id: leadId }, data: { dossierStatus: 'pending', ...(req.body?.linkedinUrl ? { linkedinUrl } : {}) } });

    const result = await runIntelligence(linkedinUrl);

    if (!result.success) {
      await prisma.lead.update({ where: { id: leadId }, data: { dossierStatus: 'failed' } });
      res.status(502).json({ success: false, error: result.error });
      return;
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { dossierJson: result.dossier, dossierStatus: 'complete', dossierGeneratedAt: new Date(), linkedinChecked: true, linkedinFound: true },
    });

    const io = req.app.get('io');
    await logActivity({ leadId, type: ActivityType.INTELLIGENCE_RUN, message: 'ran LinkedIn Intelligence', userId: req.user!.userId, io, orgId });
    emitToOrganization(io, orgId, 'lead:updated', { id: leadId });

    res.json({ success: true, dossier: result.dossier });
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads/:id/hold — park a lead's client as ON_HOLD from any stage.
crmRouter.post('/leads/:id/hold', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const { followUpDate } = req.body as { followUpDate?: string };

    const existingLead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } });
    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Parking a lead is a pipeline action, not a conversion — it never creates an account.
    // If the deal was already won and has a Client, park that account too.
    const clientId = existingLead.clientId;
    if (clientId) {
      await prisma.client.update({ where: { id: clientId }, data: { status: 'ONHOLD' } });
      // Pause billing while parked so it drops off MRR (mirrors the stage-based ON_HOLD path).
      await prisma.subscription.updateMany({ where: { clientId, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        stage: 'ON_HOLD',
        followUpDate: followUpDate ? new Date(followUpDate) : existingLead.followUpDate,
      },
      include: { client: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
    });

    await prisma.activity.create({
      data: {
        type: 'LEAD_UPDATED',
        message: `put lead "${existingLead.contactName || existingLead.companyName}" on hold`,
        entityType: 'LEAD',
        entityId: leadId,
        userId: req.user!.userId,
        leadId,
      },
    });

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);
    if (clientId) emitToOrganization(io, orgId, 'client:updated', { id: clientId });

    res.json(updatedLead);
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/leads/:id/unhold — unpark a lead's client from ON_HOLD.
crmRouter.post('/leads/:id/unhold', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;

    const existingLead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } });
    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Try to find the last stage from history before ON_HOLD
    const lastHistory = await prisma.stageHistory.findFirst({
      where: { leadId },
      orderBy: { changedAt: 'desc' },
    });
    const targetStage = (lastHistory && lastHistory.fromStage !== 'ON_HOLD') 
      ? lastHistory.fromStage 
      : 'NEW_LEAD';

    if (existingLead.clientId) {
      // A Client only exists once the deal was won, so unparking never demotes it back to
      // PROSPECT — if the restored stage says nothing about the account, leave it as it was.
      let clientStatus: 'ACTIVE' | 'PROJECT_COMPLETED' | 'CHURNED' | null = null;
      if (['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(targetStage)) clientStatus = 'ACTIVE';
      else if (targetStage === 'PROJECT_COMPLETED') clientStatus = 'PROJECT_COMPLETED';
      else if (targetStage === 'CHURNED') clientStatus = 'CHURNED';

      if (clientStatus) {
        await prisma.client.update({ where: { id: existingLead.clientId }, data: { status: clientStatus } });
        // Resume billing we paused at hold-time when the account comes back active.
        if (clientStatus === 'ACTIVE') {
          await prisma.subscription.updateMany({ where: { clientId: existingLead.clientId, status: 'PAUSED' }, data: { status: 'ACTIVE' } });
        }
      }
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: { stage: targetStage },
      include: { client: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
    });

    await prisma.activity.create({
      data: {
        type: 'LEAD_UPDATED',
        message: `removed hold from lead "${existingLead.contactName || existingLead.companyName}"`,
        entityType: 'LEAD',
        entityId: leadId,
        userId: req.user!.userId,
        leadId,
      },
    });

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);
    if (existingLead.clientId) {
      emitToOrganization(io, orgId, 'client:updated', { id: existingLead.clientId });
    }

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
    const { source, assignedToId, dealValue, expectedRevenue, expectedCloseDate, followUpDate, lastContactedDate, contractType, healthStatus, lostReason, priority, stage, contractStartDate, contractEndDate, autoRenewal, renewalStatus, reopen } = req.body;
    // Editable contact/company identity fields on the lead detail card.
    const EDITABLE_TEXT_FIELDS = ['contactName', 'companyName', 'contactEmail', 'contactPhone', 'jobTitle', 'linkedinUrl', 'companySize', 'landlinePhone', 'address', 'city', 'state', 'zip', 'country', 'billingAddress', 'gstNumber', 'website', 'instagramHandle', 'facebookPage', 'industry'] as const;

    const existingLead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      include: { client: true }
    });

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // State-machine guard: a closed deal can't be silently reopened into the funnel.
    if (stage !== undefined && existingLead.stage !== stage) {
      const transitionErr = stageTransitionError(existingLead.stage, stage, reopen);
      if (transitionErr) {
        res.status(409).json({ error: transitionErr, code: 'DEAL_CLOSED' });
        return;
      }
    }

    const updateData: any = {};
    const changes: string[] = [];

    if (source !== undefined && existingLead.source !== source) { updateData.source = source; changes.push(`changed Source to ${source}`); }
    if (assignedToId !== undefined && assignedToId !== null && existingLead.assignedToId !== assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: { id: assignedToId, organizationId: orgId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!assignee) {
        res.status(400).json({ error: 'Assigned user not found in your organization' });
        return;
      }
      updateData.assignedToId = assignedToId;
      changes.push(`reassigned lead`);
    } else if (assignedToId === null && existingLead.assignedToId !== null) {
      updateData.assignedToId = null;
      changes.push(`unassigned lead`);
    }

    if (dealValue !== undefined && dealValue !== null) {
      if (typeof dealValue === 'number' && dealValue < 0) {
        res.status(400).json({ error: 'Deal value cannot be negative' });
        return;
      }
      // dealValue is a Decimal column — coerce before comparing, or a Decimal object is always
      // !== the incoming number and every save would log a spurious change (FZ-020).
      if (Number(existingLead.dealValue ?? NaN) !== dealValue) {
        updateData.dealValue = dealValue;
        changes.push(`changed Deal Value to ${dealValue}`);
      }
    }
    if (expectedRevenue !== undefined && expectedRevenue !== null) {
      if (typeof expectedRevenue === 'number' && expectedRevenue < 0) {
        res.status(400).json({ error: 'Expected revenue cannot be negative' });
        return;
      }
      if (Number(existingLead.expectedRevenue ?? NaN) !== expectedRevenue) {
        updateData.expectedRevenue = expectedRevenue;
        changes.push(`changed Expected Revenue to ${expectedRevenue}`);
      }
    }
    if (expectedCloseDate !== undefined && expectedCloseDate !== null) {
      if (typeof expectedCloseDate === 'string' && isNaN(Date.parse(expectedCloseDate))) {
        res.status(400).json({ error: 'Expected close date must be a valid date string' });
        return;
      }
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
    if (lastContactedDate !== undefined) {
      const newDate = lastContactedDate ? new Date(lastContactedDate) : null;
      if (existingLead.lastContactedDate?.getTime() !== newDate?.getTime()) {
        updateData.lastContactedDate = newDate;
        changes.push(`changed Last Contacted Date`);
      }
    }
    if (contractStartDate !== undefined) {
      const newDate = contractStartDate ? new Date(contractStartDate) : null;
      if (existingLead.contractStartDate?.getTime() !== newDate?.getTime()) {
        updateData.contractStartDate = newDate;
        changes.push(`changed Contract Start Date`);
      }
    }
    if (contractEndDate !== undefined) {
      const newDate = contractEndDate ? new Date(contractEndDate) : null;
      if (existingLead.contractEndDate?.getTime() !== newDate?.getTime()) {
        updateData.contractEndDate = newDate;
        changes.push(`changed Contract End Date`);
      }
    }
    if (autoRenewal !== undefined && existingLead.autoRenewal !== autoRenewal) {
      updateData.autoRenewal = Boolean(autoRenewal);
      changes.push(`updated Auto Renewal`);
    }
    if (renewalStatus !== undefined && existingLead.renewalStatus !== renewalStatus) {
      updateData.renewalStatus = renewalStatus;
      changes.push(`updated Renewal Status`);
    }
    if (contractType !== undefined && existingLead.contractType !== contractType) { updateData.contractType = contractType; changes.push(`changed Contract Type to ${contractType}`); }
    if (healthStatus !== undefined && existingLead.healthStatus !== healthStatus) { updateData.healthStatus = healthStatus; changes.push(`changed Health Status to ${healthStatus}`); }
    if (lostReason !== undefined && existingLead.lostReason !== lostReason) { updateData.lostReason = lostReason; changes.push(`changed Lost Reason`); }
    if (priority !== undefined && existingLead.priority !== priority) { updateData.priority = priority; changes.push(`changed Priority to ${priority}`); }
    // Once the lead has converted, the Client is the single master for identity and billing
    // data. Freezing the lead's copies here is what stops the two records from drifting into
    // disagreeing about a company's address or GST number.
    const { updatedLead, finalClientId, newClientId } = await prisma.$transaction(async (tx) => {
      let currentClientId: string | null = existingLead.clientId;
      let outNewClientId: string | null = null;

      const clientUpdateData: any = {};

      for (const f of EDITABLE_TEXT_FIELDS) {
        if (req.body[f] !== undefined && (existingLead as any)[f] !== req.body[f]) {
          updateData[f] = req.body[f] || null;
          changes.push(`updated ${f}`);

          if (currentClientId) {
            const val = req.body[f] || null;
            if (f === 'companyName') {
              clientUpdateData.company = val;
              if (val) clientUpdateData.name = val;
            } else if (f === 'contactName') {
              clientUpdateData.contactPerson = val;
              if (!clientUpdateData.name && val) clientUpdateData.name = val;
            } else if (f === 'contactEmail') {
              clientUpdateData.email = val;
            } else if (f === 'contactPhone') {
              clientUpdateData.phone = val;
            } else {
              clientUpdateData[f] = val;
            }
          }
        }
      }

      if (currentClientId && Object.keys(clientUpdateData).length > 0) {
        await tx.client.update({
          where: { id: currentClientId },
          data: clientUpdateData,
        });
      }

      // Only the lead's own stage/renewal fields are set here; the *consequences* of the stage
      // change (history, conversion, client status, revenue) are applied by applyLeadStageEffects
      // after the lead row is written — the exact same path POST /leads/:id/stage uses.
      // (A duplicate inline conversion/status block used to live here from a bad merge; it has
      // been removed so stage side-effects run exactly once, via applyLeadStageEffects below.)
      if (stage !== undefined && existingLead.stage !== stage) {
        updateData.stage = stage;
        if (stage === 'CHURNED') updateData.renewalStatus = 'CHURNED';
      }

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: updateData,
        include: {
          client: true,
          assignedTo: { select: { id: true, name: true, avatar: true } },
          dealFields: true,
        }
      });

      // Apply all stage consequences via the shared service (identical to the drag endpoint).
      if (stage !== undefined && existingLead.stage !== stage) {
        const eff = await applyLeadStageEffects(tx, {
          lead: existingLead,
          orgId,
          userId: req.user!.userId,
          toStage: stage,
          previousStage: existingLead.stage,
          notes: null,
          dealValue: dealValue ?? existingLead.dealValue ?? undefined,
          contractStartDate: req.body.fields?.['Start Date Confirmed'] ?? req.body.fields?.startDate,
          billingFrequency: req.body.fields?.['Billing Frequency'] ?? req.body.fields?.billingFrequency,
          reopen,
        });
        currentClientId = eff.clientId;
        outNewClientId = eff.newClientId;
        if (currentClientId) updated.clientId = currentClientId;
      }

      if (currentClientId && dealValue !== undefined) {
        await tx.client.update({
          where: { id: currentClientId },
          data: { contractValue: dealValue || null }
        });
      }

      if (changes.length > 0) {
        await tx.activity.create({
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

      if (stage !== undefined && existingLead.stage !== stage) {
        // Stage history is created by applyLeadStageEffects; here we only add the human-facing feed entry.
        await tx.activity.create({
          data: {
            type: 'STAGE_CHANGED',
            message: `moved this lead to ${stage.replace(/_/g, ' ')}`,
            entityType: 'LEAD',
            entityId: leadId,
            userId: req.user!.userId,
            leadId: leadId,
            metadata: { from: existingLead.stage, to: stage },
          }
        });
      }

      return { updatedLead: updated, finalClientId: currentClientId, newClientId: outNewClientId };
    }, {
      isolationLevel: 'ReadCommitted' // Keeps transaction short while preventing dirty reads
    });

    // Upsert Deal Fields outside the main complex transaction to keep lock time low, or inside if needed.
    // They don't typically affect business risk if slightly out of sync. But we will do it here.
    const fields = req.body.fields;
    if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) {
      for (const [key, value] of Object.entries(fields)) {
        const strValue = Array.isArray(value) ? value.join(', ') : (value ? String(value) : null);
        await prisma.dealField.upsert({
          where: { leadId_fieldKey: { leadId, fieldKey: key } },
          update: { fieldValue: strValue },
          create: { leadId, fieldKey: key, fieldValue: strValue }
        });
      }
    }

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);
    if (finalClientId) emitToOrganization(io, orgId, 'client:updated', { id: finalClientId });
    if (newClientId) emitToOrganization(io, orgId, 'client:created', { id: newClientId });

    await createAuditLog({
      organizationId: orgId,
      userId: req.user!.userId,
      action: 'LEAD_UPDATE',
      entityType: 'LEAD',
      entityId: leadId,
      details: {
        contactName: updatedLead.contactName,
        companyName: updatedLead.companyName,
        changes: changes
      }
    });

    res.json(updatedLead);
  } catch (error: any) {
    // Same concurrency-race guard as POST /leads/:id/stage: the unique sourceLeadId constraint
    // stopped a parallel request from writing a second subscription/contract. No double revenue
    // was created; return current lead state instead of a 500.
    if (error?.code === 'P2002' && String(error?.meta?.target ?? '').includes('sourceLeadId')) {
      const current = await prisma.lead.findFirst({
        where: { id: req.params.id as string, organizationId: req.user!.organizationId },
        include: { client: true, assignedTo: { select: { id: true, name: true, avatar: true } }, dealFields: true },
      });
      if (current) { res.json(current); return; }
    }
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

// POST /api/crm/leads/:id/prepare-project
crmRouter.post('/leads/:id/prepare-project', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      include: { client: true }
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Starting delivery is one of the two moments an account is born. Conversion copies the
    // lead's identity, billing details and contacts across, and re-points any quotations
    // raised while it was still a lead.
    const { clientId, created } = await prisma.$transaction((tx) =>
      ensureClientForLead(tx, lead, orgId)
    );

    if (created) {
      emitToOrganization(req.app.get('io'), orgId, 'client:created', { id: clientId });
    }

    const ownerId = lead.assignedToId || req.user!.userId;
    const suggestedName = `${lead.companyName || lead.contactName || 'New Deal'} Project`;

    res.status(200).json({
      clientId,
      ownerId,
      suggestedName
    });
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

    // Deleting a lead removes the sales record only. Any Client it converted into is a real
    // account — it may carry contacts, notes, billing details, projects and payments — so it
    // is left alone; Lead.client is SetNull, which unlinks it cleanly.
    await prisma.$transaction(async (tx) => {
      await tx.stageHistory.deleteMany({ where: { leadId } });
      await tx.dealField.deleteMany({ where: { leadId } });
      await tx.activity.deleteMany({ where: { leadId } });
      await tx.lead.delete({ where: { id: leadId } });
    });

    // Emit real-time event
    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'lead:updated', { id: leadId, deleted: true });

    await createAuditLog({
      organizationId: orgId,
      userId: req.user!.userId,
      action: 'LEAD_DELETE',
      entityType: 'LEAD',
      entityId: leadId,
      details: { contactName: existingLead.contactName, companyName: existingLead.companyName }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

const crmClientUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  company: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  contractValue: z.number().min(0).optional().nullable(),
  startDate: z.string().optional().nullable(),
  engagementType: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  gstNumber: z.string().optional().nullable(),
  scope: z.string().optional().nullable(),
  assetLinks: z.string().optional().nullable(),
  accountManagerId: z.string().optional().nullable(),
  status: z.enum(['PROSPECT', 'ACTIVE', 'ONHOLD', 'CHURNED', 'PROJECT_COMPLETED']).optional(),
  jobTitle: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  landlinePhone: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  instagramHandle: z.string().optional().nullable(),
  facebookPage: z.string().optional().nullable(),
  // The edit form sends '' for a never-set dropdown — treat that as null, not a 400.
  source: z.enum(['EXCEL', 'MANUAL', 'API', 'REFERRAL', 'INBOUND', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'OTHER', 'OUTBOUND', 'SOCIAL_MEDIA', 'EVENT', 'COLD_CALL', 'EXISTING_CLIENT']).or(z.literal('')).optional().nullable().transform((v) => (v === '' ? null : v)),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).or(z.literal('')).optional().nullable().transform((v) => (v === '' ? null : v)),
  contractType: z.enum(['RETAINER', 'ONE_TIME']).or(z.literal('')).optional().nullable().transform((v) => (v === '' ? null : v)),
  healthStatus: z.enum(['GREEN', 'AMBER', 'RED']).or(z.literal('')).optional().nullable().transform((v) => (v === '' ? null : v)),
  expectedRevenue: z.number().min(0).optional().nullable(),
  currency: z.string().length(3, 'Must be a 3-letter ISO currency code').optional(),
  dossierJson: z.any().optional().nullable(),
  dossierStatus: z.string().optional().nullable(),
  contacts: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    designation: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    linkedinUrl: z.string().optional().nullable(),
    role: z.enum(['DECISION_MAKER', 'INFLUENCER', 'GATEKEEPER', 'CHAMPION', 'CC_ONLY']).or(z.literal('')).optional().nullable(),
    notes: z.string().optional().nullable(),
  })).optional(),
});

// GET /api/crm/clients/:id — Full rich client data for CRM context (contacts, leads, projects, quotes)
crmRouter.get('/clients/:id', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const clientId = req.params.id as string;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: orgId },
      include: {
        contacts: true,
        accountManager: { select: { id: true, name: true, email: true, avatar: true } },
        [('leads' as any)]: { orderBy: { createdAt: 'desc' } },
        projects: { select: { id: true, name: true, status: true, progress: true } },
        quotes: { select: { id: true, documentNumber: true, status: true, grandTotal: true, createdAt: true } },
        notes: { include: { author: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: 'desc' } },
        activities: { include: { user: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: 'desc' }, take: 50 },
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

// PUT /api/crm/clients/:id — CRM-only edit endpoint (gated: SUPER_ADMIN, ADMIN)
crmRouter.put('/clients/:id', requireModule('CRM'), authorize('SUPER_ADMIN', 'ADMIN'), validate(crmClientUpdateSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const clientId = req.params.id as string;

    const existing = await prisma.client.findFirst({
      where: { id: clientId, organizationId: orgId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    if (existing.name === 'Internal') {
      res.status(403).json({ error: 'The Internal client syncs automatically and cannot be manually edited' });
      return;
    }

    // Re-parse through the schema rather than spreading req.body: `validate()` checks but does
    // NOT reassign the body, so unknown keys (organizationId, id, archivedAt, …) would ride the
    // spread straight into prisma.client.update — a mass-assignment hole. Zod's parse strips
    // everything not declared in crmClientUpdateSchema.
    const { contacts, startDate, ...data } = crmClientUpdateSchema.parse(req.body);

    const newName = data.name ? String(data.name).trim() : existing.name;
    if (newName && newName.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.client.findFirst({
        where: { organizationId: orgId, name: { equals: newName, mode: 'insensitive' }, id: { not: existing.id } },
        select: { id: true },
      });
      if (duplicate) {
        res.status(409).json({ error: `A client named "${newName}" already exists.` });
        return;
      }
    }

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: {
        ...data,
        name: newName,
        startDate: startDate ? new Date(startDate) : (startDate === null ? null : undefined),
        ...(contacts ? {
          contacts: {
            deleteMany: {},
            create: contacts.map((c: any) => ({
              name: c.name,
              designation: c.designation || null,
              email: c.email || null,
              phone: c.phone || null,
              linkedinUrl: c.linkedinUrl || null,
              role: c.role || null,
              notes: c.notes || null,
            })),
          },
        } : {}),
      },
      include: {
        contacts: true,
        accountManager: { select: { id: true, name: true, avatar: true } },
      },
    });

    const io = req.app.get('io');
    emitToOrganization(io, orgId, 'client:updated', updated);

    await createAuditLog({
      organizationId: orgId,
      userId: req.user!.userId,
      action: 'CLIENT_UPDATE',
      entityType: 'CLIENT',
      entityId: updated.id,
      details: { name: updated.name, company: updated.company, via: 'CRM' },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});
