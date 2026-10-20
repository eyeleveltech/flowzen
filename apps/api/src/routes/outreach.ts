import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { CompanyStatus, OutreachStatus, Prisma } from '@prisma/client';
import { DEFAULT_LEAD_SOURCE } from '@flowzen/shared';
import { parsePagination } from '../utils/query.js';
import { toCsv, parseCsv } from '../utils/csv.js';
import { matchIndustry, resolveLeadSource, industrySchema, leadSourceSchema } from '../utils/enums.js';
import { sendCsv } from '../utils/csvResponse.js';
import { checkForDuplicates } from '../services/duplicateCheck.js';
import { changesBetween } from '../utils/activityDiff.js';
import { asStoredDay, dayKey } from '../utils/moneyDates.js';
import {
  ACTIVE_OUTREACH,
  CHANNEL_LABEL,
  bulkLastContactSchema,
  isActiveOutreach,
  lastContactRefusal,
  lastContactSchema,
  leadStaleness,
  mergeNextStep,
  nextStepDateRefusal,
  nextStepState,
  studioToday,
  touchSchema,
} from '../services/salesFollowUp.js';

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
    // `deletedAt` on every read: a removed lead is gone from the list, the
    // counts and the tabs, and lives in Settings > Trash until it is restored.
    const where: any = { organizationId: orgId, deletedAt: null };
    if (req.query.includePromoted !== 'true') where.promotedCompanyId = null;

    // "Going stale" for a lead: active, and its last touch past the threshold.
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { outreachStaleDays: true } });
    const staleDays = org?.outreachStaleDays ?? 10;
    const today = await studioToday(orgId);
    const staleBefore = new Date(asStoredDay(today).getTime() - staleDays * 86_400_000);
    // An active lead with no next step written — a step without a date is
    // still a step (QA19 fixes plan, F04, the same rule as isNextStepMissing).
    const missingNextStep = {
      status: { in: ACTIVE_OUTREACH },
      OR: [{ nextStep: null }, { nextStep: '' }],
    };

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

    // The "Missing next step" filter: the active leads nobody has planned for.
    if (req.query.missingNextStep === 'true') {
      where.AND = [...(where.AND ?? []), missingNextStep];
    }

    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
      base.name = where.name;
    }

    // The facet ignores its OWN dimension and respects every other, which is
    // what makes a chip's number answer "how many would I get if I clicked it".
    const statusFacetWhere = { ...base, ...(where.vertical ? { vertical: where.vertical } : {}) };

    const [entries, total, statusFacets, coldTotal, missingTotal, staleTotal] = await Promise.all([
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
      prisma.outreachEntry.count({ where: { organizationId: orgId, promotedCompanyId: null, deletedAt: null } }),
      prisma.outreachEntry.count({ where: { ...statusFacetWhere, AND: [missingNextStep] } }),
      prisma.outreachEntry.count({
        where: {
          ...statusFacetWhere,
          status: { in: ACTIVE_OUTREACH },
          OR: [{ lastTouchedAt: { lt: staleBefore } }, { lastTouchedAt: null, importedAt: { lt: staleBefore } }],
        },
      }),
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
      entries: entries.map((e) => {
        const active = isActiveOutreach(e.status);
        const touch = leadStaleness(e, staleDays, today);
        const step = nextStepState({ nextStep: e.nextStep, date: e.nextActionDate }, active, today);
        return {
          ...e,
          /** The last touch, or with none recorded, when the lead was added. */
          lastTouchAt: touch.lastTouchAt,
          daysSinceTouch: touch.daysSinceTouch,
          stale: touch.stale,
          noNextStep: step.missing,
          nextStepOverdue: step.overdue,
        };
      }),
      staleDays,
      counts: {
        ALL: statusFacets.reduce((n, f) => n + f._count, 0),
        NOT_CONTACTED: byStatus(OutreachStatus.NOT_CONTACTED),
        FOLLOW_UP: byStatus(OutreachStatus.FOLLOW_UP),
        MEETING: byStatus(OutreachStatus.MEETING),
        INTERESTED: byStatus(OutreachStatus.INTERESTED),
        DEAD: byStatus(OutreachStatus.DEAD),
        MISSING_NEXT_STEP: missingTotal,
      },
      summary: { cold: coldTotal, stale: staleTotal },
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
    /*
     * An industry is chosen, never assumed (QA19 fixes plan, F02). Said in
     * words before the schema runs, which would only answer "Required". A
     * legacy code — 'HEALTHCARE' from an import — is still accepted below.
     */
    const sentIndustry = req.body?.vertical;
    if (typeof sentIndustry !== 'string' || !sentIndustry.trim()) {
      res.status(400).json({ success: false, error: 'Choose an industry for this lead.' });
      return;
    }
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

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'OutreachEntry',
        entityId: entry.id,
        actorId: req.user!.userId,
        verb: 'outreach_added',
        payload: { name: entry.name, source: entry.source, ownerId: entry.ownerId },
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
    // An active lead keeps its next step through an edit (Sales next step
    // plan). Editing is not contact, so the last touch does not move.
    nextStep: z.string().trim().max(300, 'Keep the next step short — a few words').nullable().optional(),
    nextActionDate: z
      .string()
      .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'That date is not a real date')
      .nullable()
      .optional(),
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

    const { name, vertical, source, ownerId, contactPersonName, phone, email, nextStep, nextActionDate } = parsed.data;

    // The next step is optional (2026-10-16); a date given can't be past.
    const pastDate = nextStepDateRefusal(nextActionDate, await studioToday(orgId));
    if (pastDate) {
      res.status(400).json({ success: false, error: pastDate });
      return;
    }
    const step = mergeNextStep({ nextStep: existing.nextStep, date: existing.nextActionDate }, { nextStep, nextStepDate: nextActionDate });

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
        ...(nextStep !== undefined ? { nextStep: step.nextStep } : {}),
        ...(nextActionDate !== undefined ? { nextActionDate: step.date } : {}),
      },
      include: { owner: { select: { id: true, name: true, designation: true } } },
    });

    const changed = changesBetween(existing, entry, [
      'name',
      'vertical',
      'source',
      'ownerId',
      'contactPersonName',
      'phone',
      'email',
      'nextStep',
      'nextActionDate',
    ]);
    if (Object.keys(changed).length > 0) {
      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'OutreachEntry',
          entityId: id,
          actorId: req.user!.userId,
          verb: 'outreach_edited',
          payload: { name: entry.name, changed } as Prisma.InputJsonValue,
        },
      });
    }

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
 *   INTERESTED  neither required.
 *
 * The next step in words is optional on all three (2026-10-16).
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
    /** What happens next, in a few words. Optional (2026-10-16). */
    nextStep: z.string().trim().max(300, 'Keep the next step short — a few words').optional().nullable(),
  })
  .superRefine((v, ctx) => {
    // A callback and a meeting are their date; Interested needs none.
    const needsDate = v.status === OutreachStatus.FOLLOW_UP || v.status === OutreachStatus.MEETING;
    if (needsDate && !v.nextActionDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextActionDate'],
        message: v.status === OutreachStatus.FOLLOW_UP ? 'When are you calling them back?' : 'When is the meeting?',
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

    const { status, remarks, nextActionDate, nextStep } = parsed.data;
    // Follow-up, meeting and interested are worked: they carry a next step.
    const carriesAction = isActiveOutreach(status);
    const pastDate = carriesAction ? nextStepDateRefusal(nextActionDate?.slice(0, 10), await studioToday(orgId)) : null;
    if (pastDate) {
      res.status(400).json({ success: false, error: pastDate });
      return;
    }

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
        nextStep: carriesAction ? nextStep?.trim() || null : null,
        // A status change is contact.
        lastTouchedAt: new Date(),
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
          nextStep: carriesAction ? nextStep?.trim() || null : null,
        },
      },
    });

    res.json({ success: true, entry });
  } catch (error) {
    next(error);
  }
});

// ── 3b. Log a touch, and set the last contact date ──────────────────────────
//
// The same two actions deals have. A touch is contact: how, what was said,
// what happens next — and it moves the last touch to now. "Set last contact
// date" corrects the record (imported names carry the import date); it needs
// no next step and is written to Activity with what it replaced.

outreachRouter.post('/:id/touch', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = touchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const existing = await prisma.outreachEntry.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }
    if (existing.promotedCompanyId) {
      res.status(400).json({ success: false, error: 'This name is already a company. Log it on the company record instead.' });
      return;
    }
    const pastDate = nextStepDateRefusal(parsed.data.nextStepDate, await studioToday(orgId));
    if (pastDate) {
      res.status(400).json({ success: false, error: pastDate });
      return;
    }
    const { channel, note, nextStep, nextStepDate } = parsed.data;
    // Optional: left out, the next step stays as it was; blank, it is cleared.
    const after = mergeNextStep({ nextStep: existing.nextStep, date: existing.nextActionDate }, { nextStep, nextStepDate });
    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.outreachEntry.update({
        where: { id },
        data: {
          lastTouchedAt: new Date(),
          ...(nextStep !== undefined ? { nextStep: after.nextStep } : {}),
          ...(nextStepDate !== undefined ? { nextActionDate: after.date } : {}),
        },
        include: { owner: { select: { id: true, name: true, designation: true } } },
      });
      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'OutreachEntry',
          entityId: id,
          actorId: req.user!.userId,
          verb: 'touch_logged',
          payload: { name: existing.name, channel, note, nextStep, nextStepDate },
        },
      });
      return updated;
    });
    res.status(201).json({ success: true, entry, message: `${CHANNEL_LABEL[channel]} logged.` });
  } catch (error) {
    next(error);
  }
});

outreachRouter.patch('/:id/last-contact', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = lastContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const refusal = lastContactRefusal(parsed.data.lastTouchedAt, await studioToday(orgId));
    if (refusal) {
      res.status(400).json({ success: false, error: refusal });
      return;
    }
    const result = await setLeadLastContact(orgId, req.user!.userId, [String(req.params.id)], parsed.data.lastTouchedAt);
    if (result.updated === 0) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }
    res.json({ success: true, updated: result.updated });
  } catch (error) {
    next(error);
  }
});

/** The same, for several leads at once — an import corrected in one go. */
outreachRouter.post('/last-contact', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = bulkLastContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const refusal = lastContactRefusal(parsed.data.lastTouchedAt, await studioToday(orgId));
    if (refusal) {
      res.status(400).json({ success: false, error: refusal });
      return;
    }
    const result = await setLeadLastContact(orgId, req.user!.userId, parsed.data.ids, parsed.data.lastTouchedAt);
    res.json({ success: true, updated: result.updated });
  } catch (error) {
    next(error);
  }
});

/** Sets the last contact date on this org's leads, one Activity row each with what it replaced. */
async function setLeadLastContact(orgId: string, actorId: string, ids: string[], date: string): Promise<{ updated: number }> {
  const rows = await prisma.outreachEntry.findMany({
    where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
    select: { id: true, name: true, lastTouchedAt: true },
  });
  if (rows.length === 0) return { updated: 0 };
  const at = asStoredDay(date);
  await prisma.$transaction(async (tx) => {
    await tx.outreachEntry.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { lastTouchedAt: at } });
    await tx.activity.createMany({
      data: rows.map((r) => ({
        organizationId: orgId,
        entityType: 'OutreachEntry',
        entityId: r.id,
        actorId,
        verb: 'last_contact_set',
        payload: { name: r.name, from: r.lastTouchedAt ? dayKey(r.lastTouchedAt) : null, to: date },
      })),
    });
  });
  return { updated: rows.length };
}

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
  ownerId: z.string().min(1).optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional().or(z.literal('')),
  /** Carries a NAME warning past. A matching phone or email cannot be forced. */
  force: z.boolean().optional(),
});

// ── Removing a lead, and putting it back ────────────────────────────────────
//
// The list had one way out: mark it Dead. That is the right end for a lead that
// went nowhere — who found them, what was said, when it stopped — and the wrong
// end for a row typed twice, a typo, or a line from a bad import. Those sat in
// the Dead tab pretending to be leads that failed, which makes the one number
// that tab exists to give untrue.
//
// Soft, like everything else a person removes (§16). A promoted lead is refused
// outright: it IS that company's history — where they came from, who found
// them — and the company's own page reads it.

outreachRouter.delete('/:id', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const entry = await prisma.outreachEntry.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, status: true, deletedAt: true, promotedCompanyId: true },
    });
    if (!entry) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }
    if (entry.deletedAt) {
      res.status(400).json({ success: false, error: 'That lead has already been removed.' });
      return;
    }
    if (entry.promotedCompanyId) {
      res.status(400).json({
        success: false,
        error: `${entry.name} was promoted to a company, and this row is where that company came from. Remove the company instead if it should not be there.`,
        code: 'ALREADY_PROMOTED',
      });
      return;
    }

    await prisma.outreachEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'OutreachEntry',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'deleted',
        payload: { name: entry.name, status: entry.status },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// What can be put back — the other half of the delete above, and the reason it
// is a delete rather than a disappearance.
outreachRouter.get('/trash', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const entries = await prisma.outreachEntry.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
      include: { owner: { select: { id: true, name: true } } },
    });
    res.json({ success: true, entries });
  } catch (error) {
    next(error);
  }
});

outreachRouter.post('/:id/restore', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const entry = await prisma.outreachEntry.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, deletedAt: true },
    });
    if (!entry) {
      res.status(404).json({ success: false, error: 'Outreach entry not found' });
      return;
    }
    if (!entry.deletedAt) {
      res.status(400).json({ success: false, error: 'That lead is already on the list.' });
      return;
    }

    const restored = await prisma.outreachEntry.update({ where: { id }, data: { deletedAt: null } });
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'OutreachEntry',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'restored',
        payload: { name: entry.name },
      },
    });

    res.json({ success: true, entry: restored });
  } catch (error) {
    next(error);
  }
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
    const { companyName, city, vertical, ownerId, contactName, contactEmail, contactPhone, force } = parsed.data;

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
       * No proposal is made here.
       *
       * Promoting used to drop an empty deal onto the pipeline at Prospect — no
       * version, no value, kind guessed as Retainer — and every one of them had
       * to be deleted by hand, because the real proposal is written separately
       * when there is something to quote. The company is a Prospect; it reaches
       * the pipeline when somebody writes its proposal.
       */

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
      // A removed row is not a duplicate — re-importing a line somebody deleted
      // is how a mistake gets corrected.
      prisma.outreachEntry.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { name: true } }),
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
      lastTouchedAt: Date | null;
    }[] = [];
    const today = await studioToday(orgId);

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

      /*
       * "Last contacted" — the real date, so an import does not stamp every
       * lead as touched today (Sales next step plan, decision 4). Optional.
       * Accepted as 2026-09-14, 14/09/2026 or 14-09-2026.
       */
      const lastRaw = (row.lastcontacted || row.lastcontact || row.lastcontactdate || '').trim();
      let lastTouchedAt: Date | null = null;
      if (lastRaw) {
        const day = parseImportDay(lastRaw);
        if (!day) {
          results.push({ row: rowNum, name, action: 'INVALID', reason: `"Last contacted" is not a date: "${lastRaw}"` });
          return;
        }
        if (day > today) {
          results.push({ row: rowNum, name, action: 'INVALID', reason: `"Last contacted" is in the future: ${day}` });
          return;
        }
        lastTouchedAt = asStoredDay(day);
      }

      seenInFile.add(key);
      toCreate.push({
        name,
        vertical,
        source,
        contactPersonName: contactPersonName || null,
        phone: phone || null,
        email: email || null,
        lastTouchedAt,
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
          // Every row was REQUIRED to carry a phone or an email above, and then
          // none of the three was written — the import checked for a way to
          // reach the lead and threw it away.
          contactPersonName: r.contactPersonName,
          phone: r.phone,
          email: r.email,
          lastTouchedAt: r.lastTouchedAt,
        })),
      });
      created = outcome.count;

      // One line for the file, not one per name: an import of 300 leads is one
      // thing somebody did.
      if (created > 0) {
        await prisma.activity.create({
          data: {
            organizationId: orgId,
            entityType: 'Organization',
            entityId: orgId,
            actorId: req.user!.userId,
            verb: 'outreach_imported',
            payload: {
              created,
              skipped: results.filter((r) => r.action === 'SKIPPED').length,
              invalid: results.filter((r) => r.action === 'INVALID').length,
              names: toCreate.slice(0, 20).map((r) => r.name),
            },
          },
        });
      }
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

/** A day from a spreadsheet cell: 2026-09-14, 14/09/2026 or 14-09-2026 (day first, as written in India). */
export function parseImportDay(raw: string): string | null {
  const v = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
