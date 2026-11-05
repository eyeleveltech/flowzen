import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { CostTreatment, CostType, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireManagement, type AuthRequest } from '../middleware/auth.js';
import { MAX_FILE_BYTES, UploadRefused, softDeleteFile, storeFile } from '../services/files.js';
import { readInvoice } from '../services/invoiceReader.js';
import { amountText, inrOf, loadPlatforms, subscriptionsView } from '../services/subscriptions.js';
import { asStoredDay, dayKey } from '../utils/moneyDates.js';
import { sendCsv } from '../utils/csvResponse.js';

/**
 * Money → Subscriptions (Subscriptions plan): upload a platform invoice,
 * Flowzen reads it, a person checks it, and it is saved with a linked
 * Software cost so it counts in profit and cash.
 *
 * Management only, every route — "only manage the subscription invoices, so
 * we know what we spend on which platform". No seats, no logins, no cards.
 */

export const subscriptionsRouter = Router();
subscriptionsRouter.use(authenticate, requireManagement('Subscriptions are Management’s: what the studio pays for, platform by platform.'));

/** The upload lands in memory, then the file store decides (services/files.ts). */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES + 1, files: 1 } });

/** Cost categories a subscription already sits under, from the Costs form. */
const SOFTWARE_CATEGORIES = ['Software', 'Hosting and domain', 'Stock and licences'];
/** What a saved invoice's cost is filed under. */
const COST_CATEGORY = 'Software';

const nameKeyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

const log = (req: AuthRequest, entityType: string, entityId: string, verb: string, payload: Prisma.InputJsonValue) =>
  prisma.activity.create({
    data: { organizationId: req.user!.organizationId, entityType, entityId, actorId: req.user!.userId, verb, payload },
  });

/** "3 Oct 2026", for a refusal that names a date. */
const dateText = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * A recurring Software cost already entered for this vendor by hand — the
 * one that would count twice once invoices are saved (decision 6).
 */
async function recurringSoftwareCost(organizationId: string, vendor: string) {
  const key = vendor.trim();
  if (!key) return null;
  const row = await prisma.cost.findFirst({
    where: {
      organizationId,
      recurring: true,
      deletedAt: null,
      OR: SOFTWARE_CATEGORIES.map((c) => ({ category: { equals: c, mode: 'insensitive' as const } })),
      vendor: { contains: key, mode: 'insensitive' },
    },
    select: { id: true, vendor: true, amount: true, category: true },
  });
  return row ? { id: row.id, vendor: row.vendor, amount: Number(row.amount), category: row.category } : null;
}

/** The platform an invoice belongs to, by the vendor the reader found — exact name first, then one that contains it. */
function matchPlatform<T extends { name: string }>(platforms: T[], vendor: string | null | undefined): T | null {
  const key = nameKeyOf(vendor ?? '');
  if (!key) return null;
  return (
    platforms.find((p) => nameKeyOf(p.name) === key) ??
    platforms.find((p) => nameKeyOf(p.name).includes(key) || key.includes(nameKeyOf(p.name))) ??
    null
  );
}

/** The GST rate a cost records, when the invoice is a rupee one with GST on it. */
function gstPercentOf(d: { currency: string; subtotal?: number | null; taxAmount?: number | null; taxType?: string | null }): number | null {
  if (d.currency !== 'INR' || !d.subtotal || d.taxAmount === null || d.taxAmount === undefined) return null;
  if (!/gst/i.test(d.taxType ?? '')) return null;
  return Math.round((d.taxAmount / d.subtotal) * 10000) / 100;
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/subscriptions/invoices/read — keep the file, read it, and answer
 * with everything the review card shows. Nothing is saved as an invoice yet.
 */
subscriptionsRouter.post('/invoices/read', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const f = req.file;
    if (!f) {
      res.status(400).json({ success: false, error: 'Drop a PDF, PNG or JPG invoice.' });
      return;
    }
    let stored;
    try {
      stored = await storeFile({ organizationId: orgId, userId: req.user!.userId, kind: 'SUBSCRIPTION_INVOICE', buffer: f.buffer, mime: f.mimetype, originalName: f.originalname });
    } catch (e) {
      if (e instanceof UploadRefused) {
        res.status(e.status).json({ success: false, error: e.message });
        return;
      }
      throw e;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { aiProvider: true, aiApiKey: true, aiModel: true, aiBaseUrl: true, usdInrRate: true },
    });
    const read = await readInvoice(
      { aiProvider: org?.aiProvider ?? 'GEMINI', aiApiKey: org?.aiApiKey ?? null, aiModel: org?.aiModel ?? '', aiBaseUrl: org?.aiBaseUrl ?? null },
      { buffer: f.buffer, mime: f.mimetype },
    );

    const platforms = await prisma.subscriptionPlatform.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true, status: true } });
    const match = matchPlatform(platforms ?? [], read.fields.vendor);
    const number = read.fields.invoiceNumber?.trim();
    const duplicate =
      match && number
        ? await prisma.subscriptionInvoice.findFirst({
            where: { platformId: match.id, invoiceNumber: number, deletedAt: null },
            select: { id: true, invoiceDate: true },
          })
        : null;
    const vendorName = match?.name ?? read.fields.vendor ?? '';
    const recurring = vendorName ? await recurringSoftwareCost(orgId, vendorName) : null;

    res.json({
      success: true,
      file: { id: stored.id, mime: stored.mime, sizeBytes: stored.sizeBytes, name: stored.originalName, url: `/api/files/${stored.id}` },
      aiUsed: read.aiUsed,
      reason: read.reason ?? null,
      fields: read.fields,
      uncertain: read.uncertain,
      platformMatch: match ? { id: match.id, name: match.name, status: match.status } : null,
      duplicate: duplicate ? { id: duplicate.id, uploadedOn: dayKey(duplicate.invoiceDate), message: `Already uploaded on ${dateText(duplicate.invoiceDate)}` } : null,
      recurringCost: recurring,
      platforms: platforms ?? [],
      usdInrRate: org?.usdInrRate ? Number(org.usdInrRate) : null,
    });
  } catch (e) {
    next(e);
  }
});

// ── Save, edit, delete ───────────────────────────────────────────────────────

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableMoney = z.number().min(0).nullable().optional();

const invoiceFields = z.object({
  platformId: z.string().min(1).optional(),
  platformName: z.string().trim().min(1, 'Say which platform this is').max(100).optional(),
  invoiceNumber: z.string().trim().min(1, 'The invoice needs its number').max(100),
  invoiceDate: day,
  periodStart: day.nullable().optional(),
  periodEnd: day.nullable().optional(),
  planName: nullableText(200),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency is a 3-letter code, like USD or INR'),
  subtotal: nullableMoney,
  taxAmount: nullableMoney,
  taxType: nullableText(40),
  total: z.number().positive('The total must be more than zero'),
  inrCharged: z.number().positive().nullable().optional(),
  vendorGstin: nullableText(20),
});

const saveSchema = invoiceFields
  .extend({
    fileId: z.string().min(1, 'The invoice file is missing — upload it again'),
    /** What the AI read, kept beside what was saved. */
    extracted: z.record(z.unknown()).nullable().optional(),
    /** "Stop the old recurring cost for Adobe so it isn't counted twice?" — yes. */
    stopRecurringCostId: z.string().optional(),
  })
  .refine((v) => v.platformId || v.platformName, { message: 'Say which platform this is', path: ['platformName'] })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, { message: 'The period ends before it starts', path: ['periodEnd'] });

const editSchema = invoiceFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, { message: 'The period ends before it starts', path: ['periodEnd'] });

/** The platform named — an existing one by id or name, or a new one from the name. */
async function platformFor(orgId: string, d: { platformId?: string; platformName?: string }) {
  if (d.platformId) {
    const p = await prisma.subscriptionPlatform.findFirst({ where: { id: d.platformId, organizationId: orgId } });
    if (!p) throw new RouteRefusal(404, 'That platform is not here.');
    return p;
  }
  const name = d.platformName!.trim();
  const nameKey = nameKeyOf(name);
  const existing = await prisma.subscriptionPlatform.findFirst({ where: { organizationId: orgId, nameKey } });
  if (existing) return existing;
  return prisma.subscriptionPlatform.create({ data: { organizationId: orgId, name, nameKey } });
}

class RouteRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The rupee figure, or why there is none — the saved cost needs one (decision 4). */
function rupeesFor(d: { currency: string; total: number; inrCharged?: number | null }, usdInrRate: number | null) {
  const r = inrOf({ currency: d.currency, total: d.total, inrCharged: d.inrCharged ?? null }, usdInrRate);
  if (r.inr === null) {
    throw new RouteRefusal(
      400,
      d.currency === 'USD'
        ? 'Enter the INR charged, or set a USD→INR rate in Settings → Money so it can be estimated.'
        : `Enter the INR charged: there is no rate to estimate ${d.currency} from.`,
    );
  }
  return r;
}

/** POST /api/subscriptions/invoices — save after review, with its linked cost. */
subscriptionsRouter.post('/invoices', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const d = parsed.data;

    const file = await prisma.storedFile.findFirst({
      where: { id: d.fileId, organizationId: orgId, kind: 'SUBSCRIPTION_INVOICE', deletedAt: null },
      select: { id: true, invoices: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (!file) throw new RouteRefusal(400, 'The invoice file is missing — upload it again.');
    if (file.invoices.length) throw new RouteRefusal(409, 'This file is already saved as an invoice.');

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { usdInrRate: true } });
    const rate = org?.usdInrRate ? Number(org.usdInrRate) : null;
    const platform = await platformFor(orgId, d);

    const dup = await prisma.subscriptionInvoice.findFirst({
      where: { platformId: platform.id, invoiceNumber: d.invoiceNumber, deletedAt: null },
      select: { invoiceDate: true },
    });
    if (dup) throw new RouteRefusal(409, `Already uploaded on ${dateText(dup.invoiceDate)}.`);

    const rupees = rupeesFor(d, rate);

    const cost = await prisma.cost.create({
      data: {
        organizationId: orgId,
        type: CostType.COMPANY,
        category: COST_CATEGORY,
        vendor: platform.name,
        amount: rupees.inr!,
        incurredAt: asStoredDay(d.invoiceDate),
        gstPercent: gstPercentOf(d),
        treatment: CostTreatment.COMPANY_EXPENSE,
        enteredById: req.user!.userId,
        notes: `Subscription invoice ${d.invoiceNumber} (${platform.name})${rupees.estimated ? ' — INR estimated from the USD rate' : ''}`,
      },
      select: { id: true },
    });

    let invoice;
    try {
      invoice = await prisma.subscriptionInvoice.create({
        data: {
          organizationId: orgId,
          platformId: platform.id,
          invoiceNumber: d.invoiceNumber,
          invoiceDate: asStoredDay(d.invoiceDate),
          periodStart: d.periodStart ? asStoredDay(d.periodStart) : null,
          periodEnd: d.periodEnd ? asStoredDay(d.periodEnd) : null,
          planName: d.planName || null,
          currency: d.currency,
          subtotal: d.subtotal ?? null,
          taxAmount: d.taxAmount ?? null,
          taxType: d.taxType || null,
          total: d.total,
          inrCharged: d.inrCharged ?? null,
          vendorGstin: d.vendorGstin || null,
          fileId: file.id,
          extracted: (d.extracted ?? undefined) as Prisma.InputJsonValue | undefined,
          costId: cost.id,
          createdById: req.user!.userId,
        },
      });
    } catch (e) {
      // The cost was for this invoice; without it there is nothing to count.
      await prisma.cost.update({ where: { id: cost.id }, data: { deletedAt: new Date() } }).catch(() => undefined);
      throw e;
    }

    let stoppedRecurring: string | null = null;
    if (d.stopRecurringCostId) {
      const old = await prisma.cost.findFirst({ where: { id: d.stopRecurringCostId, organizationId: orgId, recurring: true, deletedAt: null } });
      if (old) {
        await prisma.cost.update({ where: { id: old.id }, data: { recurring: false } });
        await log(req, 'Cost', old.id, 'cost_updated', {
          was: { recurring: true },
          now: { recurring: false },
          note: `Stopped: ${platform.name}'s invoices are counted from Subscriptions now`,
        });
        stoppedRecurring = old.id;
      }
    }

    await log(req, 'SubscriptionInvoice', invoice.id, 'subscription_invoice_added', {
      platform: platform.name,
      invoiceNumber: d.invoiceNumber,
      amount: amountText(d.currency, d.total),
      inr: rupees.inr,
      estimated: rupees.estimated,
    });

    res.status(201).json({ success: true, invoice: { id: invoice.id, platformId: platform.id, platformName: platform.name, costId: cost.id, inr: rupees.inr, estimated: rupees.estimated }, stoppedRecurring });
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/subscriptions/invoices/:id — correct it; the linked cost follows. */
subscriptionsRouter.patch('/invoices/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const d = parsed.data;
    const existing = await prisma.subscriptionInvoice.findFirst({
      where: { id: String(req.params.id), organizationId: orgId, deletedAt: null },
      include: { platform: true },
    });
    if (!existing) throw new RouteRefusal(404, 'Invoice not found');

    const platform = d.platformId || d.platformName ? await platformFor(orgId, d) : existing.platform;
    const invoiceNumber = d.invoiceNumber ?? existing.invoiceNumber;
    if (platform.id !== existing.platformId || invoiceNumber !== existing.invoiceNumber) {
      const dup = await prisma.subscriptionInvoice.findFirst({
        where: { platformId: platform.id, invoiceNumber, deletedAt: null, id: { not: existing.id } },
        select: { invoiceDate: true },
      });
      if (dup) throw new RouteRefusal(409, `Already uploaded on ${dateText(dup.invoiceDate)}.`);
    }

    const merged = {
      currency: d.currency ?? existing.currency,
      total: d.total ?? Number(existing.total),
      inrCharged: d.inrCharged !== undefined ? d.inrCharged : existing.inrCharged === null ? null : Number(existing.inrCharged),
      subtotal: d.subtotal !== undefined ? d.subtotal : existing.subtotal === null ? null : Number(existing.subtotal),
      taxAmount: d.taxAmount !== undefined ? d.taxAmount : existing.taxAmount === null ? null : Number(existing.taxAmount),
      taxType: d.taxType !== undefined ? d.taxType : existing.taxType,
      invoiceDate: d.invoiceDate ?? dayKey(existing.invoiceDate),
    };
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { usdInrRate: true } });
    const rupees = rupeesFor(merged, org?.usdInrRate ? Number(org.usdInrRate) : null);

    const updated = await prisma.subscriptionInvoice.update({
      where: { id: existing.id },
      data: {
        platformId: platform.id,
        invoiceNumber,
        invoiceDate: asStoredDay(merged.invoiceDate),
        ...(d.periodStart !== undefined ? { periodStart: d.periodStart ? asStoredDay(d.periodStart) : null } : {}),
        ...(d.periodEnd !== undefined ? { periodEnd: d.periodEnd ? asStoredDay(d.periodEnd) : null } : {}),
        ...(d.planName !== undefined ? { planName: d.planName || null } : {}),
        currency: merged.currency,
        subtotal: merged.subtotal,
        taxAmount: merged.taxAmount,
        ...(d.taxType !== undefined ? { taxType: d.taxType || null } : {}),
        total: merged.total,
        inrCharged: merged.inrCharged,
        ...(d.vendorGstin !== undefined ? { vendorGstin: d.vendorGstin || null } : {}),
      },
    });

    if (existing.costId) {
      await prisma.cost.updateMany({
        where: { id: existing.costId, organizationId: orgId },
        data: {
          vendor: platform.name,
          amount: rupees.inr!,
          incurredAt: asStoredDay(merged.invoiceDate),
          gstPercent: gstPercentOf(merged),
          notes: `Subscription invoice ${invoiceNumber} (${platform.name})${rupees.estimated ? ' — INR estimated from the USD rate' : ''}`,
        },
      });
    }

    await log(req, 'SubscriptionInvoice', updated.id, 'subscription_invoice_updated', {
      platform: platform.name,
      invoiceNumber,
      fields: Object.keys(d),
      inr: rupees.inr,
      estimated: rupees.estimated,
    });
    res.json({ success: true, invoice: { id: updated.id, platformId: platform.id, platformName: platform.name, inr: rupees.inr, estimated: rupees.estimated } });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/subscriptions/invoices/:id — soft, with its cost and its file. */
subscriptionsRouter.delete('/invoices/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.subscriptionInvoice.findFirst({
      where: { id: String(req.params.id), organizationId: orgId, deletedAt: null },
      include: { platform: { select: { name: true } } },
    });
    if (!existing) throw new RouteRefusal(404, 'Invoice not found');
    const now = new Date();
    await prisma.subscriptionInvoice.update({ where: { id: existing.id }, data: { deletedAt: now } });
    if (existing.costId) await prisma.cost.updateMany({ where: { id: existing.costId, organizationId: orgId }, data: { deletedAt: now } });
    await softDeleteFile(existing.fileId);
    await log(req, 'SubscriptionInvoice', existing.id, 'subscription_invoice_deleted', {
      platform: existing.platform.name,
      invoiceNumber: existing.invoiceNumber,
      amount: amountText(existing.currency, Number(existing.total)),
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── The view ─────────────────────────────────────────────────────────────────

/** GET /api/subscriptions — this month, this year, the run-rate, renewals, and every platform. */
subscriptionsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, ...(await subscriptionsView(req.user!.organizationId)) });
  } catch (e) {
    next(e);
  }
});

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /api/subscriptions/export.csv — every invoice, for the accountant. */
subscriptionsRouter.get('/export.csv', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const [platforms, org] = await Promise.all([
      loadPlatforms(orgId),
      prisma.organization.findUnique({ where: { id: orgId }, select: { usdInrRate: true } }),
    ]);
    const rate = org?.usdInrRate ? Number(org.usdInrRate) : null;
    const header = ['Platform', 'Status', 'Plan', 'Invoice number', 'Invoice date', 'Period start', 'Period end', 'Currency', 'Subtotal', 'Tax', 'Tax type', 'Total', 'INR charged', 'INR estimated', 'Vendor GSTIN'];
    const lines = [header.join(',')];
    for (const p of platforms) {
      for (const i of p.invoices) {
        const r = inrOf(i, rate);
        lines.push(
          [
            p.name,
            p.status,
            i.planName,
            i.invoiceNumber,
            dayKey(i.invoiceDate),
            i.periodStart ? dayKey(i.periodStart) : '',
            i.periodEnd ? dayKey(i.periodEnd) : '',
            i.currency,
            i.subtotal,
            i.taxAmount,
            i.taxType,
            i.total,
            i.inrCharged,
            r.estimated ? r.inr : '',
            i.vendorGstin,
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
    sendCsv(res, `subscriptions-${new Date().toISOString().slice(0, 10)}`, lines.join('\n'));
  } catch (e) {
    next(e);
  }
});

/** GET /api/subscriptions/:platformId — one platform: every invoice, and how its price moved. */
subscriptionsRouter.get('/:platformId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const [platforms, org] = await Promise.all([
      loadPlatforms(orgId),
      prisma.organization.findUnique({ where: { id: orgId }, select: { usdInrRate: true } }),
    ]);
    const p = platforms.find((x) => x.id === String(req.params.platformId));
    if (!p) throw new RouteRefusal(404, 'Platform not found');
    const rate = org?.usdInrRate ? Number(org.usdInrRate) : null;
    const invoices = [...p.invoices].reverse().map((i) => {
      const r = inrOf(i, rate);
      return {
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        invoiceDate: dayKey(i.invoiceDate),
        periodStart: i.periodStart ? dayKey(i.periodStart) : null,
        periodEnd: i.periodEnd ? dayKey(i.periodEnd) : null,
        planName: i.planName,
        currency: i.currency,
        subtotal: i.subtotal,
        taxAmount: i.taxAmount,
        taxType: i.taxType,
        total: i.total,
        inrCharged: i.inrCharged,
        inr: r.inr,
        estimated: r.estimated,
        vendorGstin: i.vendorGstin,
        fileId: i.fileId,
        fileUrl: `/api/files/${i.fileId}`,
        costId: i.costId,
      };
    });
    res.json({
      success: true,
      platform: { id: p.id, name: p.name, status: p.status, notes: p.notes },
      invoices,
      priceHistory: p.invoices.map((i) => ({ date: dayKey(i.invoiceDate), currency: i.currency, total: i.total, plan: i.planName })),
    });
  } catch (e) {
    next(e);
  }
});

const platformEditSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });

/** PATCH /api/subscriptions/:platformId — rename, cancel or reactivate, notes. */
subscriptionsRouter.patch('/:platformId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = platformEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const existing = await prisma.subscriptionPlatform.findFirst({ where: { id: String(req.params.platformId), organizationId: orgId } });
    if (!existing) throw new RouteRefusal(404, 'Platform not found');
    const d = parsed.data;
    if (d.name && nameKeyOf(d.name) !== existing.nameKey) {
      const clash = await prisma.subscriptionPlatform.findFirst({ where: { organizationId: orgId, nameKey: nameKeyOf(d.name) }, select: { id: true } });
      if (clash) throw new RouteRefusal(409, `There is already a platform called ${d.name}.`);
    }
    const row = await prisma.subscriptionPlatform.update({
      where: { id: existing.id },
      data: {
        ...(d.name ? { name: d.name, nameKey: nameKeyOf(d.name) } : {}),
        ...(d.status ? { status: d.status } : {}),
        ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
      },
    });
    // The linked costs name the vendor; a renamed platform renames them too.
    if (d.name && d.name !== existing.name) {
      const linked = await prisma.subscriptionInvoice.findMany({ where: { platformId: existing.id, costId: { not: null } }, select: { costId: true } });
      const ids = linked.map((l) => l.costId!).filter(Boolean);
      if (ids.length) await prisma.cost.updateMany({ where: { id: { in: ids } }, data: { vendor: d.name } });
    }
    await log(req, 'SubscriptionPlatform', row.id, 'subscription_platform_updated', { name: row.name, fields: Object.keys(d), ...(d.status ? { status: d.status } : {}) });
    res.json({ success: true, platform: { id: row.id, name: row.name, status: row.status, notes: row.notes } });
  } catch (e) {
    next(e);
  }
});

// A refusal of our own, or multer's, in the app's usual shape.
subscriptionsRouter.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof RouteRefusal) {
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      success: false,
      error: tooBig ? 'That file is over 10 MB; the most an invoice can be.' : 'Send one file, as the "file" field.',
    });
    return;
  }
  next(err);
});
