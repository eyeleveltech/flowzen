import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, hasPermission, type AuthRequest } from '../middleware/auth.js';
import { encryptSecret } from '../utils/crypto.js';
import { resolveMailConfig, sendMail } from '../utils/mailer.js';

export const configRouter = Router();

configRouter.use(authenticate);

configRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }


    // WHO IS ASKING decides how much of this comes back.
    //
    // Every signed-in person needs the handful of fields that format a date and
    // an amount. Everything else here is the organisation's own paperwork —
    // its GSTIN, its postal address, its mail server, and its BANK ACCOUNT
    // NUMBER AND IFSC — which was going to everybody, including an employee
    // whose entire app is one screen of their own tasks. Nothing outside
    // Settings' own admin-only tabs ever read it.
    const canSeeSetup = hasPermission(req.user!, 'setup.admin');

    const payload = {
      organization: {
        // ── Everybody: what a screen needs to render a number or a date ──
        id: org.id,
        name: org.name,
        currency: org.currency || 'INR',
        timezone: org.timezone || 'Asia/Kolkata',
        locale: 'en-IN',
        dateFormat: 'DD/MM/YYYY',
        fiscalYearStart: org.financialYearStart || 4,

        // ── setup.admin: the Organisation and Tax tabs, and nothing else ──
        ...(canSeeSetup
          ? {
              documentPrefix: org.proformaPrefix || 'EL/PI',
              state: org.state,
              gstNumber: org.gstNumber,
              website: org.website,
              phone: org.phone,
              address: org.address,
              mailFromName: org.mailFromName || org.name,
              mailFromEmail: org.mailFromEmail,
              mailReplyTo: org.mailReplyTo,
              allowPasswordLogin: org.allowPasswordLogin,
              // The first part of every asset tag. setup.admin because it is a
              // decision made once and printed on stickers, not a display
              // setting every screen needs.
              assetTagPrefix: org.assetTagPrefix,
            }
          : {}),
      },
      // The letterhead a proforma PDF prints — bank details included. The PDF
      // is rendered on the server (services/proformaPdf.ts), so the only client
      // that ever needed these is the admin form that edits them.
      ...(canSeeSetup
        ? {
            documentSettings: {
              contactEmail: org.contactEmail,
              gstStateCode: org.gstStateCode,
              defaultPaymentTerms: org.defaultPaymentTerms,
              defaultProformaValidityDays: org.defaultProformaValidityDays,
              defaultTermsAndConditions: org.defaultTermsAndConditions,
              bankAccountHolderName: org.bankAccountHolderName,
              bankName: org.bankName,
              bankBranch: org.bankBranch,
              bankAccountNumber: org.bankAccountNumber,
              bankIfscCode: org.bankIfscCode,
            },
            mailConfigured: Boolean(await resolveMailConfig(orgId)),
          }
        : {}),
      // Reference lists every screen needs to label a stage or a vertical.
      stages: [
        { id: 'TALKING', name: 'Talking', order: 1, kind: 'OPEN' },
        { id: 'PROPOSAL_SENT', name: 'Proposal Sent', order: 2, kind: 'OPEN' },
        { id: 'IN_NEGOTIATION', name: 'In Negotiation', order: 3, kind: 'OPEN' },
        { id: 'PROFORMA_ISSUED', name: 'Proforma Issued', order: 4, kind: 'OPEN' },
        { id: 'VERBAL_YES', name: 'Verbal Yes', order: 5, kind: 'OPEN' },
        { id: 'WON', name: 'Won', order: 6, kind: 'WON' },
      ],
      lostReasons: [],
      sources: [
        { id: 'OUTREACH', name: 'Outreach' },
        { id: 'REFERRAL', name: 'Referral' },
        { id: 'INBOUND', name: 'Inbound' },
        { id: 'PARTNER_AGENCY', name: 'Partner Agency' },
        { id: 'NETWORK', name: 'Network' },
      ],
      services: [],
      me: {
        userId: req.user!.userId,
        preset: req.user!.preset,
        // What the client gates on. `role`/`roles` used to ride along here as
        // well, for a ladder nothing scores against any more.
        permissions: req.user!.permissions,
      },
      verticals: [
        'HEALTHCARE',
        'REAL_ESTATE',
        'D2C',
        'SPORTS',
        'IT_AND_SAAS',
        'RETAIL',
        'B2B',
        'HOSPITALITY',
      ],
    };

    res.json(payload);
  } catch (e) {
    next(e);
  }
});

// ── Update organisation identity ────────────────────────────────────────────
//
// Settings' "Organisation" tab has always posted this shape (name, website,
// phone, address, state, gstNumber, currency, timezone, locale,
// documentPrefix, fiscalYearStart, mailFromName/Email, allowPasswordLogin) —
// there was no route here to receive it, so every save silently 404'd.

const orgUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  website: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  gstNumber: z.string().optional().nullable(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  documentPrefix: z.string().optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  mailFromName: z.string().optional().nullable(),
  mailFromEmail: z.string().email().optional().or(z.literal('')).nullable(),
  allowPasswordLogin: z.boolean().optional(),
  assetTagPrefix: z.string().min(1).max(12).optional(),
});

configRouter.patch('/', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = orgUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const data = parsed.data;

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.website !== undefined ? { website: data.website || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
        ...(data.address !== undefined ? { address: data.address || null } : {}),
        ...(data.state !== undefined ? { state: data.state || null } : {}),
        ...(data.gstNumber !== undefined ? { gstNumber: data.gstNumber || null } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.documentPrefix !== undefined ? { proformaPrefix: data.documentPrefix } : {}),
        ...(data.fiscalYearStart !== undefined ? { financialYearStart: data.fiscalYearStart } : {}),
        ...(data.mailFromName !== undefined ? { mailFromName: data.mailFromName || null } : {}),
        ...(data.mailFromEmail !== undefined ? { mailFromEmail: data.mailFromEmail || null } : {}),
        ...(data.allowPasswordLogin !== undefined ? { allowPasswordLogin: data.allowPasswordLogin } : {}),
        ...(data.assetTagPrefix !== undefined ? { assetTagPrefix: data.assetTagPrefix.replace(/\/+$/, '') } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Organization',
        entityId: orgId,
        actorId: req.user!.userId,
        verb: 'organisation_updated',
        payload: { fields: Object.keys(data) },
      },
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── Mail settings ────────────────────────────────────────────────────────────
//
// Its own admin-only route, not folded into GET / — the mail server is
// infrastructure, not a display setting everyone signed in receives.

configRouter.get('/mail', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    const resolved = await resolveMailConfig(orgId);
    res.json({
      smtpHost: org.smtpHost,
      smtpPort: org.smtpPort,
      smtpUser: org.smtpUser,
      mailFromName: org.mailFromName,
      mailFromEmail: org.mailFromEmail,
      mailReplyTo: org.mailReplyTo,
      hasPassword: Boolean(org.smtpPasswordEncrypted),
      configured: Boolean(resolved),
      via: resolved?.via ?? null,
      from: resolved?.from ?? null,
    });
  } catch (e) {
    next(e);
  }
});

const mailSettingsSchema = z.object({
  smtpHost: z.string().optional().nullable(),
  smtpPort: z.number().int().positive().optional().nullable(),
  smtpUser: z.string().optional().nullable(),
  /** Blank means "keep what is stored" — see MailTab.tsx's own note on this. */
  smtpPassword: z.string().optional().nullable(),
  mailFromName: z.string().optional().nullable(),
  mailFromEmail: z.string().email().optional().or(z.literal('')).nullable(),
  mailReplyTo: z.string().email().optional().or(z.literal('')).nullable(),
});

configRouter.patch('/mail', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = mailSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const data = parsed.data;

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.smtpHost !== undefined ? { smtpHost: data.smtpHost || null } : {}),
        ...(data.smtpPort !== undefined ? { smtpPort: data.smtpPort } : {}),
        ...(data.smtpUser !== undefined ? { smtpUser: data.smtpUser || null } : {}),
        ...(data.smtpPassword ? { smtpPasswordEncrypted: encryptSecret(data.smtpPassword) } : {}),
        ...(data.mailFromName !== undefined ? { mailFromName: data.mailFromName || null } : {}),
        ...(data.mailFromEmail !== undefined ? { mailFromEmail: data.mailFromEmail || null } : {}),
        ...(data.mailReplyTo !== undefined ? { mailReplyTo: data.mailReplyTo || null } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'Organization',
        entityId: orgId,
        actorId: req.user!.userId,
        verb: 'mail_settings_updated',
        payload: { fields: Object.keys(data).filter((k) => k !== 'smtpPassword') },
      },
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

configRouter.post('/mail/test', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const to = (req.body?.to as string) || user.email;

    await sendMail(orgId, {
      to,
      subject: 'Flowzen — this is a test',
      html: `<p>If you're reading this, outbound mail from Flowzen works.</p><p>Sent to ${to}.</p>`,
      text: `If you're reading this, outbound mail from Flowzen works. Sent to ${to}.`,
    });

    res.json({ success: true, data: { to }, message: `Sent to ${to}.` });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not send the test message';
    res.status(400).json({ success: false, error: 'The test did not go through.', detail: message });
  }
});

// ── Update document settings ────────────────────────────────────────────────
//
// Setup.admin only — this is exactly the letterhead the brief's Setup screen
// (§10: "numbering") describes. Kept separate from the broader organisation
// PATCH the UI doesn't have wired up yet, so this can ship without waiting
// on the rest of that screen.

const documentSettingsSchema = z.object({
  contactEmail: z.string().email().optional().or(z.literal('')).nullable(),
  gstStateCode: z.string().length(2).optional().nullable(),
  defaultPaymentTerms: z.string().min(1).optional(),
  defaultProformaValidityDays: z.number().int().min(1).max(365).optional(),
  defaultTermsAndConditions: z.array(z.string().min(1)).optional(),
  bankAccountHolderName: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankBranch: z.string().optional().nullable(),
  bankAccountNumber: z.string().optional().nullable(),
  bankIfscCode: z.string().optional().nullable(),
});

configRouter.patch(
  '/document-settings',
  requirePermission('setup.admin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = documentSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }

      const orgId = req.user!.organizationId;
      const data = parsed.data;

      const updated = await prisma.organization.update({
        where: { id: orgId },
        data: {
          ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail || null } : {}),
          ...(data.gstStateCode !== undefined ? { gstStateCode: data.gstStateCode } : {}),
          ...(data.defaultPaymentTerms !== undefined ? { defaultPaymentTerms: data.defaultPaymentTerms } : {}),
          ...(data.defaultProformaValidityDays !== undefined ? { defaultProformaValidityDays: data.defaultProformaValidityDays } : {}),
          ...(data.defaultTermsAndConditions !== undefined ? { defaultTermsAndConditions: data.defaultTermsAndConditions } : {}),
          ...(data.bankAccountHolderName !== undefined ? { bankAccountHolderName: data.bankAccountHolderName } : {}),
          ...(data.bankName !== undefined ? { bankName: data.bankName } : {}),
          ...(data.bankBranch !== undefined ? { bankBranch: data.bankBranch } : {}),
          ...(data.bankAccountNumber !== undefined ? { bankAccountNumber: data.bankAccountNumber } : {}),
          ...(data.bankIfscCode !== undefined ? { bankIfscCode: data.bankIfscCode } : {}),
        },
      });

      await prisma.activity.create({
        data: {
          organizationId: orgId,
          entityType: 'Organization',
          entityId: orgId,
          actorId: req.user!.userId,
          verb: 'document_settings_updated',
          payload: { fields: Object.keys(data) },
        },
      });

      res.json({
        success: true,
        documentSettings: {
          contactEmail: updated.contactEmail,
          gstStateCode: updated.gstStateCode,
          defaultPaymentTerms: updated.defaultPaymentTerms,
          defaultProformaValidityDays: updated.defaultProformaValidityDays,
          defaultTermsAndConditions: updated.defaultTermsAndConditions,
          bankAccountHolderName: updated.bankAccountHolderName,
          bankName: updated.bankName,
          bankBranch: updated.bankBranch,
          bankAccountNumber: updated.bankAccountNumber,
          bankIfscCode: updated.bankIfscCode,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

// ── Who changed what ────────────────────────────────────────────────────────
//
// Settings' Activity tab. It had no route and its caller swallowed the 404, so
// the tab read "Nothing recorded yet." however much had actually been recorded.
//
// Read-only, and admin-only: an audit log something can edit is not one, and a
// log of who touched money and people is not everybody's to read.

configRouter.get(
  '/audit-log',
  requirePermission('setup.admin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const entries = await prisma.activity.findMany({
        where: { organizationId: req.user!.organizationId },
        orderBy: { at: 'desc' },
        take: 100,
        include: { actor: { select: { id: true, name: true } } },
      });

      res.json(
        entries.map((e) => ({
          id: e.id,
          action: e.verb,
          entityType: e.entityType,
          entityId: e.entityId,
          // Activity records what a change WAS, not what it replaced — there is
          // no before/after pair stored anywhere. Sending null is honest; the
          // screen shows the verb, the actor and the date, and reads neither.
          before: null,
          after: (e.payload ?? null) as Record<string, unknown> | null,
          createdAt: e.at.toISOString(),
          user: e.actor,
        })),
      );
    } catch (e) {
      next(e);
    }
  },
);
