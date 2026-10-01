import { googleConfigured } from '../services/googleCalendar.js';
import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { TaskType, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { forgetWorkCalendar } from '../utils/workCalendar.js';
import { buildSellerSnapshot, resolveState, sellerBlockGaps } from '../services/documentModel.js';
import { authenticate, requirePermission, hasPermission, type AuthRequest } from '../middleware/auth.js';
import { encryptSecret } from '../utils/crypto.js';
import { resolveMailConfig, sendMail } from '../utils/mailer.js';
import { AI_PROVIDER_IDS } from '../services/ai/index.js';
import { AREAS, areaWhere, dayStartIn, describe, resolveSubjects } from '../services/activityLog.js';
import { approverFor, escalateFor, minutesLabel, TASK_TYPE_LABEL } from '../services/taskApprovals.js';

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

        /*
         * §14's stage probabilities, for everyone rather than admins only.
         *
         * The Pipeline board prints the stage default in every column header,
         * including empty ones, and it is read by BD — who have pipeline.read
         * and not setup.admin. It is also not a figure §9 protects: it is a
         * likelihood, not money, and the board already shows the resulting
         * per-card percentage to anyone allowed on the board at all.
         *
         * Sent so the web stops keeping a fourth copy of the table.
         */
        /*
         * Whether, not what.
         *
         * The Settings screen needs to know if a key is on file so it can say
         * "set" and offer to replace it. It does not need the key, and sending
         * it would put a live API key in every signed-in browser's memory and
         * in the response cache.
         *
         * The provider, model and address are not secrets and Settings has to
         * show them, so those do go.
         */
        /*
         * The departments a person can belong to.
         *
         * Sent to everyone, not just admins: the member list groups by
         * department and the edit form offers them, so any screen showing a
         * team needs the list.
         */
        departments: org.departments,
        aiConfigured: Boolean(org.aiApiKey),
        aiProvider: org.aiProvider,
        aiModel: org.aiModel,
        aiBaseUrl: org.aiBaseUrl,

        stageProbabilities: {
          PROPOSAL_SENT: org.stageProbProposalSent,
          IN_NEGOTIATION: org.stageProbInNegotiation,
          PROFORMA_ISSUED: org.stageProbProformaIssued,
          VERBAL_YES: org.stageProbVerbalYes,
          WON: 100,
        },

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
              // §14: the working calendar and the stage probabilities are
              // settings, and until now nothing read either of them.
              workingHoursStart: org.workingHoursStart,
              workingHoursEnd: org.workingHoursEnd,
              workingDays: org.workingDays,
              holidays: org.holidays,
              // Settings → Integrations, offered only when the server has Google keys.
              googleCalendarConfigured: googleConfigured(),
              googleCalendarEnabled: org.googleCalendarEnabled,
            }
          : {}),
      },
      // The letterhead a proforma PDF prints — bank details included. The PDF
      // is rendered on the server (services/proformaPdf.ts), so the only client
      // that ever needed these is the admin form that edits them.
      ...(canSeeSetup
        ? {
            documentSettings: {
              /*
               * What the seller block still needs, worked out by the same
               * function the PDF renderer uses. The screen and the renderer
               * asking two different questions is how you get a Settings page
               * that looks complete and a download that refuses.
               */
              gaps: sellerBlockGaps(buildSellerSnapshot(org)),
              contactEmail: org.contactEmail,
              gstStateCode: org.gstStateCode,
              legalName: org.legalName,
              address: org.address,
              stateName: org.state,
              gstNumber: org.gstNumber,
              pan: org.pan,
              declarationText: org.declarationText,
              signatureImage: org.signatureImage,
              showSignatureBlock: org.showSignatureBlock,
              sacCodes: org.sacCodes,
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
        { id: 'PROPOSAL_SENT', name: 'Proposal Sent', order: 1, kind: 'OPEN' },
        { id: 'IN_NEGOTIATION', name: 'In Negotiation', order: 2, kind: 'OPEN' },
        { id: 'PROFORMA_ISSUED', name: 'Proforma Issued', order: 3, kind: 'OPEN' },
        { id: 'VERBAL_YES', name: 'Verbal Yes', order: 4, kind: 'OPEN' },
        { id: 'WON', name: 'Won', order: 5, kind: 'WON' },
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
        // The task types this person approves — what puts "Waiting for your
        // approval" on their My Work and a count on its nav item. Empty for
        // almost everybody.
        approverFor: await approverFor(orgId, req.user!.userId),
        // The types whose stuck approvals escalate to them — once a round
        // escalates it shows in their queue too.
        escalateFor: await escalateFor(orgId, req.user!.userId),
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
  workingHoursStart: z.string().regex(/^\d{1,2}:\d{2}$/, 'Use HH:MM').optional(),
  workingHoursEnd: z.string().regex(/^\d{1,2}:\d{2}$/, 'Use HH:MM').optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** §14 "Sundays and public holidays excluded". ISO days the office is shut. */
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')).max(60).optional(),
  /*
   * The key is write-only: accepted here and never sent back by the GET above.
   * The browser is told whether one is SET, not what it is. An empty string
   * clears it, which is how you turn the assistant off without a deploy.
   *
   * The provider is checked against the adapters that actually exist rather
   * than taken as a string, so a typo cannot leave Zen pointed at nothing.
   */
  /*
   * Departments, as a whole list rather than one at a time.
   *
   * Trimmed, de-duplicated and sorted on the way in, because this is a text
   * box somebody types into and "Design " and "design" are the same team. A
   * department already assigned to somebody is NOT protected here — removing
   * one leaves their record carrying a value the dropdown no longer offers,
   * which the edit form shows rather than silently changing.
   */
  departments: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  /** Settings → Integrations: people may connect Google Calendar. */
  googleCalendarEnabled: z.boolean().optional(),
  aiApiKey: z.string().trim().max(200).optional(),
  aiProvider: z.enum(AI_PROVIDER_IDS).optional(),
  aiModel: z.string().trim().min(1).max(100).optional(),
  /*
   * Only meaningful for OPENAI_COMPATIBLE, and validated as a URL so a
   * half-typed address fails here rather than as a fetch error mid-answer.
   * An empty string clears it.
   */
  aiBaseUrl: z
    .union([z.literal(''), z.string().trim().url('That is not a web address').max(300)])
    .optional(),
  stageProbProposalSent: z.number().int().min(0).max(100).optional(),
  stageProbInNegotiation: z.number().int().min(0).max(100).optional(),
  stageProbProformaIssued: z.number().int().min(0).max(100).optional(),
  stageProbVerbalYes: z.number().int().min(0).max(100).optional(),
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
        /*
         * The state NAME is what this tab has always asked for, and the state
         * CODE is what every document's tax is decided against — so picking a
         * state here used to leave the code behind, and the tab labelled "Tax
         * identity" would say Karnataka while every invoice was still being
         * billed as a Tamil Nadu supply. They are one fact, so they are set
         * together, and the GSTIN is the fallback when only that was given.
         */
        ...(data.state !== undefined || data.gstNumber !== undefined
          ? {
              gstStateCode:
                resolveState({ name: data.state, gstin: data.gstNumber }).code ?? undefined,
            }
          : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.documentPrefix !== undefined ? { proformaPrefix: data.documentPrefix } : {}),
        ...(data.fiscalYearStart !== undefined ? { financialYearStart: data.fiscalYearStart } : {}),
        ...(data.mailFromName !== undefined ? { mailFromName: data.mailFromName || null } : {}),
        ...(data.mailFromEmail !== undefined ? { mailFromEmail: data.mailFromEmail || null } : {}),
        ...(data.allowPasswordLogin !== undefined ? { allowPasswordLogin: data.allowPasswordLogin } : {}),
        ...(data.assetTagPrefix !== undefined ? { assetTagPrefix: data.assetTagPrefix.replace(/\/+$/, '') } : {}),
        // §14's working calendar and stage probabilities. Both were columns
        // nothing wrote and nothing read; the elapsed-time helpers and the
        // pipeline weighting go through them now.
        ...(data.workingHoursStart !== undefined ? { workingHoursStart: data.workingHoursStart } : {}),
        ...(data.workingHoursEnd !== undefined ? { workingHoursEnd: data.workingHoursEnd } : {}),
        ...(data.workingDays !== undefined ? { workingDays: data.workingDays } : {}),
        ...(data.holidays !== undefined ? { holidays: Array.from(new Set(data.holidays)).sort() } : {}),
        /*
         * An empty string CLEARS the key rather than storing "". That is how
         * the assistant is turned off from Settings, and the difference
         * between null and an empty string is the difference between "no key"
         * and "a key the provider will reject".
         */
        ...(data.departments !== undefined
          ? { departments: [...new Set(data.departments.map((d) => d.trim()).filter(Boolean))].sort() }
          : {}),
        ...(data.aiApiKey !== undefined ? { aiApiKey: data.aiApiKey || null } : {}),
        ...(data.aiProvider !== undefined ? { aiProvider: data.aiProvider } : {}),
        ...(data.aiModel !== undefined ? { aiModel: data.aiModel } : {}),
        ...(data.aiBaseUrl !== undefined ? { aiBaseUrl: data.aiBaseUrl || null } : {}),
        ...(data.googleCalendarEnabled !== undefined ? { googleCalendarEnabled: data.googleCalendarEnabled } : {}),
        ...(data.stageProbProposalSent !== undefined ? { stageProbProposalSent: data.stageProbProposalSent } : {}),
        ...(data.stageProbInNegotiation !== undefined ? { stageProbInNegotiation: data.stageProbInNegotiation } : {}),
        ...(data.stageProbProformaIssued !== undefined ? { stageProbProformaIssued: data.stageProbProformaIssued } : {}),
        ...(data.stageProbVerbalYes !== undefined ? { stageProbVerbalYes: data.stageProbVerbalYes } : {}),
      },
    });

    /*
     * The calendar is cached for a minute so a task list does not run a query
     * per row. Dropping it here means a Setup save shows on the screen the
     * person changed it on, rather than up to a minute later.
     */
    forgetWorkCalendar(orgId);

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
  /*
   * CR-02 §2 — the half of the seller block this endpoint owns.
   *
   * The address lives on the Organisation tab and the state and GSTIN on Tax
   * & numbering, and `PATCH /config` is the one thing that writes them — it
   * is also what keeps `gstStateCode` in step with the state name it is
   * derived from. Accepting them here as well made two writers for one fact,
   * and the second did not do that derivation: setting a GSTIN through this
   * route left the state code behind, still deciding the tax. So they are
   * not accepted here at all. One field, one writer.
   */
  legalName: z.string().trim().max(200).optional().nullable(),
  pan: z.string().trim().max(15).optional().nullable(),
  declarationText: z.string().trim().max(1000).optional().nullable(),
  /**
   * A scanned signature as a data URI. Capped at roughly 300 KB of base64,
   * and required to actually be an image: this string is written straight
   * into the src of an img tag in the PDF template, so anything else is
   * either a broken document or somebody trying their luck.
   */
  signatureImage: z
    .string()
    .max(400_000, 'That signature image is too large — use one under about 300 KB')
    .regex(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a PNG, JPG or WebP image')
    .optional()
    .nullable(),
  sacCodes: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
  /**
   * The "For <legal name> / Authorised Signatory" box. Off is a real answer:
   * a document emailed under a signed covering note is signed in practice, and
   * Rule 46 asks for a signature, not for a printed box.
   */
  showSignatureBlock: z.boolean().optional(),
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
          ...(data.legalName !== undefined ? { legalName: data.legalName || null } : {}),
          ...(data.pan !== undefined ? { pan: data.pan || null } : {}),
          ...(data.declarationText !== undefined ? { declarationText: data.declarationText || null } : {}),
          ...(data.signatureImage !== undefined ? { signatureImage: data.signatureImage || null } : {}),
          // De-duplicated and upper-cased: a SAC code is a code, and the list
          // exists so nobody retypes one — two spellings of 998365 defeats it.
          ...(data.showSignatureBlock !== undefined ? { showSignatureBlock: data.showSignatureBlock } : {}),
          ...(data.sacCodes !== undefined
            ? { sacCodes: Array.from(new Set(data.sacCodes.map((c) => c.toUpperCase()))) }
            : {}),
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
          gaps: sellerBlockGaps(buildSellerSnapshot(updated)),
          contactEmail: updated.contactEmail,
          gstStateCode: updated.gstStateCode,
          legalName: updated.legalName,
          address: updated.address,
          stateName: updated.state,
          gstNumber: updated.gstNumber,
          pan: updated.pan,
          declarationText: updated.declarationText,
          signatureImage: updated.signatureImage,
          showSignatureBlock: updated.showSignatureBlock,
          sacCodes: updated.sacCodes,
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

// ── Who approves what ───────────────────────────────────────────────────────
//
// Settings → Approvals. For each task type, the people who can sign it off;
// any one of them is enough. A task can only be marked "Needs approval" when
// its type has at least one.
//
// Read by everybody — every task form needs it to decide whether the "Needs
// approval" tick is available — and written by admins only.
//
// The same screen holds the chaser's settings: how long a task waits before
// the approvers are reminded and before it escalates (working minutes, one
// pair for the org), and who each type escalates to.

configRouter.get('/approvers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const [rows, escalationRows, org] = await Promise.all([
      prisma.taskApprover.findMany({
        where: { organizationId: orgId, user: { active: true } },
        orderBy: { user: { name: 'asc' } },
        select: { taskType: true, user: { select: { id: true, name: true } } },
      }),
      prisma.approvalEscalationContact.findMany({
        where: { organizationId: orgId, user: { active: true } },
        orderBy: { user: { name: 'asc' } },
        select: { taskType: true, user: { select: { id: true, name: true } } },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { approvalRemindMinutes: true, approvalEscalateMinutes: true },
      }),
    ]);
    // Every type, empty ones included, so the screen can draw one row each.
    const empty = () => Object.fromEntries(Object.values(TaskType).map((t) => [t, [] as { id: string; name: string }[]]));
    const byType = empty();
    for (const r of rows) byType[r.taskType].push(r.user);
    const escalation = empty();
    for (const r of escalationRows) escalation[r.taskType].push(r.user);
    res.json({
      success: true,
      approvers: byType,
      escalation,
      remindMinutes: org?.approvalRemindMinutes ?? 120,
      escalateMinutes: org?.approvalEscalateMinutes ?? 240,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * One type's lists, or the org's two timings — whichever the screen saved.
 * Remind: 15 minutes to a working day. Escalate: after the reminder, within
 * two days.
 */
const approversSchema = z
  .object({
    taskType: z.nativeEnum(TaskType).optional(),
    /**
     * One list for all work: the same approvers (and escalation people) on
     * every task type at once — what Settings → Approvals saves. `taskType`
     * still saves a single type.
     */
    allTypes: z.boolean().optional(),
    userIds: z.array(z.string().min(1)).max(50).optional(),
    escalationUserIds: z.array(z.string().min(1)).max(50).optional(),
    remindMinutes: z.number().int().optional(),
    escalateMinutes: z.number().int().optional(),
  })
  .superRefine((v, ctx) => {
    const timings = v.remindMinutes !== undefined || v.escalateMinutes !== undefined;
    const lists = Boolean(v.taskType || v.allTypes);
    if (!lists && !timings) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nothing to save.' });
      return;
    }
    if (lists && !v.userIds && !v.escalationUserIds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Pick the approvers or the escalation people.' });
    }
    if (!timings) return;
    if (v.remindMinutes === undefined || v.escalateMinutes === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Set both the reminder and the escalation time.' });
      return;
    }
    if (v.remindMinutes < 15 || v.remindMinutes > 1440) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Remind after has to be between 15 minutes and 1 day.' });
    } else if (v.escalateMinutes <= v.remindMinutes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Escalate after has to be later than the reminder.' });
    } else if (v.escalateMinutes > 2880) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Escalate after can be at most 2 days.' });
    }
  });

configRouter.put(
  '/approvers',
  requirePermission('setup.admin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = approversSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const orgId = req.user!.organizationId;
      const { taskType, allTypes, remindMinutes, escalateMinutes } = parsed.data;
      const activity = (verb: string, payload: Record<string, unknown>) =>
        prisma.activity.create({
          data: { organizationId: orgId, entityType: 'Organization', entityId: orgId, actorId: req.user!.userId, verb, payload },
        });

      // The org's two timings.
      if (remindMinutes !== undefined && escalateMinutes !== undefined) {
        await prisma.organization.update({
          where: { id: orgId },
          data: { approvalRemindMinutes: remindMinutes, approvalEscalateMinutes: escalateMinutes },
        });
        await activity('approval_timings_updated', {
          remind: minutesLabel(remindMinutes),
          escalate: minutesLabel(escalateMinutes),
        });
      }

      if (!taskType && !allTypes) {
        res.json({ success: true, remindMinutes, escalateMinutes });
        return;
      }
      // Every type at once, or the one asked for.
      const types: TaskType[] = allTypes ? Object.values(TaskType) : [taskType!];
      const scopeLabel = allTypes ? 'All work' : TASK_TYPE_LABEL[taskType!];

      const approverIds = parsed.data.userIds ? [...new Set(parsed.data.userIds)] : null;
      const escalationIds = parsed.data.escalationUserIds ? [...new Set(parsed.data.escalationUserIds)] : null;

      // Everybody named has to be on this team and still here.
      const named = [...new Set([...(approverIds ?? []), ...(escalationIds ?? [])])];
      const people = await prisma.user.findMany({
        where: { id: { in: named }, organizationId: orgId, active: true },
        select: { id: true, name: true },
      });
      if (people.length !== named.length) {
        res.status(400).json({ success: false, error: 'One of those people is not on the team, or has left.' });
        return;
      }
      const nameOf = new Map(people.map((p) => [p.id, p.name]));
      const listOf = (ids: string[]) =>
        ids.map((id) => ({ id, name: nameOf.get(id)! })).sort((a, b) => a.name.localeCompare(b.name));

      // Replace the lists: whoever is not named goes, whoever is stays — on
      // every type in scope, together.
      await prisma.$transaction([
        ...(approverIds
          ? [
              prisma.taskApprover.deleteMany({
                where: { organizationId: orgId, taskType: { in: types }, userId: { notIn: approverIds } },
              }),
              prisma.taskApprover.createMany({
                data: types.flatMap((t) => approverIds.map((userId) => ({ organizationId: orgId, taskType: t, userId }))),
                skipDuplicates: true,
              }),
            ]
          : []),
        ...(escalationIds
          ? [
              prisma.approvalEscalationContact.deleteMany({
                where: { organizationId: orgId, taskType: { in: types }, userId: { notIn: escalationIds } },
              }),
              prisma.approvalEscalationContact.createMany({
                data: types.flatMap((t) => escalationIds.map((userId) => ({ organizationId: orgId, taskType: t, userId }))),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);

      if (approverIds) {
        await activity('approvers_updated', { taskType: scopeLabel, names: listOf(approverIds).map((p) => p.name) });
      }
      if (escalationIds) {
        await activity('approval_escalation_updated', {
          taskType: scopeLabel,
          names: listOf(escalationIds).map((p) => p.name),
        });
      }

      res.json({
        success: true,
        taskType: allTypes ? 'ALL' : taskType,
        ...(approverIds ? { approvers: listOf(approverIds) } : {}),
        ...(escalationIds ? { escalation: listOf(escalationIds) } : {}),
      });
    } catch (e) {
      next(e);
    }
  },
);

// ── Everything that happened ────────────────────────────────────────────────
//
// Settings' Activity tab: every row the product has written, readable.
//
// It showed the last hundred rows as a verb with its underscores swapped out —
// "task deleted · Naif · Task" — which could not say WHICH task, or go back
// further than a hundred rows, or answer "what did Naif do this week". The
// rows always carried the answer; services/activityLog.ts reads it out.
//
// Read-only, and admin-only: an audit log something can edit is not one, and a
// log of who touched money and people is not everybody's to read.

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** A person's id, or `system` for what Flowzen did on its own. */
  actor: z.string().trim().optional(),
  area: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  q: z.string().trim().max(100).optional(),
});

/** A search term as a literal ILIKE pattern: its own % and _ are characters, not wildcards. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The ids a search term reaches: the things named like it, the people named
 * like it, and any row whose recorded details mention it.
 *
 * Names are matched on the tables themselves rather than on the log, because
 * most rows record an id and not a name — a status change on a task says
 * nothing about what the task was called.
 */
async function searchLog(orgId: string, q: string) {
  const like = { contains: q, mode: 'insensitive' as const };
  const take = 500;
  const [tasks, companies, projects, internal, leads, assets, users, invoices, proformas, costs, payloadHits] =
    await Promise.all([
      prisma.task.findMany({ where: { organizationId: orgId, title: like, deletedAt: undefined }, select: { id: true }, take }),
      prisma.company.findMany({ where: { organizationId: orgId, name: like }, select: { id: true }, take }),
      prisma.project.findMany({ where: { organizationId: orgId, name: like, deletedAt: undefined }, select: { id: true }, take }),
      prisma.internalProject.findMany({ where: { organizationId: orgId, name: like }, select: { id: true }, take }),
      prisma.outreachEntry.findMany({ where: { organizationId: orgId, name: like, deletedAt: undefined }, select: { id: true }, take }),
      prisma.asset.findMany({
        where: { organizationId: orgId, deletedAt: undefined, OR: [{ name: like }, { tag: like }] },
        select: { id: true },
        take,
      }),
      prisma.user.findMany({ where: { organizationId: orgId, name: like }, select: { id: true }, take }),
      prisma.invoice.findMany({ where: { organizationId: orgId, number: like }, select: { id: true }, take }),
      prisma.proforma.findMany({ where: { organizationId: orgId, number: like }, select: { id: true }, take }),
      prisma.cost.findMany({
        where: { organizationId: orgId, deletedAt: undefined, OR: [{ vendor: like }, { category: like }] },
        select: { id: true },
        take,
      }),
      // The recorded details themselves: a deleted task's title, a question
      // asked of Zen, the names in an import.
      prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM activities
        WHERE "organizationId" = ${orgId}
          AND payload::text ILIKE ${likePattern(q)}
        ORDER BY at DESC
        LIMIT 2000`,
    ]);

  // Proposals and retainers are named by their company.
  const companyIds = companies.map((c) => c.id);
  const [proposals, retainers] = companyIds.length
    ? await Promise.all([
        prisma.proposal.findMany({
          where: { organizationId: orgId, companyId: { in: companyIds }, deletedAt: undefined },
          select: { id: true },
        }),
        prisma.retainer.findMany({ where: { organizationId: orgId, companyId: { in: companyIds } }, select: { id: true } }),
      ])
    : [[], []];

  return {
    entityIds: [
      ...tasks,
      ...companies,
      ...projects,
      ...internal,
      ...leads,
      ...assets,
      ...users,
      ...invoices,
      ...proformas,
      ...costs,
      ...proposals,
      ...retainers,
    ].map((r) => r.id),
    actorIds: users.map((u) => u.id),
    rowIds: payloadHits.map((r) => r.id),
  };
}

configRouter.get(
  '/audit-log',
  requirePermission('setup.admin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = auditQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0].message });
        return;
      }
      const { page, limit, actor, area, from, to, q } = parsed.data;
      const orgId = req.user!.organizationId;

      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
      const tz = org?.timezone || 'Asia/Kolkata';

      const and: Prisma.ActivityWhereInput[] = [{ organizationId: orgId }];
      if (actor === 'system') and.push({ actorId: null });
      else if (actor) and.push({ actorId: actor });

      if (area) {
        const w = areaWhere(area);
        if (!w) {
          res.status(400).json({ success: false, error: 'There is no such area' });
          return;
        }
        and.push(w);
      }

      const start = from ? dayStartIn(from, tz) : null;
      const endDay = to ? dayStartIn(to, tz) : null;
      if ((from && !start) || (to && !endDay)) {
        res.status(400).json({ success: false, error: 'That date is not a date' });
        return;
      }
      if (start || endDay) {
        and.push({
          at: {
            ...(start ? { gte: start } : {}),
            // Through the end of the "to" day, in the organisation's zone.
            ...(endDay ? { lt: new Date(endDay.getTime() + 24 * 60 * 60 * 1000) } : {}),
          },
        });
      }

      if (q) {
        const hits = await searchLog(orgId, q);
        and.push({
          OR: [{ entityId: { in: hits.entityIds } }, { actorId: { in: hits.actorIds } }, { id: { in: hits.rowIds } }],
        });
      }
      const where: Prisma.ActivityWhereInput = { AND: and };

      const [rows, total, team] = await Promise.all([
        prisma.activity.findMany({
          where,
          orderBy: [{ at: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          include: { actor: { select: { id: true, name: true } } },
        }),
        prisma.activity.count({ where }),
        prisma.user.findMany({
          where: { organizationId: orgId },
          select: { id: true, name: true, active: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const people = new Map(team.map((u) => [u.id, u.name]));
      const subjects = await resolveSubjects(orgId, rows);

      res.json({
        success: true,
        entries: rows.map((r) => describe(r, subjects, people)),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        people: team,
        areas: AREAS,
      });
    } catch (e) {
      next(e);
    }
  },
);
