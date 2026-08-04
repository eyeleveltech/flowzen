import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';
import { generateDocNumber, computeQuoteFinancials } from '../utils/quote.js';
import { generateQuotePdf } from '../services/quotePdf.service.js';
import { logActivity, ActivityType } from '../services/activity.service.js';
import { buildSearchFilter } from '../utils/search-utils.js';
import { ensureClientForLead } from '../services/clientConversion.service.js';
import { primaryContactOf } from '../services/leadContact.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { EmailService } from '../services/email.js';
import path from 'path';
import fs from 'fs';

export const quoteRouter = Router();
quoteRouter.use(authenticate);

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  unit: z.string().min(1),
  quantity: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  discountPct: z.number().min(0).max(100).optional(),
  taxPct: z.number().min(0).max(100).optional(),
  taxType: z.string().optional(),
});

// Base shape kept separate from the one-party refinement below, because PATCH needs
// `.partial()` — which only exists on a ZodObject, not on a refined schema.
const quoteBaseSchema = z.object({
  documentType: z.enum(['QUOTATION', 'PROFORMA_INVOICE']),
  documentDate: z.string().optional(),
  expirationDate: z.string().min(1, 'Expiration date is required'),
  // Raised against a Client (won) or a Lead (still being chased — no account exists yet).
  clientId: z.string().optional(),
  leadId: z.string().optional(),
  contactPerson: z.string().min(1, 'Contact person is required'),
  clientEmail: z.string().optional(),
  clientPhone: z.string().optional(),
  billingAddress: z.string().optional(),
  paymentTerms: z.string().min(1, 'Payment terms are required'),
  customerRef: z.string().optional(),
  salesTeam: z.string().optional(),
  onlineSignature: z.boolean().optional(),
  onlinePayment: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  paymentMethod: z.string().optional(),
  clientGst: z.string().optional(),
  projectStartDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  projectNotes: z.string().optional(),
  scope: z.string().optional(),
  termsConditions: z.string().min(1, 'Terms & conditions are required'),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

const quoteSchema = quoteBaseSchema.refine((d) => Boolean(d.clientId) !== Boolean(d.leadId), {
  message: 'A quote must be raised for either a client or a lead, but not both',
  path: ['clientId'],
});

/**
 * Quotes snapshot the billing party at save time, so they only need a common shape rather
 * than a Client row. This normalizes a Lead into that shape, letting a quotation go out
 * before the deal is won — which is what keeps an account from being created prematurely.
 */
const leadAsParty = (lead: any) => {
  // The person on the quotation comes from the lead's primary contact — the same source the
  // account will use once the deal is won, so the quote and the eventual client agree.
  const person = primaryContactOf(lead);
  return {
    name: lead.companyName || person.name || 'Lead',
    company: lead.companyName || null,
    contactPerson: person.name || null,
    email: person.email || null,
    phone: person.phone || null,
    billingAddress: lead.billingAddress || null,
    address: lead.address || null,
    state: lead.state || null,
    gstNumber: lead.gstNumber || null,
  };
};

// Read EyeLevel's company state (for the CGST/SGST vs IGST split) from org settings.
async function getOrgState(orgId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return ((org?.settings as any)?.company?.state as string) || null;
}

/**
 * A field the caller sent as an empty string means "leave this off the document"; only an
 * ABSENT field falls back to the client record. Plain `body.x || client.x` could never express
 * "blank" — clearing GST / email / phone in the form silently refilled it from the client, so
 * those lines were impossible to remove from a quotation.
 */
const explicitOrFallback = (sent: unknown, fallback: unknown): string | null => {
  if (sent !== undefined) return (String(sent ?? '').trim() || null);
  return (fallback as string) || null;
};

function buildDocData(body: z.infer<typeof quoteSchema>, client: any, orgState: string | null, fin: ReturnType<typeof computeQuoteFinancials>) {
  return {
    documentDate: body.documentDate ? new Date(body.documentDate) : new Date(),
    expirationDate: new Date(body.expirationDate),
    clientName: client.company || client.name || 'Client',
    contactPerson: body.contactPerson || client.contactPerson || client.name,
    clientEmail: explicitOrFallback(body.clientEmail, client.email),
    clientPhone: explicitOrFallback(body.clientPhone, client.phone),
    // Same explicit-vs-absent rule as the email/phone/GST lines above. This one was missed: with
    // `||`, an address the user had deliberately emptied fell straight back to the client's,
    // so it could never be removed from a quotation.
    billingAddress: explicitOrFallback(body.billingAddress, client.billingAddress || client.address),
    clientState: client.state || null,
    paymentTerms: body.paymentTerms,
    customerRef: null,
    salesTeam: body.salesTeam || null,
    onlineSignature: body.onlineSignature || false,
    onlinePayment: body.onlinePayment || false,
    tags: body.tags || [],
    paymentMethod: body.paymentMethod || null,
    clientGst: explicitOrFallback(body.clientGst, client.gstNumber),
    projectStartDate: body.projectStartDate ? new Date(body.projectStartDate) : null,
    deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
    projectNotes: body.projectNotes || null,
    scope: body.scope || null,
    termsConditions: body.termsConditions,
    untaxedAmount: fin.untaxedAmount,
    totalDiscount: fin.totalDiscount,
    cgst: fin.cgst,
    sgst: fin.sgst,
    igst: fin.igst,
    totalTax: fin.totalTax,
    grandTotal: fin.grandTotal,
    amountInWords: fin.amountInWords,
  };
}

// POST /api/crm/quotes — create a quotation / proforma invoice
quoteRouter.post('/', validate(quoteSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const body = req.body as z.infer<typeof quoteSchema>;

    let party: any;
    if (body.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: body.leadId, organizationId: orgId },
        include: { contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } },
      });
      if (!lead) {
        res.status(404).json({ error: 'Lead not found.' });
        return;
      }
      party = leadAsParty(lead);
    } else {
      const client = await prisma.client.findFirst({ where: { id: body.clientId, organizationId: orgId, archivedAt: null } });
      if (!client) {
        res.status(404).json({ error: 'Client not found.' });
        return;
      }
      party = client;
    }

    const orgState = await getOrgState(orgId);
    const fin = computeQuoteFinancials(body.lineItems);
    const scope = body.documentType === 'QUOTATION' ? 'QT' : 'PI';
    const documentNumber = await generateDocNumber(orgId, scope);

    const quote = await prisma.quoteDocument.create({
      data: {
        organizationId: orgId,
        documentType: body.documentType,
        documentNumber,
        clientId: body.clientId || null,
        leadId: body.leadId || null,
        // Currency snapshot: inherited from the client at creation time (leads have no direct currency,
        // so fall back to 'INR'). Stored so a quote rendered later still shows the correct symbol even
        // if the client's currency is later changed.
        currency: (party as any).currency ?? 'INR',
        ...buildDocData(body, party, orgState, fin),
        lineItems: {
          create: body.lineItems.map((li, i) => ({
            sortOrder: i + 1,
            description: li.description,
            unit: li.unit,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountPct: li.discountPct || 0,
            taxType: li.taxType || 'IGST_S',
            taxPct: li.taxPct ?? 18,
            amount: fin.lineAmounts[i],
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });

    emitToOrganization(req.app.get('io'), orgId, 'quote:updated', { id: quote.id });
    res.status(201).json(quote);
  } catch (error) {
    next(error);
  }
});

// GET /api/crm/quotes — list with filters
quoteRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { type, status, clientId, search } = req.query;
    const where: any = { organizationId: orgId };
    if (type) where.documentType = type as string;
    if (status) where.status = status as string;
    if (clientId) where.clientId = clientId as string;
    if (search) {
      where.OR = buildSearchFilter(['documentNumber', 'clientName'], search as string).OR;
    }
    const quotes = await prisma.quoteDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { lineItems: true } } },
    });
    res.json({ quotes });
  } catch (error) {
    next(error);
  }
});

// GET /api/crm/quotes/:id — single document
quoteRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const quote = await prisma.quoteDocument.findFirst({
      where: { id: req.params.id as string, organizationId: orgId },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) {
      res.status(404).json({ error: 'Quotation not found' });
      return;
    }
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/crm/quotes/:id — update. Editable in any state except CANCELLED,
// so a SENT quote can be revised and its PDF re-generated.
quoteRouter.patch('/:id', validate(quoteBaseSchema.partial().extend({ lineItems: z.array(lineItemSchema).min(1).optional() })), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = req.params.id as string;
    const existing = await prisma.quoteDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) { res.status(404).json({ error: 'Quotation not found' }); return; }
    if (existing.status === 'CANCELLED') { res.status(400).json({ error: 'Cancelled documents cannot be edited.' }); return; }
    if (existing.status === 'ACCEPTED') { res.status(400).json({ error: 'Accepted documents cannot be edited. Create a new quotation revision instead.' }); return; }

    const body = req.body as any;
    const orgState = await getOrgState(orgId);

    let fin = null as ReturnType<typeof computeQuoteFinancials> | null;
    if (body.lineItems) fin = computeQuoteFinancials(body.lineItems);

    const data: any = {};
    const fields = ['documentType', 'paymentTerms', 'customerRef', 'salesTeam', 'onlineSignature', 'onlinePayment', 'tags', 'paymentMethod', 'clientGst', 'projectNotes', 'scope', 'termsConditions', 'contactPerson', 'clientEmail', 'clientPhone', 'billingAddress'];
    for (const f of fields) if (body[f] !== undefined) data[f] = body[f];
    for (const d of ['documentDate', 'expirationDate', 'projectStartDate', 'deliveryDate']) if (body[d] !== undefined) data[d] = body[d] ? new Date(body[d]) : null;

    if (fin && body.lineItems) {
      Object.assign(data, {
        untaxedAmount: fin.untaxedAmount, totalDiscount: fin.totalDiscount, cgst: fin.cgst, sgst: fin.sgst,
        igst: fin.igst, totalTax: fin.totalTax, grandTotal: fin.grandTotal, amountInWords: fin.amountInWords,
      });
      // Replace line items
      await prisma.quoteLineItem.deleteMany({ where: { quoteId: id } });
      data.lineItems = {
        create: body.lineItems.map((li: any, i: number) => ({
          sortOrder: i + 1, description: li.description, unit: li.unit, quantity: li.quantity,
          unitPrice: li.unitPrice, discountPct: li.discountPct || 0, taxType: li.taxType || 'IGST_S', taxPct: li.taxPct ?? 18, amount: fin!.lineAmounts[i],
        })),
      };
    }

    const updated = await prisma.quoteDocument.update({
      where: { id }, data,
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    emitToOrganization(req.app.get('io'), orgId, 'quote:updated', { id });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/crm/quotes/:id/status
quoteRouter.patch('/:id/status', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = req.params.id as string;
    const status = req.body?.status as string;
    if (!['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const existing = await prisma.quoteDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) { res.status(404).json({ error: 'Quotation not found' }); return; }

    if (existing.status === 'ACCEPTED' && status !== 'ACCEPTED') {
      res.status(400).json({ error: 'Accepted quotations cannot have their status reversed.' });
      return;
    }
    if (existing.status === 'CANCELLED' && status !== 'CANCELLED') {
      res.status(400).json({ error: 'Cancelled quotations cannot have their status changed.' });
      return;
    }

    // Non-accept transitions are a simple guarded update.
    if (!(status === 'ACCEPTED' && existing.status !== 'ACCEPTED')) {
      const updated = await prisma.quoteDocument.update({ where: { id }, data: { status: status as any } });
      emitToOrganization(req.app.get('io'), orgId, 'quote:updated', { id });
      res.json(updated);
      return;
    }

    // Accepting is the sensitive path. The status flip doubles as a lock: an atomic
    // updateMany that only matches a not-yet-ACCEPTED row means exactly one concurrent
    // request wins and creates the Contract — the rest see count 0 and do nothing. This
    // closes the read-then-write race that let two accepts each spawn a contract (FZ-031).
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.quoteDocument.updateMany({
        where: { id, organizationId: orgId, status: { not: 'ACCEPTED' } },
        data: { status: 'ACCEPTED' },
      });
      if (claim.count === 0) return { createdClientId: null as string | null };

      let contractClientId = existing.clientId;
      let createdClientId: string | null = null;
      if (!contractClientId && existing.leadId) {
        const lead = await tx.lead.findFirst({ where: { id: existing.leadId, organizationId: orgId } });
        if (lead) {
          const { clientId, created } = await ensureClientForLead(tx, lead, orgId);
          contractClientId = clientId;
          if (created) createdClientId = clientId;
        }
      }
      if (!contractClientId) {
        // Nothing to attach the contract to — abort the accept entirely (rolls back the flip).
        throw new AppError('This quotation is not linked to a client or a lead, so it cannot be accepted.', 409);
      }

      // If the client already runs on an active retainer Subscription, that Subscription IS the
      // recurring revenue — creating a Contract too would double-count it (Subscription in MRR +
      // Contract in reports). So when a retainer exists we just record the acceptance on the
      // subscription; only a non-retainer quote materializes a one-time Contract (FZ-032/FZ-059).
      // Every read/write uses `tx` to keep the accept path atomic (FZ-031).
      const activeSub = await tx.subscription.findFirst({
        where: { organizationId: orgId, clientId: contractClientId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (activeSub) {
        await tx.subscription.update({
          where: { id: activeSub.id },
          data: { notes: `Quote ${existing.documentNumber} accepted (${existing.currency || 'INR'} ${existing.grandTotal})` },
        });
      } else {
        const existingContract = await tx.contract.findFirst({
          where: { organizationId: orgId, clientId: contractClientId, title: 'Quote ' + existing.documentNumber },
        });
        if (!existingContract) {
          await tx.contract.create({
            data: {
              organizationId: orgId,
              clientId: contractClientId,
              title: 'Quote ' + existing.documentNumber,
              value: existing.grandTotal,
              currency: existing.currency || 'INR',
              billingFrequency: 'ONE_TIME',
              startDate: new Date(),
              status: 'ACTIVE',
              notes: 'Auto-created from Quote ' + existing.documentNumber,
            },
          });
        }
      }
      return { createdClientId };
    });

    if (result.createdClientId) emitToOrganization(req.app.get('io'), orgId, 'client:created', { id: result.createdClientId });
    emitToOrganization(req.app.get('io'), orgId, 'quote:updated', { id });
    const updated = await prisma.quoteDocument.findUnique({ where: { id } });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// POST /api/crm/quotes/:id/generate-pdf
quoteRouter.post('/:id/generate-pdf', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = req.params.id as string;
    const quote = await prisma.quoteDocument.findFirst({
      where: { id, organizationId: orgId },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        client: { select: { address: true, city: true, state: true, billingAddress: true } },
      },
    });
    if (!quote) { res.status(404).json({ error: 'Quotation not found' }); return; }
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logo: true, address: true, phone: true, website: true, settings: true } });

    const pdfUrl = await generateQuotePdf(quote, org);
    await prisma.quoteDocument.update({ where: { id }, data: { pdfUrl, status: 'SENT' } });

    // Log to the originating lead's timeline — either the lead the quote was raised against
    // directly (pre-conversion), or the lead this client came from (Module E).
    const lead = quote.leadId
      ? await prisma.lead.findFirst({ where: { id: quote.leadId, organizationId: orgId }, select: { id: true } })
      : quote.clientId
        ? await prisma.lead.findFirst({ where: { clientId: quote.clientId, organizationId: orgId }, select: { id: true } })
        : null;
    if (lead) {
      await logActivity({
        leadId: lead.id, type: ActivityType.QUOTE_GENERATED,
        message: `generated ${quote.documentType === 'QUOTATION' ? 'a quotation' : 'a proforma invoice'} ${quote.documentNumber}`,
        userId: req.user!.userId, metadata: { quoteId: id, documentNumber: quote.documentNumber, grandTotal: String(quote.grandTotal) },
        io: req.app.get('io'), orgId,
      });
    }

    res.json({ pdfUrl });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/quotes/:id/send — email the document to the client.
 *
 * This is what "SENT" is supposed to mean. Before it existed, marking a quote SENT flipped a
 * status field and nothing left the building: the PDF had to be downloaded and attached to Gmail
 * by hand on every deal, so the status recorded an intention rather than an event.
 *
 * Generates the PDF first if one was never made, so the caller cannot email a document that
 * doesn't exist yet. The status only moves to SENT if the mail actually went — a failed send
 * leaves it exactly as it was, because a quote marked SENT that never arrived is worse than one
 * still marked DRAFT.
 */
quoteRouter.post('/:id/send', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = req.params.id as string;
    const quote = await prisma.quoteDocument.findFirst({
      where: { id, organizationId: orgId },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        client: { select: { address: true, city: true, state: true, billingAddress: true } },
      },
    });
    if (!quote) { res.status(404).json({ error: 'Quotation not found' }); return; }
    if (quote.status === 'CANCELLED') { res.status(400).json({ error: 'Cancelled documents cannot be sent.' }); return; }

    // An explicit recipient wins, so a user can send to a different person without editing the
    // document; otherwise the address snapshotted on the quote is used.
    const to = String(req.body?.to || quote.clientEmail || '').trim();
    if (!to) {
      res.status(400).json({ error: 'No email address on this document. Add one to the quotation, or supply a recipient.' });
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      res.status(400).json({ error: 'That recipient address is not valid.' });
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, logo: true, address: true, phone: true, website: true, settings: true },
    });

    // Regenerate whenever the file is missing OR the document has been edited since it was made,
    // so nobody can email a stale PDF that disagrees with what the system now shows.
    let pdfUrl = quote.pdfUrl;
    let abs = pdfUrl ? path.resolve(process.cwd(), pdfUrl.replace(/^\/+/, '')) : null;
    if (!pdfUrl || !abs || !fs.existsSync(abs)) {
      pdfUrl = await generateQuotePdf(quote, org);
      abs = path.resolve(process.cwd(), pdfUrl.replace(/^\/+/, ''));
      await prisma.quoteDocument.update({ where: { id }, data: { pdfUrl } });
    }
    if (!abs || !fs.existsSync(abs)) {
      res.status(500).json({ error: 'The document PDF could not be prepared.' });
      return;
    }

    const sender = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true } });

    const ok = await EmailService.sendQuoteEmail({
      to,
      documentNumber: quote.documentNumber,
      documentType: quote.documentType,
      clientName: quote.clientName,
      contactPerson: quote.contactPerson,
      orgName: org?.name || 'Flowzen',
      grandTotal: `${quote.currency || 'INR'} ${Number(quote.grandTotal).toLocaleString('en-IN')}`,
      expirationDate: quote.expirationDate,
      pdfPath: abs,
      pdfFilename: `${quote.documentNumber}.pdf`,
      message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 2000) : null,
      replyTo: sender?.email || null,
    });

    if (!ok) {
      // Deliberately NOT marking it sent. Reporting success for mail that never left is the
      // failure mode this whole endpoint exists to remove.
      res.status(502).json({ error: 'The email could not be sent. Check the mail settings and try again.' });
      return;
    }

    const updated = await prisma.quoteDocument.update({
      where: { id },
      data: { status: quote.status === 'ACCEPTED' ? quote.status : 'SENT' },
    });

    const lead = quote.leadId
      ? await prisma.lead.findFirst({ where: { id: quote.leadId, organizationId: orgId }, select: { id: true } })
      : quote.clientId
        ? await prisma.lead.findFirst({ where: { clientId: quote.clientId, organizationId: orgId }, select: { id: true } })
        : null;
    if (lead) {
      await logActivity({
        leadId: lead.id, type: ActivityType.QUOTE_GENERATED,
        message: `emailed ${quote.documentType === 'QUOTATION' ? 'quotation' : 'proforma invoice'} ${quote.documentNumber} to ${to}`,
        userId: req.user!.userId, metadata: { quoteId: id, documentNumber: quote.documentNumber, to },
        io: req.app.get('io'), orgId,
      });
    }

    emitToOrganization(req.app.get('io'), orgId, 'quote:updated', { id });
    res.json({ sent: true, to, status: updated.status, pdfUrl });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/crm/quotes/:id
quoteRouter.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = req.params.id as string;
    
    const existing = await prisma.quoteDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      res.status(404).json({ error: 'Quotation not found' });
      return;
    }
    
    // Optional: Only allow deleting DRAFT or CANCELLED quotes?
    // Let's just allow deletion.
    await prisma.quoteDocument.delete({ where: { id } });
    emitToOrganization(req.app.get('io'), orgId, 'quote:deleted', { id });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default quoteRouter;
