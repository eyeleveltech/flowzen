/**
 * Signing in, and getting an account in the first place.
 *
 * Google replaces exactly one step — "check the password" — and nothing else. The
 * JWT cookie, `tokenVersion` revocation and every permission check are unchanged
 * by it (master plan §3.12).
 */

import { Router, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { generateToken } from '../utils/jwt.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { authenticate, type AuthRequest, highestRole } from '../middleware/auth.js';
import { bootstrapOrganization, DEFAULT_MODULES } from '../lib/orgDefaults.js';
import { verifyGoogleIdToken } from '../services/google.js';
import crypto from 'node:crypto';

export const authRouter = Router();

/**
 * Two limits, because they are defending against two different things.
 *
 * The first is per ACCOUNT: ten wrong guesses at one email in fifteen minutes.
 * That is what stops somebody working through a password list.
 *
 * The second is per address, and it is deliberately loose. **An agency is behind
 * one office IP.** A single counter for everybody meant that on a Monday morning
 * six people signing in — a couple of them fumbling a password — locked the
 * seventh out with a message telling them to try again later. The limit that
 * matters is on the account being attacked, not on the building it is attacked
 * from.
 *
 * IPv6 is normalised to its /64 prefix. A single machine on IPv6 has an
 * effectively unlimited supply of addresses in its own subnet, so counting whole
 * addresses would let one attacker start again with every request.
 */
const emailKey = (req: { body?: { email?: unknown } }): string =>
  typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

const ipKey = (ip: string | undefined): string => {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':');
};

const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Falls back to the address when there is no email to key on, so a malformed
  // flood is still counted rather than sharing one empty-string bucket.
  keyGenerator: (req) => emailKey(req) || `ip:${ipKey(req.ip)}`,
  message: {
    error: 'Too many attempts for this account. Try again in a few minutes, or reset the password.',
  },
});

const addressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKey(req.ip),
  message: { error: 'Too many attempts from this network. Try again in a few minutes.' },
});

/**
 * The two, as one middleware.
 *
 * Chained by hand rather than passed as an array: Express accepts an array, but
 * it collapses the handler's own `req`/`next` to `any` at every call site, and
 * losing the types on four auth routes is a bad trade for one pair of brackets.
 */
const authLimiter: RequestHandler = (req, res, next) =>
  addressLimiter(req, res, (err?: unknown) =>
    err ? next(err) : accountLimiter(req, res, next),
  );

const issueSession = async (
  res: Response,
  user: { id: string; email: string; organizationId: string; tokenVersion: number },
  roles: string[],
) => {
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: highestRole(roles as never),
    organizationId: user.organizationId,
    tokenVersion: user.tokenVersion,
  } as never);

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

// ── Registration ─────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Use at least 8 characters.'),
  organizationName: z.string().min(1),
});

authRouter.post('/register', authLimiter, async (req, res: Response, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { name, email, password, organizationName } = parsed.data;

    if (await prisma.user.findUnique({ where: { email } })) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: organizationName } });

      // Everything the organisation needs to be usable — the pipeline and its
      // stages, lost reasons, sources, services, modules. Inside the transaction
      // on purpose: an organisation that exists but has no pipeline is worse
      // than a signup that failed, because nothing tells the person it is broken.
      await bootstrapOrganization(tx, organization.id);

      const user = await tx.user.create({
        data: {
          name,
          email,
          password: await hashPassword(password),
          // The creator sets their own password here, so activate immediately.
          // Left PENDING, login would reject them the moment the first cookie
          // expired, and the only route back would be a password reset.
          status: 'ACTIVE',
          organizationId: organization.id,
        },
      });

      // Exactly one Super Admin per organisation. The role is TRANSFERRED
      // afterwards, never granted a second time (§3.10).
      await tx.userRole.create({
        data: { userId: user.id, organizationId: organization.id, role: 'SUPER_ADMIN' },
      });

      return { organization, user };
    },
    // Bootstrapping is around forty statements. The 5s default is enough on a
    // warm database and not on a cold one, and timing out here would leave a
    // person with an account they cannot use.
    { timeout: 30_000 });

    await issueSession(res, result.user, ['SUPER_ADMIN']);

    res.status(201).json({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: 'SUPER_ADMIN',
        organization: { id: result.organization.id, name: result.organization.name },
        enabledModules: [...DEFAULT_MODULES],
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Signing in ───────────────────────────────────────────────────────────────

authRouter.post('/google', authLimiter, async (req, res: Response, next) => {
  try {
    const { idToken } = req.body ?? {};
    if (!idToken) {
      res.status(400).json({ error: 'Google ID token is required' });
      return;
    }

    const payload = await verifyGoogleIdToken(idToken);
    const email = payload.email.toLowerCase().trim();

    // Look up by googleId first, then by email
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: payload.sub }, { email }] },
      include: { organization: true, roles: { select: { role: true } } },
    });

    if (!user) {
      res.status(401).json({ error: 'No account found for this Google email. You must be invited first.' });
      return;
    }

    // Auto-link if they signed in with Google but the account didn't have googleId yet
    if (!user.googleId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { googleId: payload.sub, authProvider: 'GOOGLE' },
      });
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'This account is not active. Ask an admin to re-enable it.' });
      return;
    }

    const roles = user.roles.map((r) => r.role);
    await issueSession(res, user, roles);

    const modules = await prisma.organizationModule.findMany({
      where: { organizationId: user.organizationId, enabled: true },
      select: { key: true },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: highestRole(roles),
        roles,
        organization: { id: user.organization.id, name: user.organization.name },
        enabledModules: modules.map((m) => m.key),
      },
    });
  } catch (error: any) {
    if (error.message?.includes('Invalid Google token') || error.message?.includes('not verified')) {
      res.status(401).json({ error: error.message });
      return;
    }
    next(error);
  }
});

authRouter.post('/login', authLimiter, async (req, res: Response, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email).toLowerCase().trim() },
      include: { organization: true, roles: { select: { role: true } } },
    });

    // One message for "no such account" and "wrong password", so this endpoint
    // cannot be used to find out who has an account.
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.password) {
      // A Google-only account. Say so rather than sending a reset email into the
      // void — the organisation is invite-only, so this admits nothing useful.
      res.status(401).json({
        error: 'This account signs in with Google.',
        code: 'USE_GOOGLE',
      });
      return;
    }

    if (!(await comparePassword(password, user.password))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'This account is not active. Ask an admin to re-enable it.' });
      return;
    }

    if (!user.organization.allowPasswordLogin) {
      res.status(403).json({
        error: 'Your organisation requires signing in with Google.',
        code: 'USE_GOOGLE',
      });
      return;
    }

    const roles = user.roles.map((r) => r.role);
    await issueSession(res, user, roles);

    const modules = await prisma.organizationModule.findMany({
      where: { organizationId: user.organizationId, enabled: true },
      select: { key: true },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: highestRole(roles),
        roles,
        organization: { id: user.organization.id, name: user.organization.name },
        enabledModules: modules.map((m) => m.key),
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', (_req, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true });
});

authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { organization: true, roles: { select: { role: true } } },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const modules = await prisma.organizationModule.findMany({
      where: { organizationId: user.organizationId, enabled: true },
      select: { key: true },
    });

    const roles = user.roles.map((r) => r.role);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        designation: user.designation,
        role: highestRole(roles),
        roles,
        authProvider: user.authProvider,
        hasPassword: Boolean(user.password),
        organization: { id: user.organization.id, name: user.organization.name },
        enabledModules: modules.map((m) => m.key),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Invitations ──────────────────────────────────────────────────────────────

/**
 * Accept an invitation.
 *
 * The invitation CREATED the account; this only activates it — which is why a
 * role can be assigned before the person has ever logged in (§3.12).
 *
 * The account may be activated with a password or with Google, and may later
 * carry both. The one invariant: an ACTIVE account always has at least one way in.
 */
const acceptSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8).optional(),
    googleId: z.string().optional(),
    googleEmail: z.string().email().optional(),
  })
  .refine((v) => v.password || (v.googleId && v.googleEmail), {
    message: 'Set a password or continue with Google.',
  });

authRouter.post('/accept-invite', authLimiter, async (req, res: Response, next) => {
  try {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { token, password, googleId, googleEmail } = parsed.data;

    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { inviteToken: hashed, status: 'PENDING' },
      include: { organization: true, roles: { select: { role: true } } },
    });

    if (!user || !user.inviteExpiry || user.inviteExpiry < new Date()) {
      res.status(400).json({ error: 'This invitation has expired or has already been used.' });
      return;
    }

    // The Google account's email must equal the invited address. Without this
    // check a forwarded invite link hands somebody else's account — and role — to
    // whoever clicks it while signed into their own Google (§3.12).
    if (googleEmail && googleEmail.toLowerCase() !== user.email.toLowerCase()) {
      res.status(403).json({
        error: `This invitation is for ${user.email}. Sign in with that Google account, or set a password instead.`,
      });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        inviteToken: null,
        inviteExpiry: null,
        ...(password ? { password: await hashPassword(password) } : {}),
        ...(googleId ? { googleId, authProvider: 'GOOGLE' } : {}),
      },
    });

    const roles = user.roles.map((r) => r.role);
    await issueSession(res, updated, roles);

    res.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: highestRole(roles),
        organization: { id: user.organization.id, name: user.organization.name },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Add the other sign-in method to an account that already has one.
 *
 * Someone who joined with Google can set a password; someone who joined with a
 * password can connect Google. Whichever is to hand works, and neither route
 * locks anyone out.
 */
authRouter.post('/link', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const { password, googleId, googleEmail } = req.body ?? {};
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

    if (googleEmail && String(googleEmail).toLowerCase() !== user.email.toLowerCase()) {
      res.status(403).json({ error: 'That Google account uses a different email address.' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(password ? { password: await hashPassword(String(password)) } : {}),
        ...(googleId ? { googleId: String(googleId) } : {}),
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Remove a sign-in method.
 *
 * Blocked when it is the last one. An account may never be left with no way in —
 * that locks somebody out permanently and needs an admin to undo (§5).
 */
authRouter.post('/unlink', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const which = req.body?.method;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

    const remaining =
      which === 'password' ? Boolean(user.googleId) : Boolean(user.password);

    if (!remaining) {
      res.status(422).json({
        error: 'That is your only way to sign in. Add the other method first.',
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: which === 'password' ? { password: null } : { googleId: null },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

/**
 * Set a new password from a reset link an admin issued.
 *
 * Unauthenticated by definition — the whole point is that the person cannot sign
 * in. The token is compared as a HASH, so the value stored in the database is not
 * itself usable, and it is cleared on success so a link works exactly once.
 */
authRouter.post('/reset-password', authLimiter, async (req, res: Response, next) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const hashed = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { resetToken: hashed, status: 'ACTIVE' },
      include: { organization: true, roles: { select: { role: true } } },
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      // Deliberately one message for both "no such token" and "expired". Telling
      // them apart tells someone probing which guesses were close.
      res.status(400).json({ error: 'This link has expired or has already been used.' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(parsed.data.password),
        resetToken: null,
        resetTokenExpiry: null,
        // Every session issued before the reset dies. A reset that leaves the
        // attacker's cookie working has achieved nothing.
        tokenVersion: { increment: 1 },
      },
    });

    const roles = user.roles.map((r) => r.role);
    await issueSession(res, updated, roles);

    res.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: highestRole(roles),
        organization: { id: user.organization.id, name: user.organization.name },
      },
    });
  } catch (error) {
    next(error);
  }
});
