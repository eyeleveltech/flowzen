import { Router, type Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, hasPermission, type AuthRequest } from '../middleware/auth.js';
import { roleForPreset } from '../utils/roles.js';
import { hashPassword } from '../utils/password.js';
import { sendMail } from '../utils/mailer.js';
import { logger } from '../utils/logger.js';
import { RolePreset } from '@prisma/client';
import { bookValue } from '../utils/assetValue.js';

const PERMISSION_KEYS = [
  'work.own', 'work.team', 'work.all',
  'company.read', 'company.write',
  'pipeline.read', 'pipeline.write',
  'money.status', 'money.figures',
  'cost.enter', 'reports.read', 'setup.admin',
  // The per-user escape hatch the asset plan leans on: a studio manager on the
  // HEAD preset who should issue gear gets this one switch added here, rather
  // than the whole MANAGEMENT preset being widened for one person.
  'asset.manage',
] as const;

export const usersRouter = Router();

usersRouter.use(authenticate);

// ── The people here ─────────────────────────────────────────────────────────
//
// Settings' Team tab and every "who works here" list read this. It had no
// route, and the caller swallowed the 404 into an empty array — so the tab
// rendered "Just you so far." to an organisation of twelve.
//
// WHO IS ASKING decides the shape. Manager and above get the full record;
// below that this is a picker — name, job title, whether the account is live
// — because a Member has no reason to learn everyone's phone number.

usersRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const detailed = hasPermission(req.user!, 'work.team');

    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        designation: true,
        active: true,
        inviteToken: true,
        ...(detailed
          ? { email: true, phone: true, preset: true, dept: true, createdAt: true }
          : {}),
      },
    });

    res.json(
      users.map((u: any) => ({
        id: u.id,
        name: u.name,
        // Nothing in this app uploads a picture; the lists draw initials.
        avatar: null,
        designation: u.designation,
        // An invited person exists but cannot sign in yet — `active: false`
        // with a token still on the record is PENDING, not switched off.
        status: u.active ? 'ACTIVE' : u.inviteToken ? 'PENDING' : 'INACTIVE',
        ...(detailed
          ? {
              email: u.email,
              phone: u.phone,
              role: roleForPreset(u.preset),
              department: u.dept ? { id: u.dept, name: u.dept } : null,
              joiningDate: u.createdAt.toISOString(),
            }
          : {}),
      })),
    );
  } catch (error) {
    next(error);
  }
});

// ── Issue a password-reset link ─────────────────────────────────────────────
//
// The other half of /reset-password. Somebody who has forgotten their password
// has no way back in on their own — there is no self-service form, because a
// token has to reach the person and this deployment cannot assume its mail
// server will. An admin presses this and hands the link over.
//
// The link is always returned, emailed or not, for the same reason an
// invitation's is: an admin who cannot see it has no way to unblock anybody
// the first time a mail server refuses a connection.

const RESET_VALID_MINUTES = 60;

usersRouter.post('/:id/reset-link', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const user = await prisma.user.findFirst({ where: { id, organizationId: orgId } });
    if (!user) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_VALID_MINUTES * 60 * 1000);

    await prisma.user.update({
      where: { id },
      data: { resetToken: token, resetTokenExpiresAt: expiresAt },
    });

    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const link = `${base}/reset-password?token=${token}`;

    let emailed = false;
    let emailFailure: 'NOT_CONFIGURED' | 'SEND_FAILED' | undefined;
    try {
      await sendMail(orgId, {
        to: user.email,
        subject: 'Set a new Flowzen password',
        text: `Hello ${user.name}, choose a new password: ${link} (the link stops working in an hour).`,
        html: `<p>Hello ${user.name},</p>
<p>An admin has issued a new password link for your Flowzen account.</p>
<p><a href="${link}">Choose a new password</a></p>
<p>The link stops working in an hour. If you did not expect this, ignore it — nothing has changed yet.</p>`,
      });
      emailed = true;
    } catch (e) {
      const message = (e as Error).message;
      // The two failures ask for different things of the admin: configure mail,
      // or just hand the link over this once.
      emailFailure = message.includes('No mail server is configured') ? 'NOT_CONFIGURED' : 'SEND_FAILED';
      logger.error(`Reset link email failed for ${user.email}: ${message}`);
    }

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'User',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'password_reset_link_issued',
        payload: { emailed },
      },
    });

    res.json({
      success: true,
      data: {
        resetToken: token,
        link,
        expiresInMinutes: RESET_VALID_MINUTES,
        emailed,
        ...(emailFailure ? { emailFailure } : {}),
      },
      message: emailed
        ? `A reset link is on its way to ${user.email}.`
        : 'Link created. Mail did not go out, so hand it over yourself.',
    });
  } catch (error) {
    next(error);
  }
});

// ── Invite a person ─────────────────────────────────────────────────────────
//
// Creates the account with a random, never-handed-out password hash and
// active: false — it exists but can't sign in until /auth/accept-invite sets
// a real password. The link is always returned in the response either way
// (see `emailed`) — if no mail server is configured, or sending fails, the
// admin can still copy and send it themselves instead of the invite being
// silently stuck.

const inviteSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  dept: z.string().min(1, 'Department is required'),
  preset: z.nativeEnum(RolePreset),
});

const INVITE_VALID_DAYS = 7;

usersRouter.post('/invite', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const { name, email, dept, preset } = parsed.data;
    const cleanEmail = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      res.status(400).json({ success: false, error: 'Someone with this email is already in the system.' });
      return;
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpiresAt = new Date(Date.now() + INVITE_VALID_DAYS * 24 * 3600 * 1000);
    // Random and never returned to anyone — the account cannot be signed
    // into until accept-invite overwrites this with a real password.
    const placeholderHash = await hashPassword(crypto.randomBytes(32).toString('hex'));

    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        name: name.trim(),
        email: cleanEmail,
        passwordHash: placeholderHash,
        dept: dept.trim(),
        monthlyCost: 0,
        preset,
        permissions: [],
        active: false,
        inviteToken,
        inviteTokenExpiresAt,
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'User',
        entityId: user.id,
        actorId: req.user!.userId,
        verb: 'user_invited',
        payload: { name: user.name, email: user.email, preset },
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const inviteLink = `${appUrl}/accept-invite?token=${inviteToken}`;

    let emailed = false;
    try {
      await sendMail(orgId, {
        to: user.email,
        subject: "You're invited to Flowzen",
        html: `<p>Hi ${user.name},</p><p>You've been invited to Flowzen. <a href="${inviteLink}">Set your password</a> to get started. This link expires in ${INVITE_VALID_DAYS} days.</p>`,
        text: `Hi ${user.name}, you've been invited to Flowzen. Set your password: ${inviteLink} (expires in ${INVITE_VALID_DAYS} days)`,
      });
      emailed = true;
    } catch (mailErr) {
      logger.error(`Invite email to ${user.email} failed: ${mailErr}`);
    }

    res.status(201).json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, email: user.email, dept: user.dept, preset: user.preset, active: user.active },
        inviteToken,
        inviteLink,
        emailed,
      },
      message: emailed ? `Invite emailed to ${user.email}.` : 'Invite created. Mail did not go out, so share the link yourself.',
    });
  } catch (error) {
    next(error);
  }
});

// ── Edit access and cost ────────────────────────────────────────────────────
//
// `permissions` here is the FULL set of extra switches beyond whatever the
// preset already grants — resolvePermissions unions the two, and there is no
// way to revoke a preset-granted switch for one person short of moving them
// to a smaller preset. That's a real limit of the additive model, not a bug
// this endpoint works around.

const updateSchema = z.object({
  preset: z.nativeEnum(RolePreset).optional(),
  permissions: z.array(z.enum(PERMISSION_KEYS)).optional(),
  monthlyCost: z.number().min(0).optional(),
  dept: z.string().min(1).optional(),
  /**
   * Turning somebody off. Refused with a 409 while they are still holding
   * company equipment, unless `force` says to record it anyway — see the note
   * on the handler below.
   */
  active: z.boolean().optional(),
  force: z.boolean().optional(),
});

usersRouter.patch('/:id', requirePermission('setup.admin'), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const orgId = req.user!.organizationId;
    const id = String(req.params.id);

    const existing = await prisma.user.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }

    const { preset, permissions, monthlyCost, dept, active, force } = parsed.data;

    // ── The offboarding gate ────────────────────────────────────────────────
    //
    // Somebody leaving with a laptop still logged out to them is the single
    // most common way an asset register goes stale — nobody thinks about the
    // MacBook on the day the person stops having an account.
    //
    // A SOFT gate, deliberately. It returns the list and the total book value
    // so the person deactivating can see what they are about to lose track of,
    // and `force: true` goes through anyway. People genuinely do leave with
    // kit, and a register should record reality rather than refuse it.
    if (active === false && existing.active && !force) {
      const held = await prisma.asset.findMany({
        where: { organizationId: orgId, currentHolderId: id, deletedAt: null },
        select: {
          id: true,
          tag: true,
          name: true,
          purchasePrice: true,
          salvageValue: true,
          usefulLifeMonths: true,
          purchasedAt: true,
        },
      });
      if (held.length > 0) {
        const totalBookValue = Math.round(
          held.reduce(
            (sum, a) =>
              sum +
              bookValue({
                purchasePrice: Number(a.purchasePrice),
                salvageValue: Number(a.salvageValue),
                usefulLifeMonths: a.usefulLifeMonths,
                purchasedAt: a.purchasedAt,
              }),
            0,
          ),
        );
        res.status(409).json({
          success: false,
          error: `${existing.name} is still holding ${held.length} item${held.length === 1 ? '' : 's'}.`,
          code: 'ASSETS_STILL_HELD',
          data: {
            assets: held.map((a) => ({ id: a.id, tag: a.tag, name: a.name })),
            // The figure is only meaningful to somebody allowed to see prices.
            totalBookValue: hasPermission(req.user!, 'money.figures') ? totalBookValue : undefined,
          },
        });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(preset !== undefined ? { preset } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
        ...(monthlyCost !== undefined ? { monthlyCost } : {}),
        ...(dept !== undefined ? { dept: dept.trim() } : {}),
        ...(active !== undefined ? { active } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        entityType: 'User',
        entityId: id,
        actorId: req.user!.userId,
        verb: 'user_access_updated',
        payload: { fields: Object.keys(parsed.data) },
      },
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        dept: updated.dept,
        preset: updated.preset,
        permissions: updated.permissions,
        monthlyCost: updated.monthlyCost,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/:id/assets — what one person is holding.
 *
 * Self-serve: anybody may ask about themselves, which is the point. Seeing a
 * MacBook and two lenses listed against your own name on /profile is what
 * actually gets gear returned — far more than any alert does. Asking about
 * somebody ELSE needs `work.team`, the same key the rest of the roster uses.
 *
 * Prices are omitted without `money.figures`, exactly as on the register: what
 * you are responsible for is not the same question as what it cost.
 */
usersRouter.get('/:id/assets', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const id = String(req.params.id);
    const isSelf = id === req.user!.userId;

    if (!isSelf && !hasPermission(req.user!, 'work.team')) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        detail: "Seeing what somebody else is holding requires the 'work.team' permission switch.",
      });
      return;
    }

    const person = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!person) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }

    const assets = await prisma.asset.findMany({
      where: { organizationId: orgId, currentHolderId: id, deletedAt: null },
      orderBy: [{ category: 'asc' }, { tag: 'asc' }],
    });

    const open = await prisma.assetMovement.findMany({
      where: { userId: id, returnedAt: null },
      select: { assetId: true, kind: true, dueAt: true, purpose: true, outAt: true },
    });
    const movementByAsset = new Map(open.map((m) => [m.assetId, m]));

    const canSeeFigures = hasPermission(req.user!, 'money.figures');
    const now = new Date();

    const data = assets.map((a) => {
      const m = movementByAsset.get(a.id);
      const overdue = Boolean(m?.dueAt && m.dueAt < now);
      return {
        id: a.id,
        tag: a.tag,
        name: a.name,
        category: a.category,
        status: a.status,
        condition: a.condition,
        heldSince: m?.outAt ?? null,
        kind: m?.kind ?? null,
        dueAt: m?.dueAt ?? null,
        purpose: m?.purpose ?? null,
        overdue,
        ...(canSeeFigures
          ? {
              purchasePrice: Number(a.purchasePrice),
              bookValue: bookValue({
                purchasePrice: Number(a.purchasePrice),
                salvageValue: Number(a.salvageValue),
                usefulLifeMonths: a.usefulLifeMonths,
                purchasedAt: a.purchasedAt,
              }),
            }
          : {}),
      };
    });

    res.json({ success: true, data, person, assets: data });
  } catch (error) {
    next(error);
  }
});
