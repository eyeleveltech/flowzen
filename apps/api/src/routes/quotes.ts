import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToOrganization } from '../sse.js';
import { generateDocNumber, computeQuoteFinancials } from '../utils/quote.js';
import { generateQuotePdf } from '../services/quotePdf.service.js';
import { logActivity, ActivityType } from '../services/activity.service.js';

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

const quoteSchema = z.object({
  documentType: z.enum(['QUOTATION', 'PROFORMA_INVOICE']),
  documentDate: z.string().optional(),
  expirationDate: z.string().min(1, 'Expiration date is required'),
  clientId: z.string().min(1, 'Client is required'),
  contactPerson: z.string().min(1, 'Contact person is required'),
  clientEmail: z.string().optional(),
  clientPhone: z.string().optional(),
  billingAddress: z.string().optional(),
  paymentTerms: z.string().min(1, 'Payment terms are required'),
  customerRef: z.string().optional(),
  salespersonId: z.string().optional(),
  salesTeam: z.string().optional(),
  onlineSignature: z.boolean().optional(),
  onlinePayment: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  paymentMethod: z.string().optional(),
  clientGst: z.string().optional(),
  projectStartDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  projectNotes: z.string().optional(),
  termsConditions: z.string().min(1, 'Terms & conditions are required'),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

// Read EyeLevel's company state (for the CGST/SGST vs IGST split) from org settings.
async function getOrgState(orgId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return ((org?.settings as any)?.company?.state as string) || null;
}

function buildDocData(body: z.infer<typeof quoteSchema>, client: any, orgState: string | null, fin: ReturnType<typeof computeQuoteFinancials>) {
  return {
    documentDate: body.documentDate ? new Date(body.documentDate) : new Date(),
    expirationDate: new Date(body.expirationDate),
    clientName: client.company || client.name || 'Client',
    contactPerson: body.contactPerson || client.contactPerson || client.name,
    clientEmail: body.clientEmail || client.email || null,
    clientPhone: body.clientPhone || client.phone || null,
    billingAddress: body.billingAddress || client.billingAddress || client.address || null,
    clientState: client.state || null,
    paymentTerms: body.paymentTerms,
    customerRef: null,
    salespersonId: body.salespersonId || null,
    salesTeam: body.salesTeam || null,
    onlineSignature: body.onlineSignature || false,
    onlinePayment: body.onlinePayment || false,
    tags: body.tags || [],
    paymentMethod: body.paymentMethod || null,
    clientGst: body.clientGst || client.gstNumber || null,
    projectStartDate: body.projectStartDate ? new Date(body.projectStartDate) : null,
    deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
    projectNotes: body.projectNotes || null,
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

    const client = await prisma.client.findFirst({ where: { id: body.clientId, organizationId: orgId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found.' });
      return;
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
        clientId: body.clientId,
        ...buildDocData(body, client, orgState, fin),
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
      include: { lineItems: { orderBy: { sortOrder: 'asc' } }, salesperson: { select: { id: true, name: true } } },
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
      where.OR = [
        { documentNumber: { contains: search as string, mode: 'insensitive' } },
        { clientName: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    const quotes = await prisma.quoteDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { salesperson: { select: { id: true, name: true } }, _count: { select: { lineItems: true } } },
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
      include: { lineItems: { orderBy: { sortOrder: 'asc' } }, salesperson: { select: { id: true, name: true } } },
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

// PATCH /api/crm/quotes/:id — update (only while DRAFT)
quoteRouter.patch('/:id', validate(quoteSchema.partial().extend({ lineItems: z.array(lineItemSchema).min(1).optional() })), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = req.params.id as string;
    const existing = await prisma.quoteDocument.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) { res.status(404).json({ error: 'Quotation not found' }); return; }
    if (existing.status !== 'DRAFT') { res.status(400).json({ error: 'Only draft documents can be edited.' }); return; }

    const body = req.body as any;
    const client = await prisma.client.findFirst({ where: { id: existing.clientId, organizationId: orgId } });
    const orgState = await getOrgState(orgId);

    let fin = null as ReturnType<typeof computeQuoteFinancials> | null;
    if (body.lineItems) fin = computeQuoteFinancials(body.lineItems);

    const data: any = {};
    const fields = ['documentType', 'paymentTerms', 'customerRef', 'salespersonId', 'salesTeam', 'onlineSignature', 'onlinePayment', 'tags', 'paymentMethod', 'clientGst', 'projectNotes', 'termsConditions', 'contactPerson', 'clientEmail', 'clientPhone', 'billingAddress'];
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
      include: { lineItems: { orderBy: { sortOrder: 'asc' } }, salesperson: { select: { id: true, name: true } } },
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
    const updated = await prisma.quoteDocument.update({ where: { id }, data: { status: status as any } });
    emitToOrganization(req.app.get('io'), orgId, 'quote:updated', { id });
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
        salesperson: { select: { id: true, name: true } },
        client: { select: { address: true, city: true, state: true, billingAddress: true } },
      },
    });
    if (!quote) { res.status(404).json({ error: 'Quotation not found' }); return; }
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logo: true, address: true, phone: true, website: true, settings: true } });

    const pdfUrl = await generateQuotePdf(quote, org);
    await prisma.quoteDocument.update({ where: { id }, data: { pdfUrl } });

    // Log to the originating lead's timeline, if this client came from a lead (Module E).
    const lead = await prisma.lead.findFirst({ where: { clientId: quote.clientId, organizationId: orgId }, select: { id: true } });
    if (lead) {
      await logActivity({
        leadId: lead.id, type: ActivityType.QUOTE_GENERATED,
        message: `generated ${quote.documentType === 'QUOTATION' ? 'a quotation' : 'a proforma invoice'} ${quote.documentNumber}`,
        userId: req.user!.userId, metadata: { quoteId: id, documentNumber: quote.documentNumber, grandTotal: String(quote.grandTotal) },
        io: req.app.get('io'), orgId,
      });
    }

    res.json({ pdfUrl });
  } catch (error: any) {
    res.status(500).json({ error: `PDF generation failed: ${error?.message || 'unknown error'}` });
  }
});

export default quoteRouter;
