/**
 * The people in the organisation.
 *
 * An invitation CREATES the account; accepting only activates it. That is why a
 * role can be assigned before the person has ever signed in, and why nothing here
 * deletes anybody — a user who owns deals, projects and activities is retired, not
 * removed (master plan §5).
 */

import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  authenticate,
  param,
  requireRole,
  notSelf,
  rankOf,
  highestRole,
  type AuthRequest,
} from '../middleware/auth.js';
import { sendMail, type MailResult } from '../services/mail.js';
import { inviteEmail, passwordResetEmail } from '../services/mail-templates.js';

export const usersRouter = Router();

/**
 * What a screen needs to know about delivery.
 *
 * The raw token goes back either way. When mail is working nobody looks at it;
 * when it is not, it is the whole feature — and a screen that hides the link
 * because it assumed delivery worked leaves an admin with no way to invite
 * anybody (§7.2).
 */
const deliveryOf = (result: MailResult) =>
  result.delivered
    ? { emailed: true as const }
    : { emailed: false as const, emailFailure: result.reason };

/** The name mail goes out under. Falls back only if the row vanished mid-request. */
const orgName = async (organizationId: string): Promise<string> =>
  (
    await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    })
  )?.name ?? 'Flowzen';

usersRouter.use(authenticate);

/** A rule about people was broken. 409, with the sentence that explains it. */
class UserRuleError extends Error {
  readonly code = 'USER_RULE_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'UserRuleError';
  }
}

const onError = (e: unknown, res: Response, next: NextFunction) => {
  if (e instanceof UserRuleError) {
    res.status(409).json({ success: false, error: e.message, code: e.code });
    return;
  }
  next(e);
};

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES', 'MEMBER'] as const;

const present = (u: any) => {
  const led = (u.ledProjects || []).map((p: any) => ({ ...p, isLead: true }));
  const memberOf = (u.projectMembers || []).map((pm: any) => ({ ...pm.project, isLead: false }));
  const allProjectsMap = new Map<string, any>();
  for (const p of [...led, ...memberOf]) {
    if (p && p.id && !allProjectsMap.has(p.id)) {
      allProjectsMap.set(p.id, p);
    }
  }
  const projects = Array.from(allProjectsMap.values());
  const activeProjects = projects.filter((p) => p.status === 'ACTIVE' || p.status === 'PLANNING');

  const tasks = u.assignedTasks || [];
  const now = new Date();
  const openTasks = tasks.filter((t: any) => t.status !== 'DONE');
  const overdueTasks = tasks.filter(
    (t: any) =>
      t.status !== 'DONE' &&
      t.status !== 'ON_HOLD' &&
      t.status !== 'BLOCKED' &&
      t.dueDate &&
      new Date(t.dueDate) < now
  );
  const inProgressTasks = tasks.filter((t: any) => t.status === 'IN_PROGRESS');
  const inReviewTasks = tasks.filter((t: any) => t.status === 'IN_REVIEW');
  const completedTasks = tasks.filter((t: any) => t.status === 'DONE');

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    designation: u.designation,
    phone: u.phone,
    status: u.status,
    department: u.department,
    role: highestRole((u.roles || []).map((r: any) => r.role)),
    joiningDate: u.joiningDate,
    projects,
    activeProjectsCount: activeProjects.length,
    tasks,
    taskStats: {
      total: tasks.length,
      open: openTasks.length,
      inProgress: inProgressTasks.length,
      inReview: inReviewTasks.length,
      completed: completedTasks.length,
      overdue: overdueTasks.length,
    },
    // Which ways in this account has. Shown because removing the last one is
    // refused, and a person deciding needs to see why.
    signIn: {
      password: u.password !== null,
      google: u.googleId !== null,
      provider: u.authProvider,
    },
    // A PENDING account whose link has lapsed needs resending, not chasing.
    inviteExpired: u.status === 'PENDING' && u.inviteExpiry !== null && u.inviteExpiry < new Date(),
  };
};

const SELECT = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  designation: true,
  phone: true,
  status: true,
  authProvider: true,
  password: true,
  googleId: true,
  joiningDate: true,
  inviteExpiry: true,
  department: { select: { id: true, name: true } },
  roles: { select: { role: true } },
  ledProjects: {
    select: {
      id: true,
      name: true,
      status: true,
      dueDate: true,
      company: { select: { id: true, name: true } },
    },
  },
  projectMembers: {
    select: {
      project: {
        select: {
          id: true,
          name: true,
          status: true,
          dueDate: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  },
  assignedTasks: {
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      taskType: true,
      project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
    },
    orderBy: { dueDate: 'asc' },
  },
} as const;

/**
 * Everyone, including the retired.
 *
 * Deactivated people stay in the list. They still own last year's deals, and a
 * list that hides them makes those records look ownerless.
 */
usersRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId },
      select: SELECT,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: users.map(present) });
  } catch (e) {
    next(e);
  }
});

const inviteSchema = z.object({
  email: z.string().email('That does not look like an email address.'),
  name: z.string().min(1, 'A name is needed.'),
  role: z.enum(ROLES),
  designation: z.string().optional().nullable(),
});

/**
 * Invite someone.
 *
 * The link is RETURNED rather than emailed, because no mail account is connected
 * yet (§3.12, and BUILD-STATUS item 3). Returning it means invitations work today
 * by copy and paste; pretending to send one would leave a person waiting for mail
 * that never comes.
 */
usersRouter.post('/invite', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const { email, name, role, designation } = parsed.data;
    const orgId = req.user!.organizationId;

    // Nobody may invite above themselves. Without this an Admin creates a Super
    // Admin and has effectively promoted themselves through a second account.
    if (rankOf(role) > rankOf(req.user!.role)) {
      throw new UserRuleError(
        `You cannot invite someone above your own level. You are ${req.user!.role.replace('_', ' ').toLowerCase()}.`,
      );
    }
    if (role === 'SUPER_ADMIN') {
      throw new UserRuleError(
        'There is one Super Admin per organisation, and the role is transferred rather than granted. Invite them as Admin, then transfer it.',
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, organizationId: true },
    });
    if (existing) {
      throw new UserRuleError(
        existing.organizationId === orgId
          ? `${email} is already in this organisation.`
          : `${email} already has a Flowzen account.`,
      );
    }

    // Stored hashed, sent raw. A leaked database then does not hand over live
    // invitations — the same reason a password is never stored as typed.
    const raw = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(raw).digest('hex');

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name,
          designation: designation ?? null,
          organizationId: orgId,
          // PENDING until they set a password or connect Google. The account
          // exists so the role can be assigned now.
          status: 'PENDING',
          inviteToken: hashed,
          inviteExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedById: req.user!.userId,
        },
        select: SELECT,
      });

      await tx.userRole.create({ data: { userId: created.id, organizationId: orgId, role } });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          userId: req.user!.userId,
          action: 'USER_INVITED',
          entityType: 'User',
          entityId: created.id,
          after: { email, name, role },
        },
      });

      return created;
    });

    // Sent AFTER the transaction, never inside one. Mail is slow and can fail,
    // and an invitation that was rolled back because the mail server hiccuped
    // leaves an account that does not exist and a token that does.
    const invite = inviteEmail({
      orgName: await orgName(orgId),
      inviterName: req.user!.name,
      recipientName: name,
      role,
      token: raw,
    });
    const delivery = await sendMail(orgId, { to: email, ...invite });

    res.status(201).json({
      success: true,
      data: {
        user: present({ ...user, roles: [{ role }] }),
        inviteToken: raw,
        ...deliveryOf(delivery),
      },
      message: delivery.delivered
        ? `Invitation emailed to ${email}.`
        : 'The account is created — send them the link yourself.',
    });
  } catch (e) {
    onError(e, res, next);
  }
});

/** A fresh link for an invitation that lapsed, or was never received. */
usersRouter.post('/:id/resend-invite', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true, email: true, name: true, status: true, roles: { select: { role: true } } },
    });
    if (!user) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }
    if (user.status !== 'PENDING') {
      throw new UserRuleError(`${user.email} has already accepted their invitation.`);
    }

    // A fresh token, which INVALIDATES the previous one. Two live invitations to
    // one account is a second way in that nobody is tracking.
    const raw = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        inviteToken: crypto.createHash('sha256').update(raw).digest('hex'),
        inviteExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const invite = inviteEmail({
      orgName: await orgName(req.user!.organizationId),
      inviterName: req.user!.name,
      recipientName: user.name,
      role: highestRole(user.roles.map((r) => r.role)),
      token: raw,
    });
    const delivery = await sendMail(req.user!.organizationId, { to: user.email, ...invite });

    res.json({ success: true, data: { inviteToken: raw, ...deliveryOf(delivery) } });
  } catch (e) {
    onError(e, res, next);
  }
});

/**
 * A password-reset link for somebody who is locked out.
 *
 * Emailed when the organisation has mail set up, and handed over as a link when
 * it does not. The token comes back either way — a screen that hid it on the
 * assumption that delivery worked would leave an admin unable to help anybody the
 * first time a mail server refused a connection.
 *
 * Still ADMIN-issued rather than self-service. "Forgot password" hands a token to
 * whoever typed the address, so it needs its own rate limiting and its own
 * decisions about enumeration; that is a separate piece of work from being able
 * to send at all.
 */
usersRouter.post('/:id/reset-link', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true, email: true, name: true, status: true, roles: { select: { role: true } } },
    });
    if (!target) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }
    if (target.status !== 'ACTIVE') {
      throw new UserRuleError(
        `${target.email} has not accepted their invitation yet — send a fresh invitation instead.`,
      );
    }
    const targetRole = highestRole(target.roles.map((r) => r.role));
    // Resetting somebody's password is taking over their account. Nobody may do
    // that to a person standing at or above them.
    if (rankOf(targetRole) >= rankOf(req.user!.role) && target.id !== req.user!.userId) {
      throw new UserRuleError(`${target.email} is at or above your level.`);
    }

    const raw = crypto.randomBytes(32).toString('hex');
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          resetToken: crypto.createHash('sha256').update(raw).digest('hex'),
          resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: req.user!.organizationId,
          userId: req.user!.userId,
          action: 'PASSWORD_RESET_ISSUED',
          entityType: 'User',
          entityId: target.id,
          after: { email: target.email },
        },
      });
    });

    const reset = passwordResetEmail({
      orgName: await orgName(req.user!.organizationId),
      recipientName: target.name,
      token: raw,
      // Named, because an unexplained reset mail is indistinguishable from an
      // attack — and the person's first instinct should not be to ignore it.
      issuedBy: req.user!.name,
    });
    const delivery = await sendMail(req.user!.organizationId, { to: target.email, ...reset });

    // One hour, not seven days. A reset link is a way into a live account.
    res.json({
      success: true,
      data: { resetToken: raw, expiresInMinutes: 60, ...deliveryOf(delivery) },
    });
  } catch (e) {
    onError(e, res, next);
  }
});

const roleSchema = z.object({ role: z.enum(ROLES) });

/**
 * Change somebody's role.
 *
 * `notSelf` first: without it the permission system is a suggestion, because any
 * admin could quietly promote themselves and it would read as an ordinary edit
 * (§5). Super Admin is TRANSFERRED — granting a second one is refused, so
 * "who owns this organisation?" always has one answer.
 */
usersRouter.patch('/:id/role', requireRole('ADMIN'), notSelf('id', 'You cannot change your own role.'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const { role } = parsed.data;
    const orgId = req.user!.organizationId;
    const actor = req.user!.role;

    const target = await prisma.user.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId },
      select: { id: true, name: true, email: true, roles: { select: { role: true } } },
    });
    if (!target) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }

    const current = highestRole(target.roles.map((r) => r.role));

    // You cannot set a rung above your own, and you cannot change somebody who
    // already stands above you.
    if (rankOf(role) > rankOf(actor)) {
      throw new UserRuleError(`You cannot grant a level above your own.`);
    }
    if (rankOf(current) >= rankOf(actor) && actor !== 'SUPER_ADMIN') {
      throw new UserRuleError(`${target.name} is at or above your level, so you cannot change their role.`);
    }

    if (role === 'SUPER_ADMIN') {
      if (actor !== 'SUPER_ADMIN') {
        throw new UserRuleError('Only the Super Admin can hand that role on.');
      }
      // A transfer: the outgoing Super Admin becomes an Admin in the same
      // statement, so the organisation is never left with two owners or none.
      await prisma.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: req.user!.userId } });
        await tx.userRole.create({ data: { userId: req.user!.userId, organizationId: orgId, role: 'ADMIN' } });
        await tx.userRole.deleteMany({ where: { userId: target.id } });
        await tx.userRole.create({ data: { userId: target.id, organizationId: orgId, role: 'SUPER_ADMIN' } });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            userId: req.user!.userId,
            action: 'SUPER_ADMIN_TRANSFERRED',
            entityType: 'User',
            entityId: target.id,
            before: { superAdmin: req.user!.email },
            after: { superAdmin: target.email, previousHolderNow: 'ADMIN' },
          },
        });
      });

      res.json({
        success: true,
        data: { role },
        message: `${target.name} is now the Super Admin. You are an Admin.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.create({ data: { userId: target.id, organizationId: orgId, role } });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          userId: req.user!.userId,
          action: 'USER_ROLE_CHANGED',
          entityType: 'User',
          entityId: target.id,
          before: { role: current },
          after: { email: target.email, role },
        },
      });
    });

    res.json({ success: true, data: { role } });
  } catch (e) {
    onError(e, res, next);
  }
});

const editSchema = z.object({
  name: z.string().min(1).optional(),
  designation: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

usersRouter.patch('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const found = await prisma.user.findFirst({
      where: { id: param(req, 'id'), organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!found) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }
    const user = await prisma.user.update({
      where: { id: found.id },
      data: parsed.data,
      select: SELECT,
    });
    res.json({ success: true, data: present(user) });
  } catch (e) {
    next(e);
  }
});

/**
 * Retire somebody.
 *
 * Not a delete. They own deals, projects and activities, and removing the row
 * would either fail on a foreign key or orphan a year of history. The account
 * stops working; the record of what they did does not (§5).
 *
 * `tokenVersion` is bumped so every session they currently hold dies at once —
 * without it, a deactivated person keeps working until their cookie expires.
 */
usersRouter.post('/:id/deactivate', requireRole('ADMIN'), notSelf('id', 'You cannot deactivate your own account.'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const target = await prisma.user.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId },
      select: { id: true, name: true, email: true, status: true, roles: { select: { role: true } } },
    });
    if (!target) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }

    const targetRole = highestRole(target.roles.map((r) => r.role));
    if (targetRole === 'SUPER_ADMIN') {
      throw new UserRuleError(
        'The Super Admin cannot be deactivated. Transfer the role first, then deactivate the account.',
      );
    }
    if (rankOf(targetRole) >= rankOf(req.user!.role) && req.user!.role !== 'SUPER_ADMIN') {
      throw new UserRuleError(`${target.name} is at or above your level.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { status: 'INACTIVE', tokenVersion: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          userId: req.user!.userId,
          action: 'USER_DEACTIVATED',
          entityType: 'User',
          entityId: target.id,
          before: { email: target.email, status: target.status },
          after: { status: 'INACTIVE' },
        },
      });
    });

    res.json({ success: true, data: { status: 'INACTIVE' } });
  } catch (e) {
    onError(e, res, next);
  }
});

usersRouter.post('/:id/activate', requireRole('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const target = await prisma.user.findFirst({
      where: { id: param(req, 'id'), organizationId: orgId },
      select: { id: true, email: true, status: true, password: true, googleId: true },
    });
    if (!target) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }
    // An ACTIVE account must have at least one way in. Reactivating somebody with
    // neither a password nor Google produces an account that exists and cannot
    // be used, which looks like a bug rather than a missing invitation.
    if (!target.password && !target.googleId) {
      throw new UserRuleError(
        `${target.email} has no way to sign in yet. Send them a fresh invitation instead.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          userId: req.user!.userId,
          action: 'USER_ACTIVATED',
          entityType: 'User',
          entityId: target.id,
          before: { email: target.email, status: target.status },
          after: { status: 'ACTIVE' },
        },
      });
    });

    res.json({ success: true, data: { status: 'ACTIVE' } });
  } catch (e) {
    onError(e, res, next);
  }
});
