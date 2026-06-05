import { redisClient } from './redis.js';
import { logger } from '../utils/logger.js';

/**
 * Invalidates the entire dashboard cache for a specific organization.
 * Used whenever a project, task, or client is created, updated, or deleted,
 * to ensure that the dashboard statistics are always real-time.
 * 
 * @param orgId The organization ID to clear cache for
 */
export const invalidateOrganizationCache = async (orgId: string): Promise<void> => {
  if (!orgId) return;
  
  try {
    // Delete all keys matching the prefix for this organization
    const prefix = `cache:org:${orgId}:`;
    await redisClient.delPrefix(prefix);
    logger.info(`[CACHE INVALIDATED] Cleared dashboard cache for org: ${orgId}`);
  } catch (error: any) {
    logger.error(`Error invalidating cache for org ${orgId}: ${error.message}`);
  }
};
