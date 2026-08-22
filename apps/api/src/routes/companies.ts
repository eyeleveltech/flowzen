/**
 * Companies — one record whether or not they have ever bought (master plan §3.2).
 *
 * There is no separate "lead" endpoint and no conversion step. Winning a deal
 * changes this record's status; it never creates a second one.
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, atLeast, param, requireRole, requireModule, type AuthRequest } from '../middleware/auth.js';
import { checkForDuplicates, normaliseEmail, normalisePhone } from '../services/duplicateCheck.js';
import { statusMeaning } from '../services/companyStatus.js';
import { monthlyValue } from '../services/engagement.service.js';

export const companiesRouter = Router();

companiesRouter.use(authenticate, requireModule('CRM', 'PM'));

const companyInput = z.object({
  name: z.string().min(1, 'A company needs a name.'),
  industry: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  twitterUrl: z.string().optional().nullable(),
  instagramUrl: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  gstNumber: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
});

/**
 * GET /companies — the list. Archived records are hidden, never deleted.
 *
 * A Member sees the clients they are actually working for, not the whole book
 * (§3.10 — their row reads "read — theirs"). Done as a ROW filter rather than a
 * 403, because the plan is explicit that most of the time it should be rows:
 * *"people should see their own world rather than hit walls."* A designer opening
 * a client to read the brief is doing their job; the same designer browsing every
 * client the agency has is not something anyone asked for.
 */
companiesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { status, search, ownerId, industry, state, sourceId, includeArchived } = req.query;
    const userId = req.user!.userId;

    // "Theirs" means work they are on: a project they are a member of, or one
    // holding a task assigned to them. Membership alone is not enough — nobody
    // is added to ProjectMember today, because that endpoint does not exist yet.
    const mine = atLeast(req.user!.role, 'SALES')
      ? {}
      : {
          OR: [
            { projects: { some: { members: { some: { userId } } } } },
            { projects: { some: { tasks: { some: { assigneeId: userId } } } } },
          ],
        };

    const companies = await prisma.company.findMany({
      where: {
        organizationId: orgId,
        ...mine,
        ...(includeArchived === 'true' ? {} : { archivedAt: null }),
        ...(status ? { status: status as Prisma.EnumCompanyStatusFilter['equals'] } : {}),
        ...(ownerId ? { ownerId: String(ownerId) } : {}),
        ...(industry ? { industry: String(industry) } : {}),
        ...(state ? { state: String(state) } : {}),
        ...(sourceId ? { sourceId: String(sourceId) } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: String(search), mode: 'insensitive' as const } },
                { email: { contains: String(search), mode: 'insensitive' as const } },
                { phone: { contains: String(search) } },
              ],
            }
          : {}),
      },
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        source: { select: { id: true, name: true } },
        _count: { select: { deals: true, engagements: true, projects: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    res.json({
      success: true,
      data: companies.map((c) => ({ ...c, statusMeaning: statusMeaning(c.status) })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /companies/check-duplicate — ask before creating.
 *
 * Separate from create so the UI can warn while somebody is still typing, rather
 * than only after they press save.
 */
companiesRouter.post('/check-duplicate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { name, email, phone } = req.body ?? {};
    if (!name) {
      res.status(400).json({ success: false, error: 'A name is needed to check.' });
      return;
    }

    const verdict = checkForDuplicates(
      { name, email, phone },
      await candidatePool(orgId, { name, email, phone }),
    );
    res.json({ success: true, data: verdict });
  } catch (e) {
    next(e);
  }
});

/**
 * Narrow the set the duplicate rule runs against.
 *
 * An exact email or phone is looked up directly; names are compared against a
 * capped recent slice rather than the whole table, because the name rule only
 * WARNS and is not worth a full scan on every keystroke.
 */
const candidatePool = async (
  orgId: string,
  candidate: { name: string; email?: string | null; phone?: string | null },
) => {
  const email = normaliseEmail(candidate.email);
  const phone = normalisePhone(candidate.phone);

  const [exact, recent] = await Promise.all([
    prisma.company.findMany({
      where: {
        organizationId: orgId,
        OR: [
          ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
          ...(phone ? [{ phone: { contains: phone } }] : []),
        ],
      },
      select: { id: true, name: true, email: true, phone: true },
      take: 20,
    }),
    prisma.company.findMany({
      where: { organizationId: orgId, archivedAt: null },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
  ]);

  const seen = new Set(exact.map((c) => c.id));
  return [...exact, ...recent.filter((c) => !seen.has(c.id))];
};

/** POST /companies — create, after the duplicate rule has had its say. */
companiesRouter.post('/', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const parsed = companyInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const input = parsed.data;
    const force = req.body?.force === true;

    const verdict = checkForDuplicates(input, await candidatePool(orgId, input));

    // An exact email or phone match BLOCKS and shows the existing record. A
    // similar name only warns, and `force` carries that warning past (§3.12).
    if (verdict.action === 'BLOCK') {
      res.status(409).json({
        success: false,
        error: 'This company is already in Flowzen.',
        data: verdict,
      });
      return;
    }
    if (verdict.action === 'WARN' && !force) {
      res.status(409).json({
        success: false,
        error: 'A company with a similar name already exists.',
        data: { ...verdict, canForce: true },
      });
      return;
    }

    const company = await prisma.company.create({
      data: {
        organizationId: orgId,
        name: input.name,
        industry: input.industry ?? null,
        website: input.website ?? null,
        email: normaliseEmail(input.email),
        phone: input.phone ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        twitterUrl: input.twitterUrl ?? null,
        instagramUrl: input.instagramUrl ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        zip: input.zip ?? null,
        country: input.country ?? null,
        billingAddress: input.billingAddress ?? null,
        gstNumber: input.gstNumber ?? null,
        companySize: input.companySize ?? null,
        // An owner from the very first moment: every reminder Flowzen sends is
        // addressed to whoever owns the record, so one with nobody named is
        // invisible to all of them. Defaults to whoever created it (§4.4).
        ownerId: input.ownerId ?? req.user!.userId,
        sourceId: input.sourceId ?? null,
        // status is NOT settable here. One function owns it (§3.2).
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        type: 'SYSTEM',
        message: `Company created`,
        userId: req.user!.userId,
        companyId: company.id,
      },
    });

    res.status(201).json({ success: true, data: company });
  } catch (e) {
    next(e);
  }
});

/** GET /companies/:id — everything about one company, in one call. */
companiesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;
    const role = req.user!.role;

    // The same row rule as the list. Without it the filter is decoration: a
    // Member who cannot see a client in the list can still open it by id, and
    // ids are not secret — they are in every URL they legitimately visit.
    const reachable = atLeast(role, 'SALES')
      ? {}
      : {
          OR: [
            { projects: { some: { members: { some: { userId } } } } },
            { projects: { some: { tasks: { some: { assigneeId: userId } } } } },
          ],
        };

    const company = await prisma.company.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId, ...reachable },
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        source: { select: { id: true, name: true } },
        contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        deals: {
          include: { stage: { select: { id: true, name: true, kind: true } } },
          orderBy: { updatedAt: 'desc' },
        },
        engagements: {
          include: { revisions: { orderBy: { effectiveFrom: 'desc' }, take: 5 } },
          orderBy: { startDate: 'desc' },
        },
        projects: { orderBy: { updatedAt: 'desc' } },
        invoices: { orderBy: { issueDate: 'desc' }, take: 20 },
        activities: { include: { user: { select: { name: true } } }, orderBy: { occurredAt: 'desc' }, take: 50 },
      },
    });

    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    // Renewals live HERE, on the company page, rather than on a screen of their
    // own — renewing is a conversation about one relationship (§2).
    const mrr = company.engagements
      .filter((e) => e.status === 'ACTIVE')
      .reduce((sum, e) => sum.add(monthlyValue(e.amount, e.billingFrequency)), new Prisma.Decimal(0));

    // ── The field-level check (§3.10) ────────────────────────────────────────
    //
    // The endpoints that OWN this data are gated — a Member asking for
    // /revenue/invoices is refused. But this page assembles the same figures
    // from the company, so without stripping them here the front door is locked
    // and the side door is open: a Member opening a client to read the brief
    // learned the retainer and every invoice raised against it.
    //
    // Money is the one boundary the whole role design exists to hold, so it is
    // enforced wherever money is ASSEMBLED, not only where it is asked for.
    const { deals, engagements, invoices, activities, ...rest } = company;

    res.json({
      success: true,
      data: {
        ...rest,
        statusMeaning: statusMeaning(company.status),
        contacts: company.contacts,
        projects: company.projects,
        // Deals and quotations are the pipeline, which a Member has no part in.
        deals: atLeast(role, 'SALES') ? deals : [],
        // What a client PAYS is Sales and above. What they are ON — a rolling
        // retainer or a fixed project, running or paused — is not money, and a
        // delivery person needs it: it is the difference between work that keeps
        // arriving and work that ends. So the amounts are stripped and the shape
        // is kept, rather than removing the row and answering "nothing running"
        // for an active client, which is a wrong answer rather than a quiet one.
        engagements: atLeast(role, 'SALES')
          ? engagements
          : engagements.map((e) => ({
              id: e.id,
              type: e.type,
              status: e.status,
              billingFrequency: e.billingFrequency,
              startDate: e.startDate,
              endDate: e.endDate,
              revisions: [],
            })),
        monthlyValue: atLeast(role, 'SALES') ? mrr.toString() : null,
        // What they have been BILLED is Admin only, and this is the only place
        // outside /revenue that carries it.
        invoices: atLeast(role, 'ADMIN') ? invoices : [],
        activities,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** PATCH /companies/:id — status is deliberately not settable. */
companiesRouter.patch('/:id', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const parsed = companyInput.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const existing = await prisma.company.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    const { email, ...rest } = parsed.data;
    const company = await prisma.company.update({
      where: { id: param(req, 'id') },
      data: { ...rest, ...(email !== undefined ? { email: normaliseEmail(email) } : {}) },
    });

    res.json({ success: true, data: company });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /companies/:id — retires rather than erases.
 *
 * Nothing is ever deleted (§5). People come back, and when they do you want the
 * history: who you dealt with, what you charged, why it ended.
 */
companiesRouter.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const company = await prisma.company.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId },
      include: { _count: { select: { engagements: true } } },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    await prisma.company.update({
      where: { id: company.id },
      data: { archivedAt: new Date() },
    });

    res.json({
      success: true,
      data: { archived: true },
      message: 'Company retired. Its history is kept — nothing is deleted in Flowzen.',
    });
  } catch (e) {
    next(e);
  }
});

/** Contacts — the people at a company. */
const contactInput = z.object({
  name: z.string().min(1),
  designation: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  role: z.enum(['DECISION_MAKER', 'CHAMPION', 'INFLUENCER', 'GATEKEEPER']).optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

companiesRouter.post('/:id/contacts', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const parsed = contactInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const company = await prisma.company.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId },
      select: { id: true, _count: { select: { contacts: true } } },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    // The first contact is the primary one by default — a company whose people
    // are all secondary has no main point of contact, which is never true.
    const isPrimary = parsed.data.isPrimary ?? company._count.contacts === 0;

    const contact = await prisma.$transaction(async (tx) => {
      // A partial unique index enforces one primary per company, so the previous
      // one has to stand down first rather than the insert simply failing.
      if (isPrimary) {
        await tx.contact.updateMany({
          where: { companyId: company.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.contact.create({
        data: {
          companyId: company.id,
          name: parsed.data.name,
          designation: parsed.data.designation ?? null,
          email: normaliseEmail(parsed.data.email),
          phone: parsed.data.phone ?? null,
          linkedinUrl: parsed.data.linkedinUrl ?? null,
          role: parsed.data.role ?? null,
          isPrimary,
          notes: parsed.data.notes ?? null,
        },
      });
    });

    res.status(201).json({ success: true, data: contact });
  } catch (e) {
    next(e);
  }
});

companiesRouter.patch('/:id/contacts/:contactId', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const companyId = param(req, 'id');
    const contactId = param(req, 'contactId');

    const parsed = contactInput.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    const existing = await prisma.contact.findFirst({
      where: { id: contactId, companyId: company.id },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Contact not found' });
      return;
    }

    const { email, isPrimary, ...rest } = parsed.data;

    const contact = await prisma.$transaction(async (tx) => {
      if (isPrimary === true && !existing.isPrimary) {
        await tx.contact.updateMany({
          where: { companyId: company.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.contact.update({
        where: { id: contactId },
        data: {
          ...rest,
          ...(email !== undefined ? { email: normaliseEmail(email) } : {}),
          ...(isPrimary !== undefined ? { isPrimary } : {}),
        },
      });
    });

    res.json({ success: true, data: contact });
  } catch (e) {
    next(e);
  }
});

companiesRouter.delete('/:id/contacts/:contactId', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const companyId = param(req, 'id');
    const contactId = param(req, 'contactId');

    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true },
    });
    if (!company) {
      res.status(404).json({ success: false, error: 'Company not found' });
      return;
    }

    const existing = await prisma.contact.findFirst({
      where: { id: contactId, companyId: company.id },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Contact not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.contact.delete({ where: { id: contactId } });

      if (existing.isPrimary) {
        const nextContact = await tx.contact.findFirst({
          where: { companyId: company.id },
          orderBy: { createdAt: 'asc' },
        });
        if (nextContact) {
          await tx.contact.update({
            where: { id: nextContact.id },
            data: { isPrimary: true },
          });
        }
      }
    });

    res.json({ success: true, message: 'Contact removed' });
  } catch (e) {
    next(e);
  }
});
