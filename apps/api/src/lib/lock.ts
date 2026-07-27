import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';

const localLocks = new Map<string, number>();

/**
 * Executes fn only if a distributed lock (or local fallback lock) for `key` can be acquired.
 * Prevents multi-replica duplicate execution of scheduled jobs.
 */
export async function withDistributedLock(
  key: string,
  ttlMs: number,
  fn: () => Promise<void>
): Promise<boolean> {
  let acquired = await redisClient.acquireLock(key, ttlMs);

  if (!acquired) {
    // In-memory fallback if Redis is down/disabled
    const now = Date.now();
    const existingExpiry = localLocks.get(key) || 0;
    if (now < existingExpiry) {
      logger.info(`[Lock] Skipping ${key} (already acquired by another execution/instance)`);
      return false;
    }
    localLocks.set(key, now + ttlMs);
    acquired = true;
  }

  try {
    await fn();
    return true;
  } catch (error) {
    logger.error(`[Lock] Error executing locked job ${key}:`, error);
    return false;
  }
}
