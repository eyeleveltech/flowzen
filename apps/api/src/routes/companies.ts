import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest, hasPermission } from '../middleware/auth.js';
import { CompanyStatus, CompanyVertical, CompanySource, PersonRole } from '@prisma/client';
import { checkForDuplicates, checkForImport } from '../services/duplicateCheck.js';
import { parsePagination } from '../utils/query.js';
import { toCsv, parseCsv } from '../utils/csv.js';
import { matchEnumValue, VERTICAL_ALIASES } from '../utils/enums.js';
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
    const where: any = { organizationId: orgId };
    const facetWhere: any = { organizationId: orgId };

    if (status && typeof status === 'string' && ['PROSPECT', 'CLIENT', 'PAST'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase() as CompanyStatus;
    }

    if (vertical && typeof vertical === 'string') {
      where.vertical = vertical as CompanyVertical;
      facetWhere.vertical = vertical as CompanyVertical;
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
      prisma.company.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: true }),
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

    // Fetch activity audit log
    const activities = await prisma.activity.findMany({
      where: { organizationId: orgId, entityId: id },
      orderBy: { at: 'desc' },
      take: 25,
      include: { actor: { select: { id: true, name: true } } },
    });

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
    res.json(verdict);
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

    const results: CompanyImportRow[] = [];
    const toCreate: {
      rowIndex: number;
      name: string;
      vertical: CompanyVertical;
      source: CompanySource;
      city: string;
      website: string | null;
      gstin: string | null;
      billingAddress: string | null;
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

      // Unknown industries fall back rather than failing the row, matching what
      // the single Add Company form does with the same field.
      const vertical =
        matchEnumValue(row.industry || row.vertical, Object.values(CompanyVertical), VERTICAL_ALIASES)
        ?? CompanyVertical.B2B;
      const source = matchEnumValue(row.source, Object.values(CompanySource)) ?? CompanySource.OUTREACH;

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
              ownerId: ownerId || req.user!.userId,
              status: CompanyStatus.PROSPECT,
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
  vertical: z.nativeEnum(CompanyVertical).optional().default(CompanyVertical.B2B),
  source: z.nativeEnum(CompanySource).optional().default(CompanySource.OUTREACH),
  sourceId: z.string().optional().nullable(),
  city: z.string().optional().nullable().default('Chennai'),
  phone: z.string().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  contact: z.object({
    name: z.string(),
    phone: z.string().optional().nullable(),
  }).optional(),
  force: z.boolean().optional(),
  website: z.string().url().optional().or(z.literal('')),
  gstin: z.string().optional().or(z.literal('')),
  billingAddress: z.string().optional().or(z.literal('')),
  ownerId: z.string().optional(),
  status: z.nativeEnum(CompanyStatus).default(CompanyStatus.PROSPECT),
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
      name, vertical, source, city, website, gstin, billingAddress, ownerId, status,
      phone, contact, force
    } = parsed.data;

    // We skip name warning if force is true, but still check exact matches if needed.
    // The check-duplicate route handled the live typing.
    // For safety, check if it already exists exactly.
    const existing = await prisma.company.findUnique({
      where: { organizationId_name: { organizationId: orgId, name: name.trim() } },
    });

    if (existing) {
      res.status(409).json({ success: false, error: `A company named '${name.trim()}' already exists.` });
      return;
    }

    // Use a transaction to create company, person (if any), and initial deal
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          organizationId: orgId,
          name: name.trim(),
          vertical,
          source,
          city: city?.trim() || 'Chennai',
          website: website || null,
          gstin: gstin ? gstin.trim() : null,
          billingAddress: billingAddress ? billingAddress.trim() : null,
          ownerId: ownerId || req.user!.userId,
          status,
        },
      });

      if (contact) {
        await tx.person.create({
          data: {
            companyId: company.id,
            name: contact.name,
            phone: contact.phone || null,
            role: 'CONTACT',
          }
        });
      }

      // Always create a Proposal (Deal) in TALKING stage to put them on the board
      const deal = await tx.proposal.create({
        data: {
          organizationId: orgId,
          companyId: company.id,
          kind: 'PROJECT',
          ownerId: ownerId || req.user!.userId,
          stage: 'TALKING',
        }
      });

      return { company, dealId: deal.id };
    });

    // Record audit activity
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Company',
        entityId: result.company.id,
        actorId: req.user!.userId,
        verb: 'company_created',
        payload: { name: result.company.name, vertical: result.company.vertical, status: result.company.status },
      },
    });

    res.status(201).json({ 
      success: true, 
      data: { ...result.company, dealId: result.dealId } 
    });
  } catch (error) {
    next(error);
  }
});

// ── 4. Update Company Details ───────────────────────────────────────────────

const companyUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  vertical: z.nativeEnum(CompanyVertical).optional(),
  source: z.nativeEnum(CompanySource).optional(),
  city: z.string().optional(),
  website: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
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

    const updated = await prisma.company.update({
      where: { id },
      data: parsed.data,
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

    res.json({ success: true, company: updated });
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
