import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

let redis: Redis | null = null;
let isConnected = false;

// Default to localhost if running outside docker but wanting to use redis,
// or check REDIS_URL if provided.
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

try {
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1, // Don't hang forever
    enableOfflineQueue: false, // Don't queue commands if not connected
    retryStrategy(times) {
      // Retry 3 times, then give up to avoid infinite loops if Redis is completely down
      if (times > 3) {
        logger.warn('Redis connection failed, giving up. Caching will be disabled.');
        return null;
      }
      return Math.min(times * 50, 2000);
    },
  });

  redis.on('connect', () => {
    isConnected = true;
    logger.info('Connected to Redis successfully');
  });

  redis.on('error', (err) => {
    isConnected = false;
    // We only log a warning to allow the app to continue running without caching
    logger.warn(`Redis connection error: ${err.message}. Caching will gracefully fail open.`);
  });
} catch (error) {
  logger.warn('Failed to initialize Redis client. Caching disabled.');
}

/**
 * Safe wrapper around Redis operations that gracefully fails if Redis is down.
 */
export const redisClient = {
  get: async (key: string): Promise<string | null> => {
    if (!redis || !isConnected) return null;
    try {
      return await redis.get(key);
    } catch {
      return null;
    }
  },
  
  set: async (key: string, value: string, ttlSeconds: number = 300): Promise<void> => {
    if (!redis || !isConnected) return;
    try {
      await redis.setex(key, ttlSeconds, value);
    } catch {
      // Ignore set errors to not break the API
    }
  },

  delPrefix: async (prefix: string): Promise<void> => {
    if (!redis || !isConnected) return;
    try {
      // Use SCAN to find keys matching the prefix, then DEL them
      let cursor = '0';
      do {
        const result = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = result[0];
        const keys = result[1];
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err: any) {
      logger.error(`Failed to delete cache prefix ${prefix}: ${err.message}`);
    }
  }
};
