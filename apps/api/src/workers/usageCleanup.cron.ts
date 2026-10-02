import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

/** How long screen-open history is kept. People are told this on their Profile. */
export const USAGE_KEEP_DAYS = 90;

/**
 * Deletes usage rows older than 90 days. Only UsageDay — the Activity log is
 * the app's audit history and keeps its own rules.
 */
export async function cleanUpUsage(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - USAGE_KEEP_DAYS * 86_400_000);
  cutoff.setUTCHours(0, 0, 0, 0);
  const { count } = await prisma.usageDay.deleteMany({ where: { day: { lt: cutoff } } });
  if (count) logger.info(`Usage clean-up: ${count} rows older than ${USAGE_KEEP_DAYS} days deleted`);
  return count;
}

/** Once at start, then once a day. Nothing in tests. */
export function startUsageCleanup(intervalMs = 24 * 60 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test') return;
  cleanUpUsage().catch((e) => logger.error(`Usage clean-up error: ${e}`));
  setInterval(() => {
    cleanUpUsage().catch((e) => logger.error(`Usage clean-up error: ${e}`));
  }, intervalMs);
}
