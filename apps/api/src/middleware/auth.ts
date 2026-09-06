import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt.js';
import { prisma } from '../lib/prisma.js';
import {
  type PermissionKey,
  ROLE_PRESET_PERMISSIONS,
  type RolePreset,
} from '@flowzen/shared';

export interface UserSession {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  preset: RolePreset;
  permissions: PermissionKey[];
  active: boolean;
}

export interface AuthRequest extends Request {
  user?: UserSession;
}

/**
 * Resolves all permissions for a user from their preset and custom overrides.
 */
export function resolvePermissions(preset: RolePreset, customPermissions: (PermissionKey | string)[] = []): PermissionKey[] {
  const defaults = ROLE_PRESET_PERMISSIONS[preset] || [];
  return Array.from(new Set([...defaults, ...(customPermissions as PermissionKey[])]));
}

/**
 * Checks whether a user has a specific permission key.
 */
export function hasPermission(user: UserSession, permission: PermissionKey): boolean {
  if (!user.active) return false;
  // setup.admin or MANAGEMENT has universal master bypass
  if (user.permissions.includes('setup.admin') || user.preset === 'MANAGEMENT') {
    return true;
  }
  return user.permissions.includes(permission);
}

/**
 * Live session resolver & JWT authenticating middleware.
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let token: string | undefined;

    // 1. Bearer header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // 2. Cookie fallback
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      res.status(401).json({ success: false, error: 'Authentication token missing' });
      return;
    }

    const payload = verifyJwt(token);
    if (!payload || !payload.userId) {
      res.status(401).json({ success: false, error: 'Invalid or expired session' });
      return;
    }

    // Resolve user state from database
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        organizationId: true,
        email: true,
        name: true,
        preset: true,
        permissions: true,
        active: true,
        sessionsValidFrom: true,
      },
    });

    if (!dbUser || !dbUser.active) {
      res.status(401).json({ success: false, error: 'User account is inactive or removed' });
      return;
    }

    // A password change stamps `sessionsValidFrom`, which retires every token
    // issued before it — the "you will be signed out everywhere" the profile
    // screen promises. `iat` is whole seconds, so the instant is floored to the
    // second; a token minted in the same second as the change survives, which
    // is the new one being issued by that very request.
    if (dbUser.sessionsValidFrom && typeof payload.iat === 'number') {
      const validFrom = Math.floor(dbUser.sessionsValidFrom.getTime() / 1000);
      if (payload.iat < validFrom) {
        res.status(401).json({ success: false, error: 'Session ended. Please sign in again.' });
        return;
      }
    }

    // Calculate effective permissions
    const presetKey = (dbUser.preset as RolePreset) || 'EMPLOYEE';
    const presetDefaults = ROLE_PRESET_PERMISSIONS[presetKey] || [];
    const customPermissions = (dbUser.permissions as PermissionKey[]) || [];
    const effectivePermissions = Array.from(new Set([...presetDefaults, ...customPermissions]));

    req.user = {
      userId: dbUser.id,
      organizationId: dbUser.organizationId,
      email: dbUser.email,
      name: dbUser.name,
      preset: presetKey,
      permissions: effectivePermissions,
      active: dbUser.active,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware: Requires a specific permission key.
 */
export function requirePermission(permission: PermissionKey) {
  return function permissionGate(req: AuthRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (!hasPermission(req.user, permission)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        detail: `This action requires the '${permission}' permission switch.`,
      });
      return;
    }

    next();
  };
}

/**
 * Legacy compatibility alias for existing role checks
 */
export function requireRole(minRole: string) {
  return function roleGate(req: AuthRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const map: Record<string, PermissionKey> = {
      MEMBER: 'work.own',
      SALES: 'pipeline.read',
      MANAGER: 'work.team',
      ADMIN: 'setup.admin',
      SUPER_ADMIN: 'setup.admin',
    };
    const needed = map[minRole] || 'work.own';
    if (!hasPermission(req.user, needed)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Legacy module gate compatibility
 */
export function requireModule(_mod: string) {
  return function moduleGate(_req: AuthRequest, _res: Response, next: NextFunction): void {
    next();
  };
}

/**
 * Self-action guard.
 */
export function notSelf(paramName = 'id', message = 'You cannot perform this action on your own account.') {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (req.user && req.params[paramName] === req.user.userId) {
      res.status(403).json({ success: false, error: message });
      return;
    }
    next();
  };
}
