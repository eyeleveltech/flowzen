import { Router, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { generateToken } from '../utils/jwt.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { authenticate, type AuthRequest, resolvePermissions } from '../middleware/auth.js';
import { roleForPreset } from '../utils/roles.js';
import { sendMail } from '../utils/mailer.js';

export const authRouter = Router();

const emailKey = (req: { body?: { email?: unknown } }): string =>
  typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

const ipKey = (ip: string | undefined): string => {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':');
};

const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => emailKey(req) || `ip:${ipKey(req.ip)}`,
  message: {
    success: false,
    error: 'Too many attempts for this account. Try again in a few minutes.',
  },
});

const addressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKey(req.ip),
  message: { success: false, error: 'Too many attempts from this network. Try again in a few minutes.' },
});

const authLimiter: RequestHandler = (req, res, next) =>
  addressLimiter(req, res, (err?: unknown) =>
    err ? next(err) : accountLimiter(req, res, next),
  );

const issueSession = (
  res: Response,
  user: { id: string; email: string; organizationId: string; preset: string },
) => {
  const token = generateToken({
    userId: user.id,
    email: user.email,
    preset: user.preset,
    organizationId: user.organizationId,
  });

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return token;
};

// ── Register Workspace ──────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  organizationName: z.string().min(1, 'Organization name is required'),
});

authRouter.post('/register', authLimiter, async (req, res: Response, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    /*
     * Registration creates a workspace, so it is a first-run door, not a
     * sign-up page.
     *
     * It had no gate at all: no invite token, no admin check, nothing but a
     * rate limit and email uniqueness. Anyone who could reach the API could
     * create their own organisation and a MANAGEMENT account inside this
     * deployment. Tenancy is scoped by organizationId so they could not read
     * anybody else's rows — but they would be on the server, in the database,
     * and able to send through whatever SMTP account it is configured with.
     *
     * This instance is one studio's, not a product other people sign up to.
     * So: the first workspace may be created by whoever reaches it first,
     * which is how a fresh deployment gets its admin, and every account after
     * that arrives by invitation (POST /users/invite, setup.admin only).
     */
    const alreadySetUp = await prisma.organization.count();
    if (alreadySetUp > 0) {
      res.status(403).json({
        success: false,
        error: 'This workspace is already set up. Ask an administrator to invite you.',
      });
      return;
    }

    const { name, email, password, organizationName } = parsed.data;
    const cleanEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      res.status(400).json({ success: false, error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await hashPassword(password);

    // Create Organization and Admin User
    const org = await prisma.organization.create({
      data: {
        name: organizationName.trim(),
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        proformaPrefix: 'EL/PI/',
      },
    });

    const adminUser = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: name.trim(),
        email: cleanEmail,
        passwordHash,
        dept: 'Management',
        preset: 'MANAGEMENT',
        monthlyCost: 0,
        permissions: [
          'work.own',
          'work.team',
          'work.all',
          'pipeline.read',
          'pipeline.write',
          'company.read',
          'company.write',
          'money.figures',
          'cost.enter',
          'cost.approve',
          'forecast.view',
          'setup.admin',
        ],
        active: true,
      },
    });

    const effectivePermissions = resolvePermissions(adminUser.preset, adminUser.permissions);
    const token = issueSession(res, adminUser);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        dept: adminUser.dept,
        preset: adminUser.preset,
        role: roleForPreset(adminUser.preset),
        permissions: effectivePermissions,
        organization: {
          id: org.id,
          name: org.name,
          currency: org.currency,
          timezone: org.timezone,
        },
      },
    });
  } catch (error: any) {
    console.error('REGISTRATION ERROR:', error);
    next(error);
  }
});

// ── Login ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', authLimiter, async (req, res: Response, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organization: true },
    });

    if (!user || !user.active) {
      res.status(401).json({ success: false, error: 'Invalid credentials or inactive account' });
      return;
    }

    const validPassword = await comparePassword(password, user.passwordHash);
    if (!validPassword) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const effectivePermissions = resolvePermissions(user.preset, user.permissions);
    const token = issueSession(res, user);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        dept: user.dept,
        preset: user.preset,
        role: roleForPreset(user.preset),
        permissions: effectivePermissions,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          currency: user.organization.currency,
          timezone: user.organization.timezone,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Accept Invite ────────────────────────────────────────────────────────────
//
// The invite (POST /users/invite) already created the row, with a random
// unusable passwordHash and active: false — accepting only activates it and
// sets the real password, same split the frontend's own doc comment expects
// ("Accepting only ACTIVATES the account — the invitation created it").

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post('/accept-invite', authLimiter, async (req, res: Response, next) => {
  try {
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const { token, password } = parsed.data;
    const user = await prisma.user.findFirst({
      where: { inviteToken: token, inviteTokenExpiresAt: { gt: new Date() } },
      include: { organization: true },
    });

    if (!user) {
      res.status(400).json({ success: false, error: 'This invite link is invalid or has expired. Ask whoever invited you to resend it.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const activated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, active: true, inviteToken: null, inviteTokenExpiresAt: null },
    });

    const effectivePermissions = resolvePermissions(activated.preset, activated.permissions);
    const sessionToken = issueSession(res, activated);

    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: activated.id,
        name: activated.name,
        email: activated.email,
        dept: activated.dept,
        preset: activated.preset,
        role: roleForPreset(activated.preset),
        permissions: effectivePermissions,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          currency: user.organization.currency,
          timezone: user.organization.timezone,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Set a New Password From an Admin-Issued Link ────────────────────────────
//
// /reset-password has always been a finished screen pointing at a route that
// was never written, so anybody who forgot their password was locked out for
// good — there is no other way back into an account.
//
// The design is the one that screen documents: no self-service "forgot my
// password" form, because a token has to REACH the person and the deployment
// cannot assume its mail server will. An admin generates the link from the
// Team screen (POST /users/:id/reset-link) and hands it over, exactly as
// invitations already work.


// ── Forgot password ─────────────────────────────────────────────────────────
//
// §16: "Auth | Email and password ... Password reset by email."
//
// Half of this existed: an admin could issue a link from Team, and
// POST /reset-password below consumes it. What was missing was the person
// being able to ask for one themselves — so the login screen said to go and
// find an admin, and out of hours that is the end of the working day.
//
// ─── Why the answer never changes ───────────────────────────────────────────
//
// This endpoint is unauthenticated, so "no account with that address" would
// turn it into a way to find out who works here. It answers identically
// whether the address is a real account, a former employee, or nonsense, and
// it never says whether mail was actually sent. The only party who learns
// anything is whoever can read that inbox.
//
// Rate limited by the same two-stage limiter as login: per address, then per
// account, so a list of guessed addresses gets nowhere.

/** A name goes into the HTML of an email, so it is escaped like any other markup. */
const escapeForMail = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Short, because a live reset link is a live credential. */
const FORGOT_VALID_MINUTES = 60;

const forgotSchema = z.object({
  email: z.string().email('Enter the email address you sign in with'),
});

/** The same reply in every case. Deliberately says "if", not "we have sent". */
const FORGOT_REPLY = {
  success: true,
  message: 'If that address has an account here, a link to set a new password is on its way.',
};

authRouter.post('/forgot-password', authLimiter, async (req, res: Response, next) => {
  try {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, active: true, organizationId: true },
    });

    // An account that has been switched off is not a password problem, and
    // sending a working link to one would quietly undo the switching off.
    if (!user || !user.active) {
      res.json(FORGOT_REPLY);
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + FORGOT_VALID_MINUTES * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiresAt: expiresAt },
    });

    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const link = `${base}/reset-password?token=${token}`;

    try {
      await sendMail(user.organizationId, {
        to: user.email,
        subject: 'Set a new Flowzen password',
        html: `
          <p>Hello ${escapeForMail(user.name)},</p>
          <p>Somebody asked to reset the password for this Flowzen account. If that was you, use the link below — it works once and expires in ${FORGOT_VALID_MINUTES} minutes.</p>
          <p><a href="${link}">Set a new password</a></p>
          <p>If it was not you, nothing has changed and you can ignore this. Your current password still works.</p>
        `,
        text: `Somebody asked to reset the password for this Flowzen account.\n\nIf that was you: ${link}\n\nThe link works once and expires in ${FORGOT_VALID_MINUTES} minutes. If it was not you, nothing has changed.`,
      });
    } catch {
      // Mail not configured, or the server refused it. The reply is the same
      // either way — saying "we could not send it" to an unauthenticated
      // caller confirms the account exists.
    }

    // §16: every update writes an Activity row. Issuing a reset token is one,
    // and it is the row that answers "who asked for this, and when".
    await prisma.activity.create({
      data: {
        organizationId: user.organizationId,
        entityType: 'User',
        entityId: user.id,
        actorId: user.id,
        verb: 'password_reset_requested',
        payload: { expiresInMinutes: FORGOT_VALID_MINUTES },
      },
    });

    res.json(FORGOT_REPLY);
  } catch (error) {
    next(error);
  }
});

const resetSchema = z.object({
  token: z.string().min(1, 'This link is missing its token'),
  password: z.string().min(8, 'Use at least 8 characters'),
});

authRouter.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const { token, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { resetToken: token },
      include: { organization: true },
    });

    // One message for "no such token" and "expired" alike — telling them apart
    // turns a guessed token into a probe for which ones once existed.
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      res.status(400).json({ success: false, error: 'This link has expired. Ask an admin for a fresh one.' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        resetToken: null,
        resetTokenExpiresAt: null,
        // The screen promises every other device is signed out. Stamping this
        // is what makes that true of stateless tokens.
        sessionsValidFrom: new Date(),
        // A locked-out person coming back through a reset link is the same
        // event as accepting an invitation: the account becomes usable.
        active: true,
      },
    });

    const effectivePermissions = resolvePermissions(updated.preset, updated.permissions);
    const sessionToken = issueSession(res, updated);

    await prisma.activity.create({
      data: {
        organizationId: user.organizationId,
        entityType: 'User',
        entityId: user.id,
        actorId: user.id,
        verb: 'password_reset',
        payload: {},
      },
    });

    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        dept: updated.dept,
        preset: updated.preset,
        role: roleForPreset(updated.preset),
        permissions: effectivePermissions,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          currency: user.organization.currency,
          timezone: user.organization.timezone,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Get Current Session User ────────────────────────────────────────────────

authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { organization: true },
    });

    if (!user || !user.active) {
      res.status(401).json({ success: false, error: 'Account not found or inactive' });
      return;
    }

    const effectivePermissions = resolvePermissions(user.preset, user.permissions);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        dept: user.dept,
        preset: user.preset,
        role: roleForPreset(user.preset),
        permissions: effectivePermissions,
        // Strip monthlyCost if user lacks setup.admin
        monthlyCost: effectivePermissions.includes('setup.admin') ? user.monthlyCost : undefined,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          currency: user.organization.currency,
          timezone: user.organization.timezone,
          proformaPrefix: user.organization.proformaPrefix,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Logout ──────────────────────────────────────────────────────────────────

authRouter.post('/logout', (req, res: Response) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ success: true, message: 'Logged out successfully' });
});
