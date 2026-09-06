import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { CompanyVertical, CompanySource, CompanyStatus, OutreachStatus } from '@prisma/client';
import { parsePagination } from '../utils/query.js';
import { toCsv, parseCsv } from '../utils/csv.js';
import { matchEnumValue, VERTICAL_ALIASES } from '../utils/enums.js';
import { sendCsv } from '../utils/csvResponse.js';

export const outreachRouter = Router();

outreachRouter.use(authenticate);

// ── 1. List Outreach Staging Records ────────────────────────────────────────

outreachRouter.get('/', requirePermission('company.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { status, vertical, search } = req.query;
    const orgId = req.user!.organizationId;
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    /**
     * Promoted entries are gone from this list, decided here rather than in
     * the browser.
     *
     * The screen has always hidden them — an entry that has become a company
     * belongs on /companies, not on a list of people to contact — but it hid
     * them AFTER the fetch, so `meta.total` counted rows nobody would see and
     * the paging maths could never line up. It also made the Companies tile,
     * which counts this list, disagree with the list itself: 7 against 5.
     *
     * `?includePromoted=true` brings them back for an export that wants the
     * whole history of who was contacted.
     */
    const where: any = { organizationId: orgId };
    if (req.query.includePromoted !== 'true') where.promotedCompanyId = null;

    /*
     * What every count on the screen is allowed to see, before either filter
     * narrows it: the organisation's un-promoted rows, matching the search.
     *
     * The counts are built from this rather than from `where`, because a count
     * taken after its own filter can only ever report the number you already
     * picked. That is the mistake the Companies tabs were making — every tab
     * but the open one said zero — and a status chip reading "Contacted 0"
     * while three rows sit at Contacted is the same lie in a smaller frame.
     */
    const base: any = { ...where };

    if (status && typeof status === 'string' && ['NOT_CONTACTED', 'CONTACTED', 'REPLIED', 'DEAD'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as OutreachStatus;
    }

    if (vertical && typeof vertical === 'string') {
      where.vertical = vertical as CompanyVertical;
    }

    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
      base.name = where.name;
    }

    // The facet ignores its OWN dimension and respects every other, which is
    // what makes a chip's number answer "how many would I get if I clicked it".
    const statusFacetWhere = { ...base, ...(where.vertical ? { vertical: where.vertical } : {}) };

    const [entries, total, statusFacets, coldTotal] = await Promise.all([
      prisma.outreachEntry.findMany({
        where,
        /*
         * Newest first, and the same order every time you ask.
         *
         * `importedAt` alone is not an order — it is a near-tie. The list is
         * bulk imported, so a whole scrape lands in one statement and every row
         * in it carries the identical timestamp: six of the seven rows here
         * share `2026-09-02T05:51:12.647Z` to the millisecond. A sort with no
         * tiebreak leaves Postgres free to return those six in any order it
         * likes, and after an UPDATE it likes a different one, because the
         * changed row is written as a new tuple at the end of the heap.
         *
         * That is what "the row moves when I change its status" was: setting
         * Chennai Silks to Dead sent it from second in the list to last, and it
         * stayed there after the status was put back. `id` is a cuid — the
         * timestamp is its prefix — so descending id is both a total order and
         * still newest-first within a tied import.
         */
        orderBy: [{ importedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: {
          // The Owner column has rendered "—" on every row since this screen
          // existed. Not because nobody owns these: `ownerId` is set on create
          // and on import, and all seven rows here belong to a real person.
          // There was simply no relation on the model, so there was nothing to
          // include and nothing to send.
          owner: { select: { id: true, name: true, designation: true } },
          promotedCompany: { select: { id: true, name: true, status: true } },
        },
      }),
      prisma.outreachEntry.count({ where }),
      prisma.outreachEntry.groupBy({ by: ['status'], where: statusFacetWhere, _count: true }),
      // Follows nothing. The banner says how many cold names exist, which is
      // not a statement about whatever is filtered on screen right now.
      prisma.outreachEntry.count({ where: { organizationId: orgId, promotedCompanyId: null } }),
    ]);

    if (wantsCsv) {
      const csv = toCsv(entries, [
        { label: 'Name', value: (e) => e.name },
        { label: 'Vertical', value: (e) => e.vertical },
        { label: 'Source', value: (e) => e.source },
        { label: 'Owner', value: (e) => e.owner?.name ?? '' },
        { label: 'Status', value: (e) => e.status },
        { label: 'Promoted to', value: (e) => e.promotedCompany?.name ?? '' },
        { label: 'Imported', value: (e) => e.importedAt.toISOString().slice(0, 10) },
      ]);
      sendCsv(res, `outreach-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    const byStatus = (s: OutreachStatus) => statusFacets.find((f) => f.status === s)?._count ?? 0;

    res.json({
      success: true,
      entries,
      counts: {
        ALL: statusFacets.reduce((n, f) => n + f._count, 0),
        NOT_CONTACTED: byStatus(OutreachStatus.NOT_CONTACTED),
        CONTACTED: byStatus(OutreachStatus.CONTACTED),
        REPLIED: byStatus(OutreachStatus.REPLIED),
        DEAD: byStatus(OutreachStatus.DEAD),
      },
      summary: { cold: coldTotal },
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. Create Single Outreach Entry ─────────────────────────────────────────

const outreachCreateSchema = z.object({
  name: z.string().min(1, 'Lead name is required'),
  vertical: z.nativeEnum(CompanyVertical),
  source: z.nativeEnum(CompanySource).default(CompanySource.OUTREACH),
  ownerId: z.string().optional(),
});

outreachRouter.post('/', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = outreachCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const entry = await prisma.outreachEntry.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name.trim(),
        vertical: parsed.data.vertical,
        source: parsed.data.source,
        ownerId: parsed.data.ownerId || req.user!.userId,
        status: OutreachStatus.NOT_CONTACTED,
      },
    });

    res.status(201).json({ success: true, entry });
  } catch (error) {
    next(error);
  }
});

// ── 3. Update Outreach Status ───────────────────────────────────────────────
//
// §11.1 step 3 reads "Someone replies. BD marks the entry replied. System
// creates a Company" as one action — this route used to do exactly that, in
// one transaction, the moment status flipped to Replied. Reworked, on
// request, into two deliberate steps: this route now only ever changes the
// status (never creates anything), and promotion is its own explicit action
// — see `POST /:id/promote` below, which is what the UI calls once a row is
// marked Replied.

// ── Edit an entry ───────────────────────────────────────────────────────────
//
// There was no way to change anything about a cold name except its status. A
// name typed wrong, filed under the wrong vertical, or sitting with the wrong
// person stayed that way — the row could be marked Dead and typed again, which
// loses the fact that it had ever been contacted.
//
// `ownerId` is here because it is the one field the create form never asks
// for: POST quietly defaults it to whoever added the name, which is right most
// of the time and impossible to correct the rest of the time.

const outreachEditSchema = z
  .object({
    name: z.string().min(1, 'A name is required').max(200).optional(),
    vertical: z.nativeEnum(CompanyVertical).optional(),
    source: z.nativeEnum(CompanySource).optional(),
    ownerId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

outreachRouter.patch('/:id', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = outreachEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const existing = await prisma.outreachEntry.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }
    if (existing.promotedCompanyId) {
      // It is a Company now, and the company record is the one that counts.
      // Editing the husk it came from would put two versions of the same name
      // in the product, only one of which anybody looks at.
      res.status(400).json({
        success: false,
        error: 'This name is already a company. Edit it on the company record instead.',
      });
      return;
    }

    const { name, vertical, source, ownerId } = parsed.data;

    if (ownerId) {
      const owner = await prisma.user.findFirst({
        where: { id: ownerId, organizationId: orgId, active: true },
        select: { id: true },
      });
      if (!owner) {
        res.status(400).json({ success: false, error: 'That person is not on the team' });
        return;
      }
    }

    const entry = await prisma.outreachEntry.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(vertical !== undefined ? { vertical } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
      },
      include: { owner: { select: { id: true, name: true, designation: true } } },
    });

    res.json({ success: true, entry });
  } catch (error) {
    next(error);
  }
});

outreachRouter.patch('/:id/status', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { status } = req.body;
    if (!status || !['NOT_CONTACTED', 'CONTACTED', 'REPLIED', 'DEAD'].includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid outreach status' });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const existing = await prisma.outreachEntry.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }

    const entry = await prisma.outreachEntry.update({
      where: { id },
      data: { status: status as OutreachStatus },
    });

    res.json({ success: true, entry });
  } catch (error) {
    next(error);
  }
});

// ── 4. Promote Outreach Entry to Prospect ───────────────────────────────────

const promoteSchema = z.object({
  city: z.string().default('Chennai'),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional().or(z.literal('')),
});

outreachRouter.post('/:id/promote', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const entry = await prisma.outreachEntry.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!entry) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }

    if (entry.promotedCompanyId) {
      res.status(400).json({ success: false, error: 'This lead has already been promoted to a Company.' });
      return;
    }

    const parsed = promoteSchema.safeParse(req.body);
    const { city, contactName, contactEmail, contactPhone } = parsed.success ? parsed.data : { city: 'Chennai' };

    // Transaction: Create company + optional contact + link promotedCompanyId
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          organizationId: orgId,
          name: entry.name,
          vertical: entry.vertical,
          source: entry.source,
          ownerId: entry.ownerId || req.user!.userId,
          city: city || 'Chennai',
          status: CompanyStatus.PROSPECT,
        },
      });

      if (contactName && contactName.trim()) {
        await tx.person.create({
          data: {
            companyId: company.id,
            name: contactName.trim(),
            email: contactEmail || null,
            phone: contactPhone || null,
            role: 'CONTACT',
          },
        });
      }

      const updatedEntry = await tx.outreachEntry.update({
        where: { id: entry.id },
        data: {
          status: OutreachStatus.REPLIED,
          promotedCompanyId: company.id,
        },
      });

      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Company',
          entityId: company.id,
          actorId: req.user!.userId,
          verb: 'outreach_promoted',
          payload: { outreachId: entry.id, companyName: company.name },
        },
      });

      return { company, entry: updatedEntry };
    });

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// ── 5. Bulk import from a CSV ───────────────────────────────────────────────
//
// §11.1 step 1: "Names imported into OutreachEntry." The "Import CSV" button
// existed with no route behind it — `parseCsv` was already built and tested
// but never called from anywhere. Same dry-run-first shape as the rest of the
// app's CSV imports: nothing is written until the caller has seen what every
// row will do.

interface ImportRowResult {
  row: number;
  name: string;
  action: 'CREATED' | 'SKIPPED' | 'WOULD_CREATE' | 'INVALID';
  reason?: string;
}

outreachRouter.post('/import', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { csv, dryRun, force } = req.body as { csv?: string; dryRun?: boolean; force?: boolean };

    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      res.status(400).json({ success: false, error: 'No file content received' });
      return;
    }

    const rows = parseCsv(csv);

    const [existingEntries, existingCompanies] = await Promise.all([
      prisma.outreachEntry.findMany({ where: { organizationId: orgId }, select: { name: true } }),
      prisma.company.findMany({ where: { organizationId: orgId }, select: { name: true } }),
    ]);
    const existingNames = new Set([...existingEntries, ...existingCompanies].map((r) => r.name.trim().toLowerCase()));
    const seenInFile = new Set<string>();

    const results: ImportRowResult[] = [];
    const toCreate: { name: string; vertical: CompanyVertical; source: CompanySource }[] = [];

    rows.forEach((row, index) => {
      const rowNum = index + 2; // header is row 1, so the first data row is 2 — matches what the person sees in their spreadsheet
      const name = (row.name || row.companyname || row.company || '').trim();

      if (!name) {
        results.push({ row: rowNum, name: '', action: 'INVALID', reason: 'Missing a name' });
        return;
      }

      const key = name.toLowerCase();
      if (existingNames.has(key)) {
        results.push({ row: rowNum, name, action: 'SKIPPED', reason: 'A company or outreach entry with this name already exists' });
        return;
      }
      if (seenInFile.has(key) && !force) {
        results.push({ row: rowNum, name, action: 'SKIPPED', reason: 'Duplicate name within this file' });
        return;
      }

      const verticalRaw = row.vertical || row.industry;
      const vertical = matchEnumValue(verticalRaw, Object.values(CompanyVertical), VERTICAL_ALIASES);
      if (!vertical) {
        results.push({ row: rowNum, name, action: 'INVALID', reason: `Unrecognised vertical "${verticalRaw ?? ''}"` });
        return;
      }

      const source = matchEnumValue(row.source, Object.values(CompanySource)) ?? CompanySource.OUTREACH;

      seenInFile.add(key);
      toCreate.push({ name, vertical, source });
      results.push({ row: rowNum, name, action: dryRun ? 'WOULD_CREATE' : 'CREATED' });
    });

    let created = 0;
    if (!dryRun && toCreate.length > 0) {
      const outcome = await prisma.outreachEntry.createMany({
        data: toCreate.map((r) => ({
          organizationId: orgId,
          name: r.name,
          vertical: r.vertical,
          source: r.source,
          ownerId: req.user!.userId,
          status: OutreachStatus.NOT_CONTACTED,
        })),
      });
      created = outcome.count;
    }

    res.json({
      success: true,
      dryRun: !!dryRun,
      total: rows.length,
      created,
      wouldCreate: toCreate.length,
      skipped: results.filter((r) => r.action === 'SKIPPED').length,
      invalid: results.filter((r) => r.action === 'INVALID').length,
      results,
    });
  } catch (error) {
    next(error);
  }
});
