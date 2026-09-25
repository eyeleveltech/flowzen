import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { canReadActivityType, stripMoney } from '../utils/activityAccess.js';
import { emitToOrganization } from '../sse.js';
import { authenticate, requirePermission, type AuthRequest, hasPermission } from '../middleware/auth.js';
import { CompanyStatus, PersonRole, TaskWorkType, TaskStatus } from '@prisma/client';
import { DEFAULT_INDUSTRY, DEFAULT_LEAD_SOURCE } from '@flowzen/shared';
import { checkForDuplicates, checkForImport } from '../services/duplicateCheck.js';
import { resolveState } from '../services/documentModel.js';
import { parsePagination } from '../utils/query.js';
import { toCsv, parseCsv } from '../utils/csv.js';
import { matchEnumValue, resolveIndustry, resolveLeadSource, industrySchema, leadSourceSchema } from '../utils/enums.js';
import { sendCsv } from '../utils/csvResponse.js';

export const companiesRouter = Router();

// Apply auth to all company routes
companiesRouter.use(authenticate);

// ── 1. List Companies with Tabs & Filters ───────────────────────────────────

companiesRouter.get('/', requirePermission('company.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { status, vertical, ownerId, search } = req.query;
    const orgId = req.user!.organizationId;
    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    // A CSV export means "everything matching the filter", not one page —
    // the brief's own performance ceiling (300ms at 10,000 rows) is the
    // natural bound to use instead of the normal page size.
    const wantsCsv = req.query.format === 'csv';
    const { page, limit, skip, take } = parsePagination(
      req.query,
      wantsCsv ? { defaultLimit: 10000, maxLimit: 10000 } : { defaultLimit: 200, maxLimit: 500 },
    );

    /**
     * `where` narrows the ROWS. `facetWhere` is the same thing without the
     * status filter, because the tab counts sit above the rows and have to
     * describe what each tab WOULD show — a count taken from the filtered rows
     * says every other tab is empty.
     */
    /*
     * Archived companies are gone from every list and every count.
     *
     * `archivedAt` has been on the model since the beginning and search already
     * filtered on it, but nothing set it — so this filter is what makes removing
     * a company mean anything. The duplicate checks further down deliberately do
     * NOT filter: an archived row keeps its name, and the unique index still
     * applies, so a check that ignored them would pass and the insert would fail.
     */
    const where: any = { organizationId: orgId, archivedAt: null };
    const facetWhere: any = { organizationId: orgId, archivedAt: null };

    if (status && typeof status === 'string' && ['PROSPECT', 'CLIENT', 'PAST'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as CompanyStatus;
    }

    if (vertical && typeof vertical === 'string') {
      where.vertical = vertical;
      facetWhere.vertical = vertical;
    }

    if (ownerId && typeof ownerId === 'string') {
      where.ownerId = ownerId;
      facetWhere.ownerId = ownerId;
    }

    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
      facetWhere.name = { contains: search.trim(), mode: 'insensitive' };
    }

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          people: { where: { active: true } },
          retainers: {
            where: { status: 'ACTIVE' },
            select: { id: true, monthlyValue: true, startDate: true, renewalDate: true, status: true },
          },
          projects: {
            where: { status: 'LIVE' },
            select: { id: true, name: true, quotedValue: true, status: true },
          },
          proposals: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              versions: { orderBy: { n: 'desc' }, take: 1 },
            },
          },
        },
      }),
      prisma.company.count({ where }),
    ]);

    const formatted = companies.map((c) => {
      let attentionSentence: string | null = null;

      if (c.status === 'PROSPECT') {
        const latestProp = c.proposals[0];
        if (latestProp) {
          const v = latestProp.versions[0];
          attentionSentence = `Proposal ${v ? `v${v.n}` : ''} in ${latestProp.stage.toLowerCase().replace('_', ' ')}`;
        } else {
          attentionSentence = 'Newly added prospect; no proposal sent yet.';
        }
      } else if (c.status === 'CLIENT') {
        const activeRet = c.retainers[0];
        if (activeRet && activeRet.renewalDate) {
          const daysToRenewal = Math.ceil((new Date(activeRet.renewalDate).getTime() - Date.now()) / (1000 * 3600 * 24));
          if (daysToRenewal <= 45) {
            attentionSentence = `Retainer renewal approaching in ${daysToRenewal} days.`;
          } else if (canSeeFigures) {
            attentionSentence = `Active retainer (₹${Number(activeRet.monthlyValue).toLocaleString('en-IN')}/mo).`;
          } else {
            attentionSentence = 'Active retainer.';
          }
        } else if (c.projects.length > 0) {
          attentionSentence = `${c.projects.length} live project milestone in progress.`;
        }
      } else if (c.status === 'PAST') {
        attentionSentence = c.lostReason ? `Concluded: ${c.lostReason}` : 'Past relationship.';
      }

      const activeRetainer = c.retainers[0]
        ? { ...c.retainers[0], monthlyValue: canSeeFigures ? c.retainers[0].monthlyValue : null }
        : null;

      return {
        id: c.id,
        name: c.name,
        vertical: c.vertical,
        source: c.source,
        city: c.city,
        website: c.website,
        gstin: c.gstin,
        status: c.status,
        owner: c.owner,
        peopleCount: c.people.length,
        primaryContact: c.people[0] || null,
        activeRetainer,
        liveProjectsCount: c.projects.length,
        attentionSentence,
        updatedAt: c.updatedAt,
      };
    });

    if (wantsCsv) {
      const csv = toCsv(formatted, [
        { label: 'Name', value: (c) => c.name },
        { label: 'Vertical', value: (c) => c.vertical },
        { label: 'Source', value: (c) => c.source },
        { label: 'City', value: (c) => c.city },
        { label: 'Status', value: (c) => c.status },
        { label: 'Owner', value: (c) => c.owner?.name },
        { label: 'People', value: (c) => c.peopleCount },
        { label: 'Active retainer/mo', value: (c) => (c.activeRetainer?.monthlyValue != null ? Number(c.activeRetainer.monthlyValue) : '') },
        { label: 'Live projects', value: (c) => c.liveProjectsCount },
        { label: 'Attention', value: (c) => c.attentionSentence ?? '' },
        { label: 'Updated', value: (c) => c.updatedAt.toISOString().slice(0, 10) },
      ]);
      sendCsv(res, `companies-${new Date().toISOString().slice(0, 10)}`, csv);
      return;
    }

    /**
     * The two things on this screen that must NOT move when a tab is clicked.
     *
     * ── What this is fixing ─────────────────────────────────────────────────
     *
     * Every figure on /companies was computed in the browser from the rows
     * this endpoint had just returned — and this endpoint filters. So opening
     * the Client tab left the page holding only clients, and it then reported
     * "Prospect 0", "Past 0", "All 10" and a Prospects tile of 0, on an
     * organisation with 8 prospects. The tabs said they were empty and were
     * still the only way to see the records they claimed not to have.
     *
     * The Contracted Monthly tile was the dangerous one: it fell to ₹0, which
     * is a WRONG NUMBER rather than an absent one — the same mistake the page
     * already guards against for a caller who may not see figures.
     *
     * ── The two shapes ──────────────────────────────────────────────────────
     *
     * `counts` are FACETS. They follow the search (searching narrows what each
     * tab would show) and ignore the status filter (that is the thing being
     * chosen). They label the tabs.
     *
     * `summary` is the state of the business — every client, every prospect,
     * the whole contracted monthly — and follows nothing at all. It is the top
     * strip, and the top strip does not change because somebody is looking at
     * one tab.
     */
    const [facets, orgTotals, retainerTotals, outreachCount] = await Promise.all([
      prisma.company.groupBy({ by: ['status'], where: facetWhere, _count: true }),
      prisma.company.groupBy({ by: ['status'], where: { organizationId: orgId, archivedAt: null }, _count: true }),
      prisma.retainer.aggregate({
        where: { organizationId: orgId, status: 'ACTIVE' },
        _sum: { monthlyValue: true },
        _count: true,
      }),
      // Only the ones NOT yet promoted. An entry that has become a company is
      // in this list, not kept out of it — which is what the tile's own note
      // says — and /outreach hides promoted rows for exactly that reason. The
      // unfiltered count made the two screens disagree, 7 against 5.
      prisma.outreachEntry.count({ where: { organizationId: orgId, promotedCompanyId: null } }),
    ]);

    const tally = (rows: { status: CompanyStatus; _count: number }[]) => {
      const out = { CLIENT: 0, PROSPECT: 0, PAST: 0, ALL: 0 };
      for (const r of rows) {
        out[r.status] = r._count;
        out.ALL += r._count;
      }
      return out;
    };

    const counts = tally(facets as any);
    const org = tally(orgTotals as any);

    // Compute attention sentences and format response
    res.json({
      success: true,
      companies: formatted,
      counts,
      summary: {
        clients: org.CLIENT,
        prospects: org.PROSPECT,
        past: org.PAST,
        total: org.ALL,
        retainerCount: retainerTotals._count,
        // Null, never 0, without `money.figures` — the absence of permission
        // to know a figure is not the figure being zero.
        contractedMonthly: canSeeFigures ? Number(retainerTotals._sum.monthlyValue ?? 0) : null,
        // Was hardcoded to 380 in the page. There are 7.
        outreachCount,
      },
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. Get 4-Tab Company Cockpit Detail ─────────────────────────────────────

companiesRouter.get('/:id', requirePermission('company.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const canSeeFinancials = hasPermission(req.user!, 'money.figures');

    const company = await prisma.company.findFirst({
      where: { id, organizationId: orgId },
      include: {
        owner: { select: { id: true, name: true, email: true, dept: true } },
        people: { orderBy: { createdAt: 'asc' } },
        proposals: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: {
            owner: { select: { id: true, name: true } },
            wonVersion: true,
            versions: { orderBy: { n: 'desc' } },
          },
        },
        proformas: {
          orderBy: { createdAt: 'desc' },
        },
        retainers: {
          orderBy: { createdAt: 'desc' },
          include: {
            monthCards: {
              orderBy: { month: 'desc' },
              include: { invoice: true },
            },
          },
        },
        projects: {
          orderBy: { createdAt: 'desc' },
          include: {
            milestones: { orderBy: { order: 'asc' } },
            invoices: true,
          },
        },
        invoices: {
          orderBy: { raisedAt: 'desc' },
          include: { payments: true },
        },
      },
    });

    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    /*
     * The company's history — including what happened to its records.
     *
     * This asked for rows whose `entityId` is the company, and nothing else
     * logs against a company. Winning a deal, adding a version, marking one
     * lost, starting a retainer, raising an invoice: every one of those is
     * written against the proposal, retainer or invoice it happened to, so the
     * Activity tab on a client showed "created" and a rename, while four real
     * events sat in the table invisible. Carlton Wellness: 1 row shown, 4
     * hidden.
     *
     * Each type is included only for somebody allowed to read that type's
     * history elsewhere — the same map `/activities` enforces — so this does
     * not become the back way into the pipeline for an accounts desk that
     * cannot open the board.
     */
    const companyProposals = await prisma.proposal.findMany({
      // Deleted ones too: "X deleted the proposal" is exactly the kind of thing
      // an audit trail exists for, and the include above drops them.
      where: { organizationId: orgId, companyId: id },
      select: { id: true },
    });

    const scopes: { type: string; ids: string[] }[] = [
      { type: 'Proposal', ids: companyProposals.map((x) => x.id) },
      { type: 'Proforma', ids: company.proformas.map((x) => x.id) },
      { type: 'Project', ids: company.projects.map((x) => x.id) },
      { type: 'Retainer', ids: company.retainers.map((x) => x.id) },
      { type: 'MonthCard', ids: company.retainers.flatMap((r) => r.monthCards.map((m) => m.id)) },
      { type: 'Invoice', ids: company.invoices.map((x) => x.id) },
    ];

    const rows = await prisma.activity.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { entityId: id },
          ...scopes
            .filter((s) => s.ids.length > 0 && canReadActivityType(req, s.type))
            .map((s) => ({ entityType: s.type, entityId: { in: s.ids } })),
        ],
      },
      orderBy: { at: 'desc' },
      // Higher than the old 25 because the trail now spans the whole client
      // rather than the company row alone.
      take: 60,
      include: { actor: { select: { id: true, name: true } } },
    });

    /*
     * And the figures come out for anybody without `money.figures`.
     *
     * The old query returned payloads untouched to anyone holding
     * `company.read` — which BD holds — and a won proposal's payload carries
     * its value. `/activities` has stripped these since it was written; this
     * endpoint never did, and now that it returns invoice and proposal history
     * it would be the wider hole of the two.
     */
    const activities = canSeeFinancials
      ? rows
      : rows.map((a) => ({ ...a, payload: stripMoney(a.payload) }));

    // Strip sensitive financials if user lacks money.figures. This used to
    // stop at invoices/payments — retainer.monthlyValue, project.quotedValue/
    // estimatedCost, proforma.amount and milestone.amount all spread through
    // `...company` unmasked, which is the same leak already closed on
    // /retainers and /projects: company.read (which BD holds, without
    // money.figures) is operational visibility, not a right to see a figure.
    const sanitizedInvoices = company.invoices.map((inv) => ({
      ...inv,
      amount: canSeeFinancials ? inv.amount : undefined,
      payments: inv.payments.map((p) => ({
        ...p,
        amount: canSeeFinancials ? p.amount : undefined,
      })),
    }));

    const sanitizedRetainers = company.retainers.map((r) => ({
      ...r,
      monthlyValue: canSeeFinancials ? r.monthlyValue : null,
      monthCards: r.monthCards.map((m) => ({
        ...m,
        revenue: canSeeFinancials ? m.revenue : null,
        invoice: m.invoice
          ? { ...m.invoice, amount: canSeeFinancials ? m.invoice.amount : undefined }
          : null,
      })),
    }));

    const sanitizedProjects = company.projects.map((p) => ({
      ...p,
      quotedValue: canSeeFinancials ? p.quotedValue : null,
      estimatedCost: canSeeFinancials ? p.estimatedCost : null,
      milestones: p.milestones.map((m) => ({ ...m, amount: canSeeFinancials ? m.amount : null })),
      invoices: p.invoices.map((inv) => ({ ...inv, amount: canSeeFinancials ? inv.amount : undefined })),
    }));

    const sanitizedProformas = company.proformas.map((pf) => ({
      ...pf,
      amount: canSeeFinancials ? pf.amount : null,
    }));

    res.json({
      success: true,
      company: {
        ...company,
        invoices: sanitizedInvoices,
        retainers: sanitizedRetainers,
        projects: sanitizedProjects,
        proformas: sanitizedProformas,
        activities,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. Check Duplicate ────────────────────────────────────────────────────────

companiesRouter.post('/check-duplicate', requirePermission('company.read'), async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, email, phone } = req.body;
    if (typeof name !== 'string') {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const orgId = req.user!.organizationId;

    // We only need the primary contact's email/phone to check against.
    // However, the `ExistingCompany` type expects `email` and `phone` at the top level.
    const existing = await prisma.company.findMany({
      where: { organizationId: orgId },
      select: { 
        id: true, 
        name: true,
        people: {
          take: 1,
          select: { email: true, phone: true }
        }
      }
    });

    const mappedExisting = existing.map(c => ({
      id: c.id,
      name: c.name,
      email: c.people[0]?.email || null,
      phone: c.people[0]?.phone || null
    }));

    const verdict = checkForDuplicates({ name, email, phone }, mappedExisting);
    // `canForce` is part of the contract the client reads — a near-name clash
    // can be overridden, an exact phone or email cannot. Create says the same.
    res.json({ ...verdict, canForce: verdict.action === 'WARN' });
  } catch (error) {
    next(error);
  }
});

// ── 2b. Bulk import from a CSV ──────────────────────────────────────────────
//
// The "Import companies" button and its whole dry-run preview have been in the
// app for months with nothing behind them — `checkForImport` was written for
// exactly this and never called from anywhere, so every "Check the file" 404'd.
//
// The rule is duplicateCheck.ts's, softened for a file (§3.12): an exact email
// or phone match is never imported, however hard you press; a merely SIMILAR
// name is flagged and the person can wave it through with `force`. Nothing is
// written on a dry run.

interface CompanyImportRow {
  row: number;
  name: string;
  action: 'CREATED' | 'SKIPPED' | 'WOULD_CREATE' | 'INVALID';
  reason?: string;
  companyId?: string;
  matches?: { id: string; name: string; reason: string }[];
}

/** A spreadsheet writes "acme.in"; the column wants a URL. */
const asUrl = (raw: string | undefined): string | null => {
  const v = raw?.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
};

/**
 * What the importer reads, as one list.
 *
 * The rules used to exist only as `row.x || row.y` expressions scattered
 * through the loop below, which meant the screen had to describe them from
 * memory — and a column the importer quietly ignores looks identical to one it
 * read, because a silent fallback is not an error. So the template, the on-screen
 * rules and the parser all come from here.
 *
 * `accepts` is every spelling the parser answers to; the first is the one the
 * template uses. Headers are matched with punctuation and case stripped, so
 * "Company Name", "company_name" and "COMPANY NAME" are the same column.
 */
export const IMPORT_COLUMNS = [
  { accepts: ['name', 'company', 'companyname'], required: true,
    note: 'The only column that must have a value. A row without one is reported as invalid.' },
  { accepts: ['status'], required: false,
    note: 'PROSPECT (default), CLIENT for somebody you already work with, or PAST. A CLIENT or PAST row is recorded as a migration, never as a won deal.' },
  { accepts: ['city'], required: false,
    note: 'Defaults to Chennai if left blank — fill it in rather than letting it.' },
  { accepts: ['industry', 'vertical'], required: false,
    note: 'HEALTHCARE, REAL_ESTATE, D2C, SPORTS, IT_AND_SAAS, RETAIL, B2B, HOSPITALITY. Anything unrecognised becomes B2B, so write SaaS rather than "IT & SaaS".' },
  { accepts: ['source'], required: false,
    note: 'OUTREACH (default), REFERRAL, INBOUND, PARTNER_AGENCY or NETWORK.' },
  { accepts: ['contactname', 'contact'], required: false,
    note: 'The person at the company. With an email or phone, this becomes their first contact.' },
  { accepts: ['email'], required: false,
    note: 'An email that already exists on another company means the same customer — that row is never imported, whatever you tick.' },
  { accepts: ['phone', 'mobile', 'contactnumber'], required: false,
    note: 'Same rule as email: an exact match is never imported.' },
  { accepts: ['website'], required: false, note: 'With or without https:// — it is added if missing.' },
  { accepts: ['gstin', 'gst'], required: false,
    note: 'Its first two digits set the place of supply, so an imported client is billable without retyping the state.' },
  { accepts: ['address'], required: false,
    note: 'Joined with city, state and pincode into the billing address.' },
  { accepts: ['state'], required: false, note: 'Part of the billing address.' },
  { accepts: ['pincode', 'zip'], required: false, note: 'Part of the billing address.' },
] as const;

/**
 * The same rules, for the screen to show before somebody picks a file.
 *
 * The modal used to carry its own hand-written list of columns, which had
 * already drifted — it promised `country` and `zip` and said nothing about
 * `status`. A list the server does not own is a list that describes the
 * importer as it was when somebody last remembered to edit it.
 */
companiesRouter.get(
  '/import/rules',
  requirePermission('company.write'),
  (_req: AuthRequest, res: Response) => {
    res.json({
      success: true,
      rules: IMPORT_COLUMNS.map((c) => ({
        column: c.accepts[0],
        also: c.accepts.slice(1),
        required: c.required,
        note: c.note,
      })),
    });
  },
);

/**
 * A file to start from, and the rules written down next to the columns.
 *
 * Offered because the alternative is guessing: the importer accepts thirteen
 * columns under twenty-odd spellings and silently defaults three of them, and
 * none of that is discoverable from an empty file picker.
 */
companiesRouter.get(
  '/import/template',
  requirePermission('company.write'),
  (_req: AuthRequest, res: Response) => {
    const headers = IMPORT_COLUMNS.map((c) => c.accepts[0]);
    const example = [
      'Acme Interiors', 'PROSPECT', 'Chennai', 'REAL_ESTATE', 'REFERRAL',
      'Priya Raman', 'priya@acmeinteriors.in', '9876543210',
      'acmeinteriors.in', '33AAAAA0000A1Z5', 'No. 4, Anna Salai', 'Tamil Nadu', '600002',
    ];
    const second = [
      'Bright Foods', 'CLIENT', 'Coimbatore', 'D2C', 'PARTNER_AGENCY',
      'Suresh Kumar', '', '', '', '', '', 'Tamil Nadu', '',
    ];

    /*
     * The rules ride along as commented rows rather than a second sheet or a
     * separate page, so they cannot be separated from the file they describe.
     * `parseCsv` skips a leading block of `#` lines, so re-uploading this
     * template unchanged imports the two example rows and nothing else.
     */
    const rules = [
      '# Flowzen — company import template',
      '# Fill in one row per COMPANY, not per project or retainer.',
      '# Delete these # lines and the two example rows before importing.',
      '#',
      ...IMPORT_COLUMNS.map((c) => {
        const also = c.accepts.slice(1);
        return `# ${c.accepts[0]}${c.required ? ' (required)' : ''}: ${c.note}${
          also.length ? ` Also accepts: ${also.join(', ')}.` : ''
        }`;
      }),
      '#',
      '# Retainers, project values, fees and dates are NOT imported. Add those in the app.',
      '# Run a dry run first — it reports every row before anything is written.',
    ];

    /*
     * Written by hand rather than through `toCsv`, which takes column
     * descriptors over a row type and prepends a UTF-8 BOM — and the BOM has to
     * be the first bytes of the file, not buried after the rules, or Excel
     * reads the em dashes as mojibake.
     */
    const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = [headers, example, second].map((r) => r.map(cell).join(',')).join('\r\n');

    sendCsv(res, 'flowzen-company-import-template', `﻿${rules.join('\r\n')}\r\n${body}\r\n`);
  },
);

companiesRouter.post('/import', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { csv, dryRun, force, ownerId } = req.body as {
      csv?: string; dryRun?: boolean; force?: boolean; ownerId?: string;
    };

    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      res.status(400).json({ success: false, error: 'No file content received' });
      return;
    }

    const rows = parseCsv(csv);

    // The whole org's companies, each with its first contact — that pair is
    // what checkForImport compares against.
    const existingRaw = await prisma.company.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        people: { select: { email: true, phone: true }, take: 1 },
      },
    });
    const existing = existingRaw.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.people[0]?.email ?? null,
      phone: c.people[0]?.phone ?? null,
    }));

    /*
     * The names the database will not accept twice.
     *
     * `@@unique([organizationId, name])` means an exact repeat is impossible,
     * and the duplicate check below does not know that: it reports a repeated
     * name as a SIMILAR name, which `force` is allowed to wave through. Forcing
     * one then threw P2002 inside the transaction — an opaque 500, and because
     * it is one transaction, every other row in the file was rolled back with
     * it. Somebody re-importing a file to pick up a few new companies lost the
     * lot and was told "Something went wrong".
     *
     * Compared on the raw name rather than the normalised one, because the
     * index is on the raw string: "Acme Ltd" and "Acme" normalise alike but are
     * two perfectly legal rows, and force should still allow that.
     */
    const takenNames = new Set(existingRaw.map((c) => c.name));

    const results: CompanyImportRow[] = [];
    const toCreate: {
      rowIndex: number;
      name: string;
      vertical: string;
      source: string;
      city: string;
      website: string | null;
      gstin: string | null;
      billingAddress: string | null;
      status: CompanyStatus;
      contact: { name: string; email: string | null; phone: string | null } | null;
    }[] = [];

    rows.forEach((row, index) => {
      // The header is row 1, so the first data row is 2 — the number the
      // person is looking at in their spreadsheet.
      const rowNum = index + 2;
      const name = (row.name || row.companyname || row.company || '').trim();

      if (!name) {
        results.push({ row: rowNum, name: '', action: 'INVALID', reason: 'Missing a name' });
        return;
      }

      const email = (row.email || '').trim() || null;
      const phone = (row.phone || row.mobile || row.contactnumber || '').trim() || null;

      const { flagged, matches } = checkForImport({ name, email, phone }, existing);
      if (flagged) {
        const hard = matches.filter((m) => m.reason !== 'name');
        // An email or phone that already exists is the same customer, and no
        // checkbox overrides that. A similar name only might be.
        if (hard.length > 0) {
          results.push({
            row: rowNum,
            name,
            action: 'SKIPPED',
            reason: `Matches an existing ${hard[0].reason} on "${hard[0].name}"`,
            matches: hard,
          });
          return;
        }
        if (!force) {
          // The modal keys its "add these anyway" checkbox off this wording.
          results.push({
            row: rowNum,
            name,
            action: 'SKIPPED',
            reason: `A company with a similar name already exists — "${matches[0].name}"`,
            matches,
          });
          return;
        }
      }

      // An exact repeat is refused whatever `force` says, because the database
      // refuses it too — and finding that out inside the transaction costs
      // everybody else's rows.
      if (takenNames.has(name)) {
        results.push({
          row: rowNum,
          name,
          action: 'SKIPPED',
          reason: 'A company with exactly this name already exists',
        });
        return;
      }
      takenNames.add(name);

      // Unknown industries fall back rather than failing the row, matching what
      // the single Add Company form does with the same field.
      const vertical = resolveIndustry(row.industry || row.vertical);
      const source = resolveLeadSource(row.source);
      /*
       * Whether they are already a client, which the importer used to have no
       * way to say.
       *
       * Every row came in as a PROSPECT, so the first thing anybody importing a
       * real book of business had to do was open all of them and change it by
       * hand — and on the day you start using this, most of your companies ARE
       * clients. The Add Company form has had this since the beginning
       * (`status`, plus the "we already work with them" tick); the file did not.
       */
      const status = matchEnumValue(row.status, Object.values(CompanyStatus)) ?? CompanyStatus.PROSPECT;

      const billingAddress =
        [row.address, row.city, row.state, row.zip || row.pincode, row.country]
          .map((v) => v?.trim())
          .filter(Boolean)
          .join(', ') || null;

      toCreate.push({
        rowIndex: results.length,
        name,
        vertical,
        source,
        city: (row.city || '').trim() || 'Chennai',
        website: asUrl(row.website),
        gstin: (row.gst || row.gstin || '').trim() || null,
        billingAddress,
        status,
        // A name, an email or a phone is enough to be worth keeping as the
        // company's first contact — without one there is nobody to record.
        contact:
          email || phone || row.contactname
            ? { name: (row.contactname || row.contact || name).trim(), email, phone }
            : null,
      });

      results.push({ row: rowNum, name, action: dryRun ? 'WOULD_CREATE' : 'CREATED' });

      // Later rows are checked against earlier ones too, so one file cannot
      // introduce the duplicate it was meant to prevent.
      existing.push({ id: `pending:${rowNum}`, name, email, phone });
    });

    let created = 0;
    if (!dryRun && toCreate.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const r of toCreate) {
          const company = await tx.company.create({
            data: {
              organizationId: orgId,
              name: r.name,
              vertical: r.vertical,
              source: r.source,
              city: r.city,
              website: r.website,
              gstin: r.gstin,
              billingAddress: r.billingAddress,
              // The importer has no state column, but a GSTIN carries one in
              // its first two digits — so an imported client that will later be
              // billed starts with the right place of supply rather than none.
              stateName: resolveState({ gstin: r.gstin }).name,
              stateCode: resolveState({ gstin: r.gstin }).code,
              ownerId: ownerId || req.user!.userId,
              status: r.status,
              ...(r.contact
                ? {
                    people: {
                      create: {
                        name: r.contact.name,
                        email: r.contact.email,
                        phone: r.contact.phone,
                        role: PersonRole.CONTACT,
                      },
                    },
                  }
                : {}),
            },
          });
          /*
           * A record of where these came from, which an import used to leave no
           * trace of at all.
           *
           * Twenty-two companies appearing in one second with nothing in the
           * activity log is indistinguishable from twenty-two somebody typed,
           * and the distinction matters most for the ones that arrive already a
           * CLIENT: §3 makes status derived — a company is a client because a
           * proposal was WON — so a client that predates Flowzen is a
           * migration, not a win, and the pipeline figures must never read it
           * as one. That is the same reasoning as the Add Company form's
           * `existingClient` tick, and the same verb.
           */
          await tx.activity.create({
            data: {
              organizationId: orgId,
              entityType: 'Company',
              entityId: company.id,
              actorId: req.user!.userId,
              verb: r.status === CompanyStatus.PROSPECT ? 'company_created' : 'company_migrated',
              payload: {
                name: company.name,
                vertical: company.vertical,
                status: company.status,
                imported: true,
                ...(r.status === CompanyStatus.PROSPECT ? {} : { existingClient: true }),
              },
            },
          });

          results[r.rowIndex].companyId = company.id;
          created += 1;
        }
      });
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

// ── 3. Create Company ───────────────────────────────────────────────────────

const companyCreateSchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  vertical: industrySchema.optional().default(DEFAULT_INDUSTRY),
  source: leadSourceSchema.optional().default(DEFAULT_LEAD_SOURCE),
  sourceId: z.string().optional().nullable(),
  city: z.string().optional().nullable().default('Chennai'),
  phone: z.string().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  contact: z.object({
    name: z.string(),
    phone: z.string().optional().nullable(),
    /*
     * The address a proforma is sent to.
     *
     * `Person.email` has always existed and this form never asked, so a client
     * added here had a name and a phone and no way to be emailed. Raising a
     * proforma then offered an empty recipient list -- documentEmail builds it
     * from the company's people -- and somebody had to go back and add the
     * contact a second time before anything could go out.
     */
    email: z.string().email('That does not look like an email address').optional().or(z.literal('')),
  }).optional(),
  force: z.boolean().optional(),
  website: z.string().url().optional().or(z.literal('')),
  gstin: z.string().optional().or(z.literal('')),
  billingAddress: z.string().optional().or(z.literal('')),
  /**
   * CR-02 §3. Either half is enough — the code alone, or the state name —
   * and whichever arrives, both are resolved and stored so the two can never
   * disagree on a document. This is the field that decides CGST+SGST vs IGST,
   * which used to be read off the GSTIN and so silently defaulted a client
   * without one to the seller's own state.
   */
  stateName: z.string().optional().or(z.literal('')),
  stateCode: z.string().max(2).optional().or(z.literal('')),
  ownerId: z.string().optional(),
  status: z.nativeEnum(CompanyStatus).default(CompanyStatus.PROSPECT),
  /**
   * "We already work with them" — a migration, not a win.
   *
   * §3 makes a company's status derived: it becomes a CLIENT because a
   * proposal was won, which is what stops "clients" existing who never bought
   * anything. That rule is right for new business and has no answer for the
   * day you start using this, when every client you have predates the system —
   * and without one, recording a two-year-old retainer meant inventing a
   * proposal, dating it, and winning it, which puts fiction in the win rate.
   *
   * So this is the exception, named. It only changes which activity verb is
   * written, so a migrated client is distinguishable from a won one forever
   * after; the status itself rides on `status` above.
   */
  existingClient: z.boolean().optional(),
});

companiesRouter.post('/', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = companyCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const {
      name, vertical, source, sourceId, city, website, gstin, billingAddress, stateName, stateCode, ownerId, status,
      phone, followUpDate, contact, force, existingClient
    } = parsed.data;

    const ownerUserId = ownerId || req.user!.userId;

    /**
     * Where they came from.
     *
     * The form posts `sourceId`, because /config publishes the list as
     * `{ id, name }` — and the ids ARE the CompanySource values. Nothing read
     * it, so every company added through the form was stored as OUTREACH
     * whatever the person picked. `source` stays accepted for API callers that
     * send the enum directly; the form's value wins when both arrive.
     */
    const resolvedSource = (sourceId && resolveLeadSource(sourceId)) || source;

    // Whichever half of the state arrived, both are stored — and a GSTIN on
    // its own is enough, since its first two digits are the state code.
    const resolvedState = resolveState({ code: stateCode, name: stateName, gstin });

    /**
     * The same verdict the live check returns, applied at the point of writing.
     *
     * Before this, create ran one exact-name lookup and replied with a bare
     * sentence. The client expects a DuplicateVerdict — `{ action, matches }`
     * — so it could not read the refusal, could not show what was clashed
     * with, and `force` (destructured and then never used) could not let a
     * warned name through. A near-name clash is a WARNING somebody can
     * override; a matching phone is the same company and cannot be.
     */
    const others = await prisma.company.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, people: { take: 1, select: { email: true, phone: true } } },
    });

    const verdict = checkForDuplicates(
      { name, phone: phone ?? contact?.phone ?? null },
      others.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.people[0]?.email || null,
        phone: c.people[0]?.phone || null,
      })),
    );

    if (verdict.action === 'BLOCK' || (verdict.action === 'WARN' && !force)) {
      // Under `data`, because that is where the client's ApiError reads a
      // structured body from. Spread at the top level it arrived as undefined
      // and the modal fell through to its generic error line.
      res.status(409).json({
        success: false,
        error: 'This looks like a company you already have.',
        data: { ...verdict, canForce: verdict.action === 'WARN' },
      });
      return;
    }

    // The unique constraint is on (organizationId, name), so an exact repeat
    // cannot be forced past no matter what the verdict said.
    const existing = await prisma.company.findUnique({
      where: { organizationId_name: { organizationId: orgId, name: name.trim() } },
    });

    if (existing) {
      res.status(409).json({
        success: false,
        error: `A company named '${name.trim()}' already exists.`,
        data: {
          action: 'BLOCK',
          canForce: false,
          matches: [{ id: existing.id, name: existing.name, reason: 'name', matchedOn: existing.name }],
        },
      });
      return;
    }

    // Use a transaction to create company, person (if any), and initial deal
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          organizationId: orgId,
          name: name.trim(),
          vertical,
          source: resolvedSource,
          city: city?.trim() || 'Chennai',
          website: website || null,
          gstin: gstin ? gstin.trim() : null,
          billingAddress: billingAddress ? billingAddress.trim() : null,
          stateName: resolvedState.name,
          stateCode: resolvedState.code,
          ownerId: ownerUserId,
          status,
        },
      });

      /**
       * The phone number, kept.
       *
       * Contact details live on Person in this model, and a Person was only
       * written when a contact NAME was typed — so a phone given on its own
       * (the common case: somebody reads you a number) was accepted by the
       * validator, destructured, and dropped. It is also what duplicate
       * detection matches on, so losing it silently weakened that too.
       */
      const contactName = contact?.name?.trim();
      const contactPhone = contact?.phone || phone || null;
      const contactEmail = contact?.email?.trim() || null;
      // Any one of the three is a contact worth keeping. Guarding on name and
      // phone alone would drop an email given on its own, which is the same
      // way the phone itself used to be lost.
      if (contactName || contactPhone || contactEmail) {
        await tx.person.create({
          data: {
            companyId: company.id,
            name: contactName || name.trim(),
            phone: contactPhone,
            email: contactEmail,
            role: PersonRole.CONTACT,
          },
        });
      }

      /*
       * Adding a company no longer opens a proposal.
       *
       * It used to open one unconditionally, in a TALKING stage, so that the
       * company "went on the board". What went on the board was a proposal
       * with no version -- no value, no scope, nothing quoted -- carrying the
       * client's name. It could not be advanced either: the stage route
       * refuses a manual change and the board rejects any card dropped on
       * Proposal sent, so the one move it needed was the one it could not
       * make. Quoting the client called POST /proposals, which writes a
       * SECOND row, and the first stayed behind as a permanent empty card.
       *
       * The pipeline is a list of proposals. A company is not a proposal, and
       * it appears there when somebody actually sends a number.
       */

      /**
       * "Follow up on" — the reason the lead ever gets called again.
       *
       * Accepted and thrown away before this: there is no followUpDate column
       * anywhere in the schema, so the field the form calls "the one field that
       * stops a lead being forgotten" guaranteed exactly that. A follow-up is a
       * TASK here — that is how a logged meeting already raises its next step,
       * and tasks are what My Work and the alerts actually read.
       */
      let followUpTaskId: string | null = null;
      if (followUpDate) {
        const followUp = await tx.task.create({
          data: {
            organizationId: orgId,
            title: `Follow up — ${company.name}`,
            workType: TaskWorkType.INTERNAL,
            assigneeId: ownerUserId,
            createdById: req.user!.userId,
            assignedById: req.user!.userId,
            dueDate: new Date(followUpDate),
            assignedAt: new Date(),
            status: TaskStatus.TODO,
            // A task with no join row belongs to nobody — My Work and a
            // person's load both read this, not `assigneeId`.
            assignees: { create: { userId: ownerUserId } },
          },
        });
        followUpTaskId = followUp.id;
      }

      return { company, followUpTaskId };
    });

    // Record audit activity
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Company',
        entityId: result.company.id,
        actorId: req.user!.userId,
        // A client brought in from before Flowzen is not a deal anybody won,
        // and the pipeline figures must never read it as one.
        verb: existingClient ? 'company_migrated' : 'company_created',
        payload: {
          name: result.company.name,
          vertical: result.company.vertical,
          status: result.company.status,
          ...(existingClient ? { existingClient: true } : {}),
        },
      },
    });

    emitToOrganization(orgId, 'lead:updated', { companyId: result.company.id });

    res.status(201).json({
      success: true,
      data: { ...result.company, followUpTaskId: result.followUpTaskId },
    });
  } catch (error) {
    next(error);
  }
});

// ── 4. Update Company Details ───────────────────────────────────────────────

const companyUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  vertical: industrySchema.optional(),
  source: leadSourceSchema.optional(),
  city: z.string().optional(),
  website: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  stateName: z.string().optional().nullable(),
  stateCode: z.string().max(2).optional().nullable(),
  ownerId: z.string().optional().nullable(),
  status: z.nativeEnum(CompanyStatus).optional(),
  lostReason: z.string().optional().nullable(),
});

companiesRouter.patch('/:id', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = companyUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const company = await prisma.company.findFirst({ where: { id, organizationId: orgId } });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    // Sent as a name, a code, or neither — stored as both, or as neither.
    // Storing only what was typed is how a company ends up with the state
    // "Karnataka" and the code 33.
    const stateTouched = parsed.data.stateName !== undefined || parsed.data.stateCode !== undefined;

    /*
     * `!== undefined`, not `??`.
     *
     * An explicit null is somebody CLEARING the state. `??` read that as "not
     * supplied" and put the old value straight back, so a state set wrongly
     * could never be removed — and it went on deciding CGST+SGST against IGST
     * on every document for that client.
     */
    const nextCode = parsed.data.stateCode !== undefined ? parsed.data.stateCode : company.stateCode;
    const nextName = parsed.data.stateName !== undefined ? parsed.data.stateName : company.stateName;

    /*
     * Emptying either half clears the state, unless the other half arrives with
     * a real value in the same request.
     *
     * The form has ONE state control and it sends the code, so clearing it
     * arrives as `{ stateCode: null }` with no name at all. Keeping the stored
     * name and resolving from it would put the code straight back — the same
     * bug as the `??` above, one step further along.
     */
    const emptied =
      (parsed.data.stateCode !== undefined && !parsed.data.stateCode) ||
      (parsed.data.stateName !== undefined && !parsed.data.stateName);
    const supplied = Boolean(parsed.data.stateCode) || Boolean(parsed.data.stateName);

    const resolvedState = !stateTouched
      ? null
      : emptied && !supplied
        ? { code: null, name: null }
        : // The GSTIN is deliberately not consulted. It is a fallback for a
          // company that has never had a state, not a reason to refuse to let
          // go of one.
          resolveState({ code: nextCode, name: nextName });

    const updated = await prisma.company.update({
      where: { id },
      data: {
        ...parsed.data,
        ...(resolvedState ? { stateName: resolvedState.name, stateCode: resolvedState.code } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Company',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'company_updated',
        payload: parsed.data as any,
      },
    });

    emitToOrganization(req.user!.organizationId, 'lead:updated', { companyId: updated.id });

    res.json({ success: true, company: updated });
  } catch (error) {
    next(error);
  }
});

// ── Archiving a company ─────────────────────────────────────────────────────

/**
 * Take a company off the books, if there is nothing on it.
 *
 * There was no way to remove one at all. A company added by mistake — a typo, a
 * duplicate, a lead that turned out to be somebody else's — stayed for ever.
 * `archivedAt` has existed on the model since the beginning and search already
 * excludes archived rows, but nothing ever set it: half a feature, with the
 * reading half live.
 *
 * ─── Archived, not deleted ──────────────────────────────────────────────────
 *
 * §16: nothing is hard deleted by a user. The row stays, its history stays, and
 * it leaves the lists.
 *
 * ─── What blocks it ─────────────────────────────────────────────────────────
 *
 * Any real work: a retainer, a project, an invoice, a proforma, or a proposal
 * somebody has actually quoted. Those are records with money and dates in them,
 * and a company is the only thing tying them to a client — removing it would
 * leave a retainer nothing can render.
 *
 * A Prospect-stage proposal with NO versions is not work. It is the placeholder
 * created when a lead is promoted, carrying no quote and no value, and blocking
 * on it would make every prospect undeletable — which is the trap the stage
 * before this one fell into. It goes with the company.
 *
 * When something does block, the answer is not to force it through: mark them a
 * PAST client, which keeps every invoice and project intact and takes them out
 * of the active list. The message says so rather than leaving the person to
 * guess.
 */
companiesRouter.delete('/:id', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const company = await prisma.company.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, status: true, archivedAt: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }
    if (company.archivedAt) {
      res.status(400).json({ success: false, error: 'That company has already been removed.' });
      return;
    }

    const [retainers, projects, invoices, proformas, quoted] = await Promise.all([
      prisma.retainer.count({ where: { companyId: id } }),
      prisma.project.count({ where: { companyId: id } }),
      prisma.invoice.count({ where: { companyId: id } }),
      prisma.proforma.count({ where: { companyId: id } }),
      // A proposal that has been quoted. The empty Prospect placeholder does
      // not count — see the note above.
      prisma.proposal.count({ where: { companyId: id, deletedAt: null, versions: { some: {} } } }),
    ]);

    const held = [
      [retainers, retainers === 1 ? 'retainer' : 'retainers'],
      [projects, projects === 1 ? 'project' : 'projects'],
      [invoices, invoices === 1 ? 'invoice' : 'invoices'],
      [proformas, proformas === 1 ? 'proforma' : 'proformas'],
      [quoted, quoted === 1 ? 'proposal' : 'proposals'],
    ].filter(([n]) => (n as number) > 0) as [number, string][];

    if (held.length > 0) {
      const list = held.map(([n, word]) => `${n} ${word}`).join(', ');
      res.status(400).json({
        success: false,
        error:
          `${company.name} has ${list}. A company with work on it is not removed — ` +
          `mark them a past client instead, which keeps all of it and takes them out of the active list.`,
        code: 'HAS_WORK',
        held: Object.fromEntries(held.map(([n, word]) => [word, n])),
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // The placeholder deal, which exists only to put the company on the board.
      await tx.proposal.deleteMany({ where: { companyId: id, versions: { none: {} } } });
      await tx.company.update({ where: { id }, data: { archivedAt: new Date() } });
      await tx.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Company',
          entityId: id,
          actorId: req.user!.userId,
          verb: 'company_archived',
          payload: { name: company.name, status: company.status },
        },
      });
    });

    emitToOrganization(orgId, 'lead:updated', { companyId: id });
    res.json({ success: true, archived: true });
  } catch (error) {
    next(error);
  }
});


// ── 5. Add / Update Contact Person (Person) ─────────────────────────────────

const personSchema = z.object({
  name: z.string().min(1, 'Contact name is required'),
  role: z.nativeEnum(PersonRole).default(PersonRole.CONTACT),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  linkedin: z.string().optional().or(z.literal('')),
});

companiesRouter.post('/:id/people', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = personSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const company = await prisma.company.findFirst({ where: { id, organizationId: orgId } });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    const person = await prisma.person.create({
      data: {
        companyId: id,
        name: parsed.data.name.trim(),
        role: parsed.data.role,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        linkedin: parsed.data.linkedin || null,
      },
    });

    // Who a company's approver and payer are is exactly the kind of thing that
    // gets quietly changed and then argued about. Creating the company was
    // recorded and adding the person to it was not, so the Audit Trail showed
    // a company appearing with contacts that nobody added.
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Company',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'person_added',
        payload: { personId: person.id, name: person.name, role: person.role },
      },
    });

    res.status(201).json({ success: true, person });
  } catch (error) {
    next(error);
  }
});

companiesRouter.patch('/:id/people/:personId', requirePermission('company.write'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = personSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const personId = String(req.params.personId);

    // The company in the URL was being ignored entirely, and so was the
    // organisation: this edited any Person row anywhere by id alone. A cuid is
    // hard to guess but it does not have to be guessed — it comes back in every
    // company payload — and "hard to guess" was never a permission. Prove the
    // contact belongs to a company in the caller's org, the way POST does
    // directly above.
    const person = await prisma.person.findFirst({
      where: { id: personId, companyId: id, company: { organizationId: orgId } },
      select: { id: true },
    });

    if (!person) {
      res.status(404).json({ success: false, error: 'Contact not found' });
      return;
    }

    const updated = await prisma.person.update({
      where: { id: personId },
      data: parsed.data,
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Company',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'person_updated',
        payload: { personId, fields: Object.keys(parsed.data) },
      },
    });

    res.json({ success: true, person: updated });
  } catch (error) {
    next(error);
  }
});
