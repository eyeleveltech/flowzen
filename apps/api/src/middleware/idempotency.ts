import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../lib/redis.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// In-memory fallback if Redis is completely down
const fallbackCache = new Map<string, { status: number; body: any; timestamp: number }>();
const FALLBACK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function idempotency(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-idempotency-key'] as string;

  if (!key) {
    // If no key is provided, just proceed normally.
    // In strict environments, you might return 400 Bad Request here.
    next();
    return;
  }

  // Scope the key to the user and the path to prevent collisions
  const userId = (req as any).user?.userId || 'anonymous';
  const idempotencyKey = `idempotency:${userId}:${req.path}:${key}`;

  // Use an async IIFE to handle the logic without blocking the synchronous middleware return
  (async () => {
    try {
      // 1. Check Redis
      const cachedResponse = await redisClient.get(idempotencyKey);
      
      if (cachedResponse) {
        logger.info(`[Idempotency] Short-circuiting request, returning cached response for key: ${key}`);
        const parsed = JSON.parse(cachedResponse);
        res.status(parsed.status).json(parsed.body);
        return;
      }

      // 1b. Check In-Memory Fallback
      const fallback = fallbackCache.get(idempotencyKey);
      if (fallback) {
        if (Date.now() - fallback.timestamp < FALLBACK_TTL_MS) {
          logger.info(`[Idempotency] Returning fallback memory response for key: ${key}`);
          res.status(fallback.status).json(fallback.body);
          return;
        } else {
          fallbackCache.delete(idempotencyKey);
        }
      }

      // 2. Wrap res.json to cache the response before sending it
      const originalJson = res.json.bind(res);

      res.json = (body: any): any => {
        // Only cache successful or expected-client-error responses (2xx, 4xx).
        // Don't cache 5xx server errors because we want the client to be able to retry.
        if (res.statusCode >= 200 && res.statusCode < 500) {
          const responseToCache = {
            status: res.statusCode,
            body,
          };

          // Store in Redis (24 hour TTL)
          redisClient.set(idempotencyKey, JSON.stringify(responseToCache), 24 * 60 * 60)
            .catch(err => logger.error(`[Idempotency] Failed to cache in Redis: ${err}`));

          // Store in Memory Fallback
          fallbackCache.set(idempotencyKey, { ...responseToCache, timestamp: Date.now() });
        }

        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.error(`[Idempotency] Error processing key: ${error}`);
      next(); // Proceed anyway so the app doesn't break
    }
  })();
}
