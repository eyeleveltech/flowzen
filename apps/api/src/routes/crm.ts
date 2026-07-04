import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';
import { whereIn } from '../utils/query.js';
import { generateLeadId, normalizePhone } from '../utils/leadId.js';
import { runIntelligence } from '../services/intelligence.service.js';
import { logActivity, ActivityType, ACTIVITY_CATEGORIES } from '../services/activity.service.js';

export const crmRouter = Router();
crmRouter.use(authenticate);

// Lead Entry Gateway: name, email and phone are required.
const leadSchema = z.object({
  clientId: z.string().optional(),
  contactName: z.string().min(2, 'Full name is required (min 2 characters)'),
  companyName: z.string().optional(),
  email: z.string().email('A valid email is required'),
  phone: z.string().refine((v) => v.replace(/\D/g, '').length >= 10, { message: 'Phone number must be at least 10 digits' }),
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
  dealValue: z.number().optional(),
  expectedRevenue: z.number().optional(),
  expectedCloseDate: z.string().optional(),
  followUpDate: z.string().optional(),
  notes: z.string().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
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
             : [{ createdAt: 'desc' }],
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
      client = await prisma.client.findUnique({ where: { id: clientId, organizationId: orgId }, select: { id: true } });
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }
    }

    const newLeadId = await generateLeadId(orgId);

    // Create the lead with its own contact identity (no client yet).
    const lead = await prisma.lead.create({
      data: {
        leadId: newLeadId,
        clientId: client ? client.id : null,
        organizationId: orgId,
        source: source || 'MANUAL',
        stage: 'NEW_LEAD',
        assignedToId: assignedToId || null,
        dealValue: dealValue || null,
        expectedRevenue: expectedRevenue || null,
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

    res.status(201).json(lead);
  } catch (error) {
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
      'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED', 'CHURNED'
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
      // Lead Entry Gateway: name, email and phone are required on every row.
      const name = (data.contactName || '').toString().trim();
      const email = (data.email || '').toString().trim();
      const digits = normalizePhone(data.phone);

      if (name.length < 2) { rejected.push({ ...data, rejection_reason: 'Full name is required (min 2 characters).' }); continue; }
      if (!emailRe.test(email)) { rejected.push({ ...data, rejection_reason: 'A valid email is required.' }); continue; }
      if (digits.length < 10) { rejected.push({ ...data, rejection_reason: 'Phone number must be at least 10 digits.' }); continue; }
      if (seenPhones.has(digits)) { rejected.push({ ...data, rejection_reason: 'Duplicate phone number (already exists).' }); continue; }
      seenPhones.add(digits);

      // No client is created at import — contact identity lives on the lead until OUTREACH.
      const validStage = validStages.includes(data.stage) ? data.stage : 'NEW_LEAD';
      const newLeadId = await generateLeadId(orgId);

      const lead = await prisma.lead.create({
        data: {
          leadId: newLeadId,
          organizationId: orgId,
          source: 'EXCEL', // bulk upload
          stage: validStage,
          assignedToId: data.assignedToId || null,
          dealValue: data.dealValue ? parseFloat(data.dealValue) : null,
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
    console.error('[Bulk Import Error (Leads)]:', error);
    res.status(400).json({
      error: 'Failed to process bulk import. Please check your file format and try again.'
    });
  }
});

// Stages at which the team has decided to pursue the lead — a PROSPECT client is
// created on entering any of these (normally OUTREACH; later ones cover forward-skips).
const PURSUED_STAGES = ['OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED'];

const stageUpdateSchema = z.object({
  stage: z.enum(['NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED', 'CHURNED']),
  notes: z.string().optional(),
  dealValue: z.number().optional(),
  expectedCloseDate: z.string().optional(),
  contractType: z.enum(['RETAINER', 'ONE_TIME']).optional(),
  contractStartDate: z.string().optional(),
  contractEndDate: z.string().optional(),
  lostReason: z.enum(['BUDGET', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'UNRESPONSIVE', 'SCOPE_MISMATCH', 'INTERNAL_CHANGE', 'OTHER']).optional(),
  fields: z.record(z.any()).optional(),
});

// POST /api/crm/leads/:id/stage
crmRouter.post('/leads/:id/stage', authorize('SUPER_ADMIN', 'ADMIN'), validate(stageUpdateSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const leadId = req.params.id as string;
    const { stage, notes, dealValue, expectedCloseDate, contractType, contractStartDate, contractEndDate, lostReason, fields } = req.body;

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
    if (contractStartDate !== undefined) updateData.contractStartDate = new Date(contractStartDate);
    if (contractEndDate !== undefined) {
      updateData.contractEndDate = new Date(contractEndDate);
      // Only seed UPCOMING on first set — never clobber an admin's AT_RISK / IN_DISCUSSION.
      if (!existingLead.renewalStatus) updateData.renewalStatus = 'UPCOMING';
    }
    if (stage === 'CHURNED') updateData.renewalStatus = 'CHURNED'; // keep renewal state coherent with churn
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

    // Client lifecycle. A PROSPECT client is created when the team decides to pursue
    // the lead — at OUTREACH (or any later pursued stage on a forward-skip) — from the
    // lead's own contact identity. Its status then tracks the pipeline.
    let clientId = existingLead.clientId;

    if (PURSUED_STAGES.includes(stage) && !clientId) {
      const newClient = await prisma.client.create({
        data: {
          name: existingLead.companyName || existingLead.contactName || 'Unknown',
          company: existingLead.companyName || null,
          email: existingLead.contactEmail || null,
          phone: existingLead.contactPhone || null,
          status: 'PROSPECT',
          organizationId: orgId,
          ...(existingLead.contactName ? {
            contacts: { create: { name: existingLead.contactName, designation: existingLead.jobTitle || null, email: existingLead.contactEmail || null, phone: existingLead.contactPhone || null } }
          } : {})
        }
      });
      clientId = newClient.id;
      await prisma.lead.update({ where: { id: leadId }, data: { clientId } });
    } else if (stage === 'NEW_LEAD' && clientId && existingLead.client?.status === 'PROSPECT') {
      await prisma.lead.update({ where: { id: leadId }, data: { clientId: null } });
      try {
        await prisma.client.delete({ where: { id: clientId } });
      } catch (err) {
        console.warn(`Could not delete client ${clientId} during backward pipeline transition. It may have dependent records.`, err);
      }
      clientId = null;
    }

    if (clientId) {
      let newStatus: 'ACTIVE' | 'PROJECT_COMPLETED' | 'CHURNED' | null = null;
      if (['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(stage)) newStatus = 'ACTIVE';
      else if (stage === 'PROJECT_COMPLETED') newStatus = 'PROJECT_COMPLETED';
      else if (stage === 'CHURNED') newStatus = 'CHURNED';
      if (newStatus) {
        await prisma.client.update({ where: { id: clientId }, data: { status: newStatus } });
      }
    }

    // Log every stage transition to the lead timeline (Module E).
    const io = req.app.get('io');
    const reasonLabel = lostReason ? String(lostReason).replace(/_/g, ' ') : null;
    const stageMsg = stage === 'CONTRACT' ? 'signed the contract 🎉'
      : stage === 'CHURNED' ? 'marked this deal as Churned'
      : `moved this lead to ${stage.replace(/_/g, ' ')}`;
    await logActivity({
      leadId, type: ActivityType.STAGE_CHANGED, message: stageMsg, userId: req.user!.userId,
      body: [stage === 'CHURNED' && reasonLabel ? `Reason: ${reasonLabel}` : null, notes || null].filter(Boolean).join(' — ') || null,
      metadata: { from: previousStage, to: stage },
      io, orgId: orgId,
    });

    // Emit real-time events
    emitToOrganization(io, orgId, 'lead:updated', updatedLead);
    if (clientId) emitToOrganization(io, orgId, 'client:updated', { id: clientId });

    res.json(updatedLead);
  } catch (error) {
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

    // Ensure a client record exists (create one from the lead's identity if needed), then park it.
    let clientId = existingLead.clientId;
    if (!clientId) {
      const newClient = await prisma.client.create({
        data: {
          name: existingLead.companyName || existingLead.contactName || 'Unknown',
          company: existingLead.companyName || null,
          email: existingLead.contactEmail || null,
          phone: existingLead.contactPhone || null,
          status: 'ONHOLD',
          organizationId: orgId,
          ...(existingLead.contactName ? {
            contacts: { create: { name: existingLead.contactName, designation: existingLead.jobTitle || null, email: existingLead.contactEmail || null, phone: existingLead.contactPhone || null } }
          } : {})
        },
      });
      clientId = newClient.id;
    } else {
      await prisma.client.update({ where: { id: clientId }, data: { status: 'ONHOLD' } });
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        clientId,
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
    emitToOrganization(io, orgId, 'client:updated', { id: clientId });

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

    if (existingLead.clientId) {
      await prisma.client.update({ where: { id: existingLead.clientId }, data: { status: 'PROSPECT' } });
    }

    const updatedLead = await prisma.lead.findUnique({
      where: { id: leadId },
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
    const { source, assignedToId, dealValue, expectedRevenue, expectedCloseDate, followUpDate, contractType, healthStatus, lostReason, priority, stage } = req.body;
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
    for (const f of EDITABLE_TEXT_FIELDS) {
      if (req.body[f] !== undefined && (existingLead as any)[f] !== req.body[f]) {
        updateData[f] = req.body[f] || null;
        changes.push(`updated ${f}`);
      }
    }
    if (stage !== undefined && existingLead.stage !== stage) {
      updateData.stage = stage;
      if (stage === 'CHURNED') updateData.renewalStatus = 'CHURNED'; // keep renewal state coherent with churn
      // Stage gets its own StageHistory + STAGE_CHANGED activity below (not folded into LEAD_UPDATED).
      // Client lifecycle (mirrors the /stage endpoint): create at OUTREACH, then track status.
      let clientId = existingLead.clientId;
      if (PURSUED_STAGES.includes(stage) && !clientId) {
        const newClient = await prisma.client.create({
          data: {
            name: existingLead.companyName || existingLead.contactName || 'Unknown',
            company: existingLead.companyName || null,
            email: existingLead.contactEmail || null,
            phone: existingLead.contactPhone || null,
            status: 'PROSPECT',
            organizationId: orgId,
            ...(existingLead.contactName ? {
              contacts: { create: { name: existingLead.contactName, designation: existingLead.jobTitle || null, email: existingLead.contactEmail || null, phone: existingLead.contactPhone || null } }
            } : {})
          }
        });
        clientId = newClient.id;
        updateData.clientId = clientId;
      } else if (stage === 'NEW_LEAD' && clientId && existingLead.client?.status === 'PROSPECT') {
        await prisma.lead.update({ where: { id: leadId }, data: { clientId: null } });
        await prisma.client.delete({ where: { id: clientId } });
        clientId = null;
        updateData.clientId = null;
      }
      if (clientId) {
        let newStatus: 'ACTIVE' | 'PROJECT_COMPLETED' | 'CHURNED' | null = null;
        if (['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(stage)) newStatus = 'ACTIVE';
        else if (stage === 'PROJECT_COMPLETED') newStatus = 'PROJECT_COMPLETED';
        else if (stage === 'CHURNED') newStatus = 'CHURNED';
        if (newStatus) {
          await prisma.client.update({ where: { id: clientId }, data: { status: newStatus } });
          const io = req.app.get('io');
          emitToOrganization(io, orgId, 'client:updated', { id: clientId });
        }
      }
    }

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
      changes.push('updated pipeline details');
    }

    if (Object.keys(updateData).length === 0 && (!fields || Object.keys(fields).length === 0)) {
      res.json(existingLead);
      return;
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      include: {
        client: true,
        assignedTo: { select: { id: true, name: true, avatar: true } },
        dealFields: true,
      }
    });

    // Log Activity for all non-stage changes combined
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

    // A stage change here must record StageHistory + a STAGE_CHANGED activity, same as the
    // dedicated /stage endpoint — reactivation + lost-deal analytics depend on StageHistory.
    if (stage !== undefined && existingLead.stage !== stage) {
      await prisma.stageHistory.create({ data: { leadId, fromStage: existingLead.stage, toStage: stage, notes: null, changedById: req.user!.userId } });
      await logActivity({ leadId, type: ActivityType.STAGE_CHANGED, message: `moved this lead to ${stage.replace(/_/g, ' ')}`, userId: req.user!.userId, metadata: { from: existingLead.stage, to: stage }, io: req.app.get('io'), orgId });
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

// POST /api/crm/leads/:id/prepare-project
crmRouter.post('/leads/:id/prepare-project', authorize('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'), async (req: AuthRequest, res: Response, next) => {
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

    let clientId = lead.clientId;

    if (!clientId) {
      // Create a PROSPECT client first if it doesn't exist
      const newClient = await prisma.client.create({
        data: {
          name: lead.companyName || lead.contactName || 'Unknown',
          company: lead.companyName || null,
          email: lead.contactEmail || null,
          phone: lead.contactPhone || null,
          status: 'PROSPECT',
          organizationId: orgId,
          ...(lead.contactName ? {
            contacts: { create: { name: lead.contactName, designation: lead.jobTitle || null, email: lead.contactEmail || null, phone: lead.contactPhone || null } }
          } : {})
        }
      });
      clientId = newClient.id;
      await prisma.lead.update({ where: { id: leadId }, data: { clientId } });
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
