import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { redisClient } from '../lib/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware to cache Express JSON responses in Redis.
 * The cache key is constructed using: orgId + userId + originalUrl
 * 
 * @param ttlSeconds Time to live in seconds (default 300 / 5 mins)
 */
export const cacheMiddleware = (ttlSeconds: number = 300) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Require auth data to securely partition cache
    if (!req.user?.organizationId) {
      return next();
    }

    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    // Prefix cache key with organization ID to make it easy to invalidate an entire org's cache
    const cacheKey = `cache:org:${orgId}:user:${userId}:${req.originalUrl}`;

    try {
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        // Cache HIT
        logger.info(`[CACHE HIT] ${req.originalUrl}`);
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Type', 'application/json');
        return res.send(cachedData);
      }

      // Cache MISS
      logger.info(`[CACHE MISS] ${req.originalUrl} - fetching from DB`);
      
      // We need to intercept the res.json() call to capture the payload
      const originalJson = res.json.bind(res);
      
      res.json = (body: any) => {
        // Don't cache error responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redisClient.set(cacheKey, JSON.stringify(body), ttlSeconds).catch(err => {
            logger.error(`Failed to set cache for ${cacheKey}: ${err.message}`);
          });
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      next();
    } catch (err) {
      // If anything fails in cache middleware, gracefully continue without caching
      logger.error('Cache middleware error', { error: err });
      next();
    }
  };
};
