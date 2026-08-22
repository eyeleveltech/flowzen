/**
 * The cron that drives the daily scanner.
 *
 * One organisation, one timezone, one cron (master plan §3.11). The columns
 * make a per-org schedule cheap later; building it now buys nothing.
 *
 * Guarded by NODE_ENV — tests must not spawn real cron jobs, and the journey
 * test runs the scanner directly when it needs one.
 */

import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { runDailyScanAll } from '../services/scanner.js';

let scheduled: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the daily scanner cron.
 *
 * Runs at 08:00 server time. For a single-org install this is the org's morning.
 * When multiple organisations exist across zones, the scanner itself reads each
 * org's timezone for day-boundary calculations — the cron just starts the work,
 * it does not decide what "today" means.
 */
export const startScannerCron = (): void => {
  if (process.env.NODE_ENV === 'test') return;
  if (scheduled) return; // idempotent

  // Every day at 08:00
  scheduled = cron.schedule('0 8 * * *', async () => {
    logger.info('[cron] Daily scanner starting');
    try {
      await runDailyScanAll();
      logger.info('[cron] Daily scanner finished');
    } catch (e) {
      logger.error(`[cron] Daily scanner failed: ${(e as Error).message}`);
    }
  });

  logger.info('[cron] Daily scanner scheduled for 08:00 every day');
};

/** Stop the cron. For graceful shutdown and tests. */
export const stopScannerCron = (): void => {
  if (scheduled) {
    scheduled.stop();
    scheduled = null;
  }
};
