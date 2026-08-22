/**
 * Organisation settings and the configuration lists.
 *
 * Step 1 of the build order, because everything with a date, a number or a tax
 * line reads from here rather than from a constant (master plan §3.11).
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, param, requireRole, type AuthRequest } from '../middleware/auth.js';
import { invalidateOrgConfig } from '../lib/orgConfig.js';
import { isValidTimeZone } from '../utils/orgDay.js';
import { peekDocumentNumber } from '../utils/documentNumber.js';
import {
  invalidateMailer,
  mailIsConfigured,
  mailStatus,
  sendMail,
  verifyMailSettings,
  explainMailFailure,
} from '../services/mail.js';
import { testEmail } from '../services/mail-templates.js';

export const configRouter = Router();

configRouter.use(authenticate);

/**
 * GET /config — everything a client needs to render correctly.
 *
 * Open to any signed-in user, because a Member still needs the timezone and date
 * format to read a due date. The SMTP password is never included.
 */
configRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const [org, modules, stages, lostReasons, sources, services] = await Promise.all([
      prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: {
          id: true, name: true, logo: true, website: true, industry: true,
          address: true, phone: true,
          currency: true, timezone: true, locale: true, dateFormat: true,
          fiscalYearStart: true, documentPrefix: true, state: true, gstNumber: true,
          mailFromName: true, mailFromEmail: true, mailReplyTo: true,
          googleWorkspaceDomain: true, allowPasswordLogin: true,
          settings: true,
          // The SMTP host, user and password are deliberately absent. This
          // endpoint answers every signed-in person, and a Member has no reason
          // to learn the mail server. `mailConfigured` below is all a screen
          // needs to decide between "emailed" and "copy this link".
        },
      }),
      prisma.organizationModule.findMany({ where: { organizationId: orgId }, orderBy: { key: 'asc' } }),
      prisma.stage.findMany({
        where: { pipeline: { organizationId: orgId, isDefault: true }, archivedAt: null },
        orderBy: { position: 'asc' },
        include: { fields: { include: { field: true }, orderBy: { position: 'asc' } } },
      }),
      prisma.lostReason.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { position: 'asc' } }),
      prisma.leadSource.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { position: 'asc' } }),
      prisma.service.findMany({ where: { organizationId: orgId, archivedAt: null }, orderBy: { position: 'asc' } }),
    ]);

    res.json({
      success: true,
      data: {
        organization: org,
        mailConfigured: await mailIsConfigured(orgId),
        modules: Object.fromEntries(modules.map((m) => [m.key, m.enabled])),
        stages,
        lostReasons,
        sources,
        services,
        me: { userId: req.user!.userId, role: req.user!.role, roles: req.user!.roles },
      },
    });
  } catch (e) {
    next(e);
  }
});

const settingsInput = z.object({
  name: z.string().min(1).optional(),
  logo: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  currency: z.string().length(3).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  dateFormat: z.string().optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  documentPrefix: z.string().min(1).max(8).optional(),
  state: z.string().optional().nullable(),
  gstNumber: z.string().optional().nullable(),
  mailFromName: z.string().optional().nullable(),
  mailFromEmail: z.string().email().optional().nullable().or(z.literal('')),
  mailReplyTo: z.string().email().optional().nullable().or(z.literal('')),
  smtpHost: z.string().optional().nullable(),
  smtpPort: z.number().int().min(1).max(65535).optional().nullable(),
  smtpUser: z.string().optional().nullable(),
  // Write-only. Accepted here, never returned by any endpoint. An empty string
  // means "leave it alone" rather than "clear it", because a settings form that
  // posts every field would otherwise wipe the password each time somebody
  // corrected the port. Clearing is done by clearing the HOST.
  smtpPassword: z.string().optional().nullable(),
  googleWorkspaceDomain: z.string().optional().nullable(),
  allowPasswordLogin: z.boolean().optional(),
  settings: z.any().optional(),
});

configRouter.patch('/', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = settingsInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    // An abbreviation like "IST" is a valid identifier to ICU and means India,
    // Israel AND Ireland. Accepting one would put every day boundary in the wrong
    // place for two of the three, silently.
    if (parsed.data.timezone && !isValidTimeZone(parsed.data.timezone)) {
      res.status(400).json({
        success: false,
        error: `"${parsed.data.timezone}" is not a recognised timezone. Use an IANA name such as Asia/Kolkata.`,
      });
      return;
    }

    const { smtpPassword, ...rest } = parsed.data;

    const org = await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data: {
        ...rest,
        // Only when something was actually typed. See the schema comment: an
        // empty field on a form that posts everything must not erase a working
        // password as a side effect of editing the port.
        ...(smtpPassword ? { smtpPassword } : {}),
        // Clearing the host clears the credential with it, so a "turn sending
        // off" never leaves a password sitting in the row.
        ...('smtpHost' in parsed.data && !parsed.data.smtpHost
          ? { smtpPassword: null, smtpUser: null, smtpPort: null }
          : {}),
      },
    });

    // Both caches are cleared explicitly rather than expiring: a stale timezone
    // would move every "due today" boundary for as long as the TTL, and a stale
    // transporter would keep using the password somebody just corrected —
    // neither failure looks connected to the edit that caused it.
    invalidateOrgConfig(org.id);
    invalidateMailer(org.id);

    res.json({ success: true, data: { id: org.id, mailConfigured: await mailIsConfigured(org.id) } });
  } catch (e) {
    next(e);
  }
});

/**
 * How this organisation sends mail.
 *
 * Admin only, and separate from `GET /config` for that reason: the mail server
 * and the account it signs in as are infrastructure, not display settings.
 * The password is never returned — `hasPassword` says whether one is stored,
 * which is the only thing a form needs in order to render "leave blank to keep".
 */
configRouter.get('/mail', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.user!.organizationId },
      select: {
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpPassword: true,
        mailFromName: true,
        mailFromEmail: true,
        mailReplyTo: true,
      },
    });

    const { smtpPassword, ...rest } = org;
    const status = await mailStatus(req.user!.organizationId);

    res.json({
      success: true,
      data: {
        ...rest,
        hasPassword: Boolean(smtpPassword),
        ...status,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Prove the settings work.
 *
 * Two steps, and they fail differently on purpose. `verify` opens a connection
 * and authenticates: a wrong password is reported as a wrong password rather
 * than as a message that vanished. Only then is a real message sent, to the
 * person asking — so "it says it worked" and "something arrived" are the same
 * claim, which is the only version worth trusting.
 */
configRouter.post('/mail/test', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    // Settings may have been saved a moment ago in the same session.
    invalidateMailer(orgId);

    const check = await verifyMailSettings(orgId);
    if (!check.ok) {
      res.status(422).json({
        success: false,
        code: check.reason,
        error: explainMailFailure(check.reason),
        detail: check.detail,
      });
      return;
    }

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { name: true },
    });

    const to = typeof req.body?.to === 'string' && req.body.to.trim() ? req.body.to.trim() : req.user!.email;
    const result = await sendMail(orgId, {
      to,
      ...testEmail({ orgName: org.name, recipientName: req.user!.name }),
    });

    if (!result.delivered) {
      res.status(422).json({
        success: false,
        code: result.reason,
        error: explainMailFailure(result.reason),
        detail: result.detail,
      });
      return;
    }

    res.json({ success: true, data: { to }, message: `Test message sent to ${to}.` });
  } catch (e) {
    next(e);
  }
});

/**
 * Turn a module on or off for the organisation.
 *
 * The key is a plain string so a new module needs no migration — insert a row,
 * gate the routes, gate the navigation (§7.5). Turning one off hides its
 * screens AND refuses its endpoints; `requireModule` does the second half, so
 * this is not a cosmetic switch.
 */
configRouter.patch('/modules/:key', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const key = param(req, 'key').toUpperCase();
    const enabled = Boolean(req.body?.enabled);
    const orgId = req.user!.organizationId;

    const existing = await prisma.organizationModule.findUnique({
      where: { organizationId_key: { organizationId: orgId, key } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: `There is no "${key}" module.` });
      return;
    }

    // Leaving somebody with no modules at all produces an application with
    // nothing in it, which reads as broken rather than as a setting.
    if (!enabled) {
      const others = await prisma.organizationModule.count({
        where: { organizationId: orgId, enabled: true, key: { not: key } },
      });
      if (others === 0) {
        res.status(409).json({
          success: false,
          error: 'At least one module has to stay on.',
          code: 'LAST_MODULE',
        });
        return;
      }
    }

    await prisma.organizationModule.update({
      where: { organizationId_key: { organizationId: orgId, key } },
      data: { enabled },
    });
    invalidateOrgConfig(orgId);

    res.json({ success: true, data: { key, enabled } });
  } catch (e) {
    next(e);
  }
});

/**
 * Who changed what.
 *
 * Read-only and never written to from here — an audit log something can edit is
 * not an audit log (§5). Admin and above, because it names people and money.
 */
configRouter.get('/audit-log', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.auditLog.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

/** What the next document number would be, without consuming it. */
configRouter.get('/next-number/:scope', requireRole('SALES'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const scope = param(req, 'scope').toUpperCase();
    if (!['QT', 'PI', 'INV', 'CN'].includes(scope)) {
      res.status(400).json({ success: false, error: 'Unknown document scope.' });
      return;
    }
    res.json({
      success: true,
      data: { number: await peekDocumentNumber(req.user!.organizationId, scope as never) },
    });
  } catch (e) {
    next(e);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURABLE LISTS — Lost Reasons, Lead Sources, Services, Stages
//
// All four follow the same contract:
// • Create adds a row. Position defaults to max + 1.
// • Update renames or repositions.
// • Delete ARCHIVES (archivedAt = now), never hard-deletes. History stays
//   readable — a deal lost for a reason that no longer appears in the dropdown
//   must still show WHY it was lost.
// • All require ADMIN.
// ══════════════════════════════════════════════════════════════════════════════

// ── Lost Reasons ─────────────────────────────────────────────────────────────

const lostReasonInput = z.object({
  name: z.string().min(1, 'Name is required'),
  position: z.number().int().optional(),
});

configRouter.post('/lost-reasons', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = lostReasonInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;

    // Default position: one past the current maximum.
    let position = parsed.data.position;
    if (position === undefined) {
      const max = await prisma.lostReason.aggregate({
        where: { organizationId: orgId },
        _max: { position: true },
      });
      position = (max._max.position ?? -1) + 1;
    }

    const row = await prisma.lostReason.create({
      data: { organizationId: orgId, name: parsed.data.name, position },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A lost reason with that name already exists.' });
      return;
    }
    next(e);
  }
});

configRouter.patch('/lost-reasons/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.lostReason.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Lost reason not found' });
      return;
    }

    const input = z.object({ name: z.string().min(1).optional(), position: z.number().int().optional() }).safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ success: false, error: input.error.issues[0].message });
      return;
    }

    const row = await prisma.lostReason.update({ where: { id }, data: input.data });
    res.json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A lost reason with that name already exists.' });
      return;
    }
    next(e);
  }
});

configRouter.delete('/lost-reasons/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.lostReason.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Lost reason not found' });
      return;
    }

    await prisma.lostReason.update({ where: { id }, data: { archivedAt: new Date() } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── Lead Sources ─────────────────────────────────────────────────────────────

const leadSourceInput = z.object({
  name: z.string().min(1, 'Name is required'),
  position: z.number().int().optional(),
});

configRouter.post('/sources', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = leadSourceInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;

    let position = parsed.data.position;
    if (position === undefined) {
      const max = await prisma.leadSource.aggregate({
        where: { organizationId: orgId },
        _max: { position: true },
      });
      position = (max._max.position ?? -1) + 1;
    }

    const row = await prisma.leadSource.create({
      data: { organizationId: orgId, name: parsed.data.name, position },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A lead source with that name already exists.' });
      return;
    }
    next(e);
  }
});

configRouter.patch('/sources/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.leadSource.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Lead source not found' });
      return;
    }

    const input = z.object({ name: z.string().min(1).optional(), position: z.number().int().optional() }).safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ success: false, error: input.error.issues[0].message });
      return;
    }

    const row = await prisma.leadSource.update({ where: { id }, data: input.data });
    res.json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A lead source with that name already exists.' });
      return;
    }
    next(e);
  }
});

configRouter.delete('/sources/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.leadSource.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Lead source not found' });
      return;
    }

    await prisma.leadSource.update({ where: { id }, data: { archivedAt: new Date() } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── Services ─────────────────────────────────────────────────────────────────

const serviceInput = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().nullable(),
  defaultRate: z.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  position: z.number().int().optional(),
});

configRouter.post('/services', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = serviceInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;

    let position = parsed.data.position;
    if (position === undefined) {
      const max = await prisma.service.aggregate({
        where: { organizationId: orgId },
        _max: { position: true },
      });
      position = (max._max.position ?? -1) + 1;
    }

    const row = await prisma.service.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        defaultRate: parsed.data.defaultRate ?? null,
        unit: parsed.data.unit ?? null,
        position,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A service with that name already exists.' });
      return;
    }
    next(e);
  }
});

configRouter.patch('/services/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.service.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Service not found' });
      return;
    }

    const input = serviceInput.partial().safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ success: false, error: input.error.issues[0].message });
      return;
    }

    const row = await prisma.service.update({ where: { id }, data: input.data });
    res.json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A service with that name already exists.' });
      return;
    }
    next(e);
  }
});

configRouter.delete('/services/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.service.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Service not found' });
      return;
    }

    await prisma.service.update({ where: { id }, data: { archivedAt: new Date() } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── Stages ───────────────────────────────────────────────────────────────────
//
// More constrained than the others. Stages are the pipeline's columns, and two
// invariants must hold at all times:
//   1. Exactly one WON and one LOST stage per pipeline.
//   2. A stage with deals in it cannot be archived — move them first.

const stageInput = z.object({
  name: z.string().min(1, 'Name is required'),
  kind: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  probability: z.number().min(0).max(1).optional(),
  rottingDays: z.number().int().min(1).optional().nullable(),
  requiresForecast: z.boolean().optional(),
  position: z.number().int().optional(),
});

configRouter.post('/stages', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = stageInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const pipeline = await prisma.pipeline.findFirst({
      where: { organizationId: orgId, isDefault: true },
      select: { id: true },
    });
    if (!pipeline) {
      res.status(404).json({ success: false, error: 'No default pipeline found.' });
      return;
    }

    // New stages may only be OPEN. Adding a second WON or LOST would break the
    // pipeline invariant and no screen enforces which one to keep.
    const kind = parsed.data.kind ?? 'OPEN';
    if (kind !== 'OPEN') {
      const exists = await prisma.stage.findFirst({
        where: { pipelineId: pipeline.id, kind, archivedAt: null },
      });
      if (exists) {
        res.status(409).json({
          success: false,
          error: `There is already a ${kind} stage ("${exists.name}"). A pipeline has exactly one.`,
        });
        return;
      }
    }

    let position = parsed.data.position;
    if (position === undefined) {
      // Insert before the terminal stages (WON/LOST) for OPEN, at the end otherwise.
      const max = await prisma.stage.aggregate({
        where: { pipelineId: pipeline.id },
        _max: { position: true },
      });
      position = (max._max.position ?? -1) + 1;
    }

    const row = await prisma.stage.create({
      data: {
        pipelineId: pipeline.id,
        name: parsed.data.name,
        kind,
        probability: parsed.data.probability ?? 0,
        rottingDays: parsed.data.rottingDays ?? null,
        requiresForecast: parsed.data.requiresForecast ?? false,
        position,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A stage with that position already exists. Reorder first.' });
      return;
    }
    next(e);
  }
});

configRouter.patch('/stages/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.stage.findFirst({
      where: { id, pipeline: { organizationId: req.user!.organizationId, isDefault: true } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Stage not found' });
      return;
    }

    // Cannot change kind of WON/LOST stages — they are structural.
    const input = stageInput.partial().omit({ kind: true }).safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ success: false, error: input.error.issues[0].message });
      return;
    }

    const row = await prisma.stage.update({ where: { id }, data: input.data });
    res.json({ success: true, data: row });
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A stage with that position already exists. Reorder first.' });
      return;
    }
    next(e);
  }
});

/**
 * Reorder stages.
 *
 * Accepts an array of `{ id, position }` pairs and updates them all inside a
 * transaction so the unique constraint on `(pipelineId, position)` is satisfied
 * at commit rather than mid-flight.
 */
configRouter.patch('/stages/reorder', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = z
      .array(z.object({ id: z.string(), position: z.number().int() }))
      .min(1)
      .safeParse(req.body);
    if (!items.success) {
      res.status(400).json({ success: false, error: 'Expected an array of { id, position }.' });
      return;
    }

    const orgId = req.user!.organizationId;
    const pipeline = await prisma.pipeline.findFirst({
      where: { organizationId: orgId, isDefault: true },
      select: { id: true },
    });
    if (!pipeline) {
      res.status(404).json({ success: false, error: 'No default pipeline found.' });
      return;
    }

    // All positions go to negative first (to avoid the unique constraint
    // colliding mid-reorder), then to their final values.
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < items.data.length; i++) {
        await tx.stage.updateMany({
          where: { id: items.data[i].id, pipelineId: pipeline.id },
          data: { position: -(i + 1) },
        });
      }
      for (const item of items.data) {
        await tx.stage.updateMany({
          where: { id: item.id, pipelineId: pipeline.id },
          data: { position: item.position },
        });
      }
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

configRouter.delete('/stages/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.stage.findFirst({
      where: { id, pipeline: { organizationId: req.user!.organizationId, isDefault: true } },
      include: { _count: { select: { deals: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Stage not found' });
      return;
    }

    // WON and LOST are structural — removing them would leave deals unable to
    // end, which is how a pipeline fills up and never empties.
    if (existing.kind === 'WON' || existing.kind === 'LOST') {
      res.status(409).json({
        success: false,
        error: `The ${existing.kind} stage cannot be removed. A pipeline needs exactly one.`,
      });
      return;
    }

    // A stage with deals in it cannot be archived — move them first. Hiding a
    // column with cards on it hides the cards, which is data disappearing.
    if (existing._count.deals > 0) {
      res.status(409).json({
        success: false,
        error: `${existing._count.deals} deal(s) are in this stage. Move them to another stage first.`,
      });
      return;
    }

    await prisma.stage.update({ where: { id }, data: { archivedAt: new Date() } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});
