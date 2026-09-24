import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { CompanyStatus, OutreachStatus, ProposalKind, ProposalStage } from '@prisma/client';
import { DEFAULT_LEAD_SOURCE } from '@flowzen/shared';
import { parsePagination } from '../utils/query.js';
import { toCsv, parseCsv } from '../utils/csv.js';
import { matchIndustry, resolveLeadSource, industrySchema, leadSourceSchema } from '../utils/enums.js';
import { sendCsv } from '../utils/csvResponse.js';
import { checkForDuplicates } from '../services/duplicateCheck.js';

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

    if (status && typeof status === 'string' && (Object.values(OutreachStatus) as string[]).includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as OutreachStatus;
    }

    if (vertical && typeof vertical === 'string') {
      where.vertical = vertical;
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
        FOLLOW_UP: byStatus(OutreachStatus.FOLLOW_UP),
        MEETING: byStatus(OutreachStatus.MEETING),
        INTERESTED: byStatus(OutreachStatus.INTERESTED),
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

/**
 * A lead you cannot reach is a note, not a lead.
 *
 * This is the rule the change request states as a database constraint. It
 * lives here instead — see the migration for why: every row that predates the
 * change has neither column, and a CHECK constraint (even NOT VALID) then
 * blocks every future UPDATE of those rows, so nobody could so much as change
 * their status. Enforced here it applies to every new lead, and says something
 * a person can act on rather than raising a constraint violation at them.
 */
const reachable = <T extends { phone?: string | null; email?: string | null }>(v: T) =>
  Boolean(v.phone?.trim() || v.email?.trim());

const outreachCreateSchema = z
  .object({
    name: z.string().min(1, 'Lead name is required'),
    vertical: industrySchema,
    source: leadSourceSchema.default(DEFAULT_LEAD_SOURCE),
    ownerId: z.string().optional(),
    contactPersonName: z.string().trim().optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    email: z.string().trim().email('That email address does not look right').optional().nullable().or(z.literal('')),
  })
  .refine(reachable, {
    message: 'Add a phone number or an email address — a lead you cannot reach is only a name.',
    path: ['phone'],
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
        contactPersonName: parsed.data.contactPersonName?.trim() || null,
        phone: parsed.data.phone?.trim() || null,
        email: parsed.data.email?.trim() || null,
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
    vertical: industrySchema.optional(),
    source: leadSourceSchema.optional(),
    ownerId: z.string().min(1).nullable().optional(),
    // Editable so the leads that predate this change can be given a way to
    // reach them. `reachable` is deliberately NOT enforced here: a legacy row
    // has neither, and refusing every edit until somebody produces a phone
    // number is how a rule stops people using the screen at all.
    contactPersonName: z.string().trim().nullable().optional(),
    phone: z.string().trim().nullable().optional(),
    email: z.string().trim().email('That email address does not look right').nullable().optional().or(z.literal('')),
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

    const { name, vertical, source, ownerId, contactPersonName, phone, email } = parsed.data;

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
        ...(contactPersonName !== undefined ? { contactPersonName: contactPersonName || null } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
        ...(email !== undefined ? { email: email || null } : {}),
      },
      include: { owner: { select: { id: true, name: true, designation: true } } },
    });

    res.json({ success: true, entry });
  } catch (error) {
    next(error);
  }
});

/**
 * Moving a lead along, and writing down what was said.
 *
 * ─── The two conditional fields ─────────────────────────────────────────────
 *
 * FOLLOW_UP and MEETING both hang off `nextActionDate`, and the label on
 * screen is what changes ("Call back on" / "Meeting on"), not the column.
 *
 *   FOLLOW_UP   date and remarks both required — a callback with no date is
 *               not a callback, and a callback with no reason is a lead
 *               somebody is quietly parking.
 *   MEETING     date required, remarks optional (time, online or offline,
 *               who is going — useful, not load-bearing).
 *
 * The other three statuses carry neither, so anything sent with them is
 * ignored rather than stored where nothing will ever show it.
 *
 * ─── The trail ──────────────────────────────────────────────────────────────
 *
 * `remarks` on the row is the LATEST note, and nothing more. Every change
 * writes an Activity row carrying the old status, the new one, and the note
 * and date entered at that moment — so a lead followed up four times keeps
 * four call notes in order instead of the last one having eaten the other
 * three. The feed is where the history is read from; see activities.ts, which
 * needed an `OutreachEntry` entry of its own before any of this was visible.
 */
const statusChangeSchema = z
  .object({
    status: z.nativeEnum(OutreachStatus),
    remarks: z.string().trim().max(2000).optional().nullable(),
    nextActionDate: z.string().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const needsDate = v.status === OutreachStatus.FOLLOW_UP || v.status === OutreachStatus.MEETING;
    if (needsDate && !v.nextActionDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextActionDate'],
        message:
          v.status === OutreachStatus.FOLLOW_UP
            ? 'When are you calling them back?'
            : 'When is the meeting?',
      });
    }
    if (v.status === OutreachStatus.FOLLOW_UP && !v.remarks?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remarks'],
        message: 'What did they say? A callback with no note is a lead nobody can pick up.',
      });
    }
    if (v.nextActionDate && Number.isNaN(Date.parse(v.nextActionDate))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nextActionDate'], message: 'That date is not a real date' });
    }
  });

outreachRouter.patch('/:id/status', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = statusChangeSchema.safeParse(req.body);
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
      res.status(400).json({
        success: false,
        error: 'This name is already a company. Its status lives on the company record now.',
      });
      return;
    }

    const { status, remarks, nextActionDate } = parsed.data;
    const carriesAction = status === OutreachStatus.FOLLOW_UP || status === OutreachStatus.MEETING;

    // The date and note belong to FOLLOW_UP and MEETING. Moving to any other
    // status clears them, because a "call back on" date sitting against a dead
    // lead is a reminder for something nobody intends to do. The trail below
    // keeps what they said either way.
    const entry = await prisma.outreachEntry.update({
      where: { id },
      data: {
        status,
        remarks: carriesAction ? (remarks?.trim() || null) : null,
        nextActionDate: carriesAction && nextActionDate ? new Date(nextActionDate) : null,
      },
      include: { owner: { select: { id: true, name: true, designation: true } } },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'OutreachEntry',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'outreach_status_changed',
        payload: {
          name: existing.name,
          from: existing.status,
          to: status,
          // Written down as entered, at the moment it was entered. This is the
          // record; the column on the row is only ever the most recent one.
          remarks: remarks?.trim() || null,
          nextActionDate: carriesAction && nextActionDate ? nextActionDate : null,
        },
      },
    });

    res.json({ success: true, entry });
  } catch (error) {
    next(error);
  }
});

// ── 4. Promote Outreach Entry to Prospect ───────────────────────────────────

/**
 * A lead becomes a client.
 *
 * Only from INTERESTED, which under the new statuses means something specific:
 * they have been met, they are happy, and they have asked for a quotation. A
 * name that has merely been called cannot cross into the Companies directory —
 * that separation is the point of keeping two lists (§7).
 *
 * Every field is pre-filled from the lead and editable, because the person
 * doing this has just been in the room and knows the legal name better than
 * the spreadsheet did.
 */
const promoteSchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  city: z.string().default('Chennai'),
  vertical: industrySchema.optional(),
  /*
   * Retainer or one-off, which the outreach row has no field for and so cannot
   * carry forward. Defaulted rather than required — the studio's work is mostly
   * retainers, and it is one click to change on the deal.
   */
  kind: z.nativeEnum(ProposalKind).default(ProposalKind.RETAINER),
  ownerId: z.string().min(1).optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional().or(z.literal('')),
  /** Carries a NAME warning past. A matching phone or email cannot be forced. */
  force: z.boolean().optional(),
});

outreachRouter.post('/:id/promote', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const entry = await prisma.outreachEntry.findFirst({ where: { id, organizationId: orgId } });

    if (!entry) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }

    if (entry.promotedCompanyId) {
      res.status(400).json({ success: false, error: 'This lead has already been promoted to a Company.' });
      return;
    }

    if (entry.status !== OutreachStatus.INTERESTED) {
      res.status(400).json({
        success: false,
        error: 'Only a lead marked Interested can become a company — they have been met and asked for a quotation.',
      });
      return;
    }

    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const { companyName, city, vertical, kind, ownerId, contactName, contactEmail, contactPhone, force } = parsed.data;

    // Everything falls back to what the lead already knows.
    const name = (companyName || entry.name).trim();
    const personName = (contactName || entry.contactPersonName || '').trim();
    const personEmail = (contactEmail || entry.email || '').trim();
    const personPhone = (contactPhone || entry.phone || '').trim();
    const useVertical = vertical ?? entry.vertical;
    const useOwner = ownerId || entry.ownerId || req.user!.userId;

    /**
     * The same verdict the new-company form runs.
     *
     * Promotion used to create the company with no duplicate check at all, so
     * a lead whose name already belonged to a client hit the unique index on
     * (organizationId, name) and came back as a bare 500 — Prisma's P2002
     * carries no HTTP status, and the error handler defaults to 500. Now the
     * clash is answered properly, and a matching phone or email is caught too,
     * which only became possible once a lead carried either.
     */
    const others = await prisma.company.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, people: { take: 1, select: { email: true, phone: true } } },
    });
    const verdict = checkForDuplicates(
      { name, email: personEmail || null, phone: personPhone || null },
      others.map((c) => ({ id: c.id, name: c.name, email: c.people[0]?.email || null, phone: c.people[0]?.phone || null })),
    );

    if (verdict.action === 'BLOCK' || (verdict.action === 'WARN' && !force)) {
      res.status(409).json({
        success: false,
        error: 'This looks like a company you already have.',
        data: { ...verdict, canForce: verdict.action === 'WARN' },
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          organizationId: orgId,
          name,
          vertical: useVertical,
          source: entry.source,
          ownerId: useOwner,
          city: city || 'Chennai',
          status: CompanyStatus.PROSPECT,
        },
      });

      // A contact is written whenever the lead carried anything to write —
      // the details came off the lead, so losing them at the moment of
      // promotion would throw away the only reason the lead was any use.
      if (personName || personEmail || personPhone) {
        await tx.person.create({
          data: {
            companyId: company.id,
            name: personName || name,
            email: personEmail || null,
            phone: personPhone || null,
            role: 'CONTACT',
          },
        });
      }

      /*
       * And onto the pipeline board, at Prospect.
       *
       * Promoting a lead used to create a company and stop, so a company you
       * had spoken to and were about to quote appeared nowhere on the board —
       * the pipeline only began when somebody wrote the proposal, which is
       * after the part that needs chasing.
       *
       * No version, so no value: the deal weights at zero until a proposal is
       * written against it, which is what moving it to Proposal Sent does.
       *
       * This is NOT the TALKING stage that was removed. That one was created
       * automatically for every company, could not be advanced and had to be
       * deleted by hand. This happens only on a deliberate promote, and is
       * deletable.
       */
      await tx.proposal.create({
        data: {
          organizationId: orgId,
          companyId: company.id,
          kind,
          ownerId: useOwner,
          stage: ProposalStage.PROSPECT,
        },
      });

      // Archived, not deleted: the row keeps its history and simply leaves the
      // list, which filters on `promotedCompanyId`.
      const updatedEntry = await tx.outreachEntry.update({
        where: { id: entry.id },
        data: { promotedCompanyId: company.id },
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
    const toCreate: {
      name: string;
      vertical: string;
      source: string;
      contactPersonName: string | null;
      phone: string | null;
      email: string | null;
    }[] = [];

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
      const vertical = matchIndustry(verticalRaw);
      if (!vertical) {
        results.push({ row: rowNum, name, action: 'INVALID', reason: `Unrecognised industry "${verticalRaw ?? ''}"` });
        return;
      }

      const source = resolveLeadSource(row.source);

      /*
       * The same rule the manual form applies: a lead you cannot reach is a
       * note, not a lead.
       *
       * This is a change to what a file must contain — sheets that carry only
       * names will now report every row as INVALID. That is what the dry run
       * is for: it is a readable list of what needs adding, before anything is
       * written. Several spellings are accepted because the files come from
       * scrapes and everybody's export names these columns differently.
       */
      const phone = (row.phone || row.mobile || row.contactnumber || row.contact_number || '').trim();
      const email = (row.email || row.emailaddress || row.email_address || '').trim();
      if (!phone && !email) {
        results.push({
          row: rowNum,
          name,
          action: 'INVALID',
          reason: 'No phone or email — add a column for one of them',
        });
        return;
      }
      const contactPersonName = (row.contactperson || row.contact_person || row.contactname || row.contact || '').trim();

      seenInFile.add(key);
      toCreate.push({
        name,
        vertical,
        source,
        contactPersonName: contactPersonName || null,
        phone: phone || null,
        email: email || null,
      });
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
