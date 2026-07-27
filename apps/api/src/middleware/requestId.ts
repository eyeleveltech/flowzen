import { Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AuthRequest } from './auth.js';

export function requestIdMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const existing = req.headers['x-request-id'] as string;
  const requestId = existing || `req-${randomUUID().slice(0, 8)}`;

  (req as any).id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
