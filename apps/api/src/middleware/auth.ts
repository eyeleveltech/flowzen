import { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { verifyToken, JwtPayload } from '../utils/jwt.js';
import { prisma } from '../lib/prisma.js';

export interface AuthUser {
  userId: string;
  email: string;
  /** Who the message is FROM. Mail signed "an administrator" reads as spam. */
  name: string;
  organizationId: string;
  /** Every rung the user holds. Stored as a set; today there is one (§3.10). */
  roles: Role[];
  /** The highest rung, which is what every permission check compares against. */
  role: Role;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * A route parameter as a string.
 *
 * Express types params as `string | string[]`, because a pattern can capture
 * repeats. Ours never do, and threading that union into every Prisma `where`
 * turns a clear query into an unreadable type error.
 */
export const param = (req: Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
};

/** A query-string value as a string, or undefined. */
export const queryParam = (req: Request, name: string): string | undefined => {
  const value = req.query[name];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? String(value[0]) : String(value);
};

/**
 * The ladder. Each rung contains everything below it, so a permission check is a
 * comparison rather than a set membership test — and "what can this person do?"
 * is answered by reading one word (master plan §3.10).
 */
const RANK: Record<Role, number> = {
  MEMBER: 0,
  SALES: 1,
  MANAGER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

export const rankOf = (role: Role): number => RANK[role];

/**
 * Does this rung reach that one?
 *
 * For decisions INSIDE a handler, where a 403 is the wrong answer because the
 * record should simply come back thinner — the "field" level of the three checks
 * in §3.10. `requireRole` is the "page" level and answers with a 403; this
 * answers with a smaller object.
 *
 * It exists because the alternative keeps being written by hand as
 * `role === 'MEMBER'`, which is an EXACT comparison on a ladder. That catches
 * one rung and silently lets every rung above it through, which is how a
 * salesperson ended up able to close other people's delivery work.
 */
export const atLeast = (role: Role, minimum: Role): boolean => RANK[role] >= RANK[minimum];

/** The highest rung held. An empty set is treated as MEMBER, never as no access. */
export const highestRole = (roles: Role[]): Role =>
  roles.length === 0
    ? 'MEMBER'
    : roles.reduce((best, r) => (RANK[r] > RANK[best] ? r : best), 'MEMBER' as Role);

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let token = req.cookies?.token;

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        organizationId: true,
        tokenVersion: true,
        roles: { select: { role: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({ error: 'Account is inactive' });
      return;
    }

    // A password change, reset or forced logout bumps tokenVersion, invalidating
    // every JWT issued before it.
    if ((decoded.tokenVersion ?? 0) !== user.tokenVersion) {
      res.status(401).json({ error: 'Session expired, please sign in again' });
      return;
    }

    // Roles are read LIVE from the database on every request, never from the
    // token. A role change takes effect on the person's next click; a role cached
    // in a JWT stays wrong until the token expires (§3.10).
    const roles = user.roles.map((r) => r.role);

    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      roles,
      role: highestRole(roles),
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require at least this rung.
 *
 * `requireRole('MANAGER')` admits Manager, Admin and Super Admin, because the
 * ladder means each contains the ones below. Listing every acceptable role at
 * every call site is how one gets forgotten when a rung is added.
 */
export function requireRole(minimum: Role) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (rankOf(req.user.role) < RANK[minimum]) {
      res.status(403).json({
        error: 'Insufficient permissions',
        detail: `This needs ${minimum.replace('_', ' ').toLowerCase()} access or above.`,
      });
      return;
    }

    next();
  };
}

/** Money is the boundary that matters — everything else in an agency is worth sharing. */
export const requireMoneyAccess = requireRole('ADMIN');

/**
 * Gate a route to organisations with a module switched on.
 *
 * The key is a plain string so a new module needs no migration — insert a row,
 * gate the routes, gate the navigation (§7.5).
 */
export function requireModule(...keys: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      const found = await prisma.organizationModule.findFirst({
        where: { organizationId: req.user.organizationId, key: { in: keys }, enabled: true },
        select: { id: true },
      });
      if (!found) {
        res.status(403).json({ error: 'This module is not enabled for your organization' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Nobody applies this to themselves.
 *
 * Without it the permission system is a suggestion — any admin could quietly
 * promote themselves, and the audit trail would show it as an ordinary edit (§5).
 * The message is per-route because "you cannot change your own role" is wrong
 * and confusing on the deactivate endpoint.
 */
export function notSelf(paramName = 'id', message = 'You cannot do that to your own account.') {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (req.user && req.params[paramName] === req.user.userId) {
      res.status(403).json({ error: message });
      return;
    }
    next();
  };
}
