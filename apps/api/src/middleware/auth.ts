import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@flowzen/shared';
import { verifyToken, JwtPayload } from '../utils/jwt.js';
import { prisma } from '../lib/prisma.js';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
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
      select: { id: true, role: true, status: true, organizationId: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({ error: 'Account is inactive' });
      return;
    }

    req.user = {
      userId: user.id,
      email: decoded.email,
      role: user.role,               // live from DB
      organizationId: user.organizationId,  // live from DB
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (roles.length > 0 && !roles.includes(req.user.role as UserRole)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

// Gate a router/route to organizations that have at least one of the given
// modules enabled (e.g. requireModule('CRM') or requireModule('CRM','PM')).
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
