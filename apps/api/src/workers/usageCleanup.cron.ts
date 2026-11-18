import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { closeOldFeedbackReplies } from '../services/feedback.js';
import { raiseUsageReviews } from '../services/usageReview.js';

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

/**
 * The daily tidy-up, and the bells that hang off usage (Ease Plan 3): the
 * "your note was looked at" bells past two weeks are closed.
 */
export async function dailyUsageWork(now = new Date()): Promise<void> {
  await cleanUpUsage(now);
  const closed = await closeOldFeedbackReplies(now);
  if (closed) logger.info(`Usage clean-up: ${closed} feedback reply bells over two weeks old closed`);
}

/** Early in the month, "Usage review for October is ready" (services/usageReview.ts). */
async function monthlyReview(now = new Date()): Promise<void> {
  const raised = await raiseUsageReviews(now);
  if (raised) logger.info(`Usage review bells raised for ${raised} organisation(s)`);
}

/**
 * Once at start, then once a day; the monthly review is looked for hourly,
 * so it arrives early on the studio's 1st rather than whenever the server's
 * day happens to come round. Nothing in tests.
 */
export function startUsageCleanup(intervalMs = 24 * 60 * 60 * 1000, reviewEveryMs = 60 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test') return;
  dailyUsageWork().catch((e) => logger.error(`Usage clean-up error: ${e}`));
  monthlyReview().catch((e) => logger.error(`Usage review error: ${e}`));
  setInterval(() => {
    dailyUsageWork().catch((e) => logger.error(`Usage clean-up error: ${e}`));
  }, intervalMs);
  setInterval(() => {
    monthlyReview().catch((e) => logger.error(`Usage review error: ${e}`));
  }, reviewEveryMs);
}
