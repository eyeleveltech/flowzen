import { logger } from '../utils/logger.js';
import { googleConfigured, processPushQueue, syncAllBusy } from '../services/googleCalendar.js';

/**
 * Google Calendar's two clocks.
 *
 *   · every 5 minutes, the push queue: Flowzen changes that could not reach
 *     somebody's Google the moment they were saved, retried up to five times;
 *   · every 15 minutes (every third pass), busy time read from each connected
 *     person's primary calendar.
 *
 * Only for ACTIVE connections in organisations that have switched it on, and
 * nothing at all when the server has no Google keys or in tests.
 */
export function startGoogleCalendarWorker(intervalMs = 5 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test' || !googleConfigured()) return;
  let pass = 0;
  const tick = async () => {
    try {
      await processPushQueue();
      if (pass % 3 === 0) await syncAllBusy();
    } catch (e) {
      logger.error(`Google Calendar worker error: ${e instanceof Error ? e.message : e}`);
    } finally {
      pass++;
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs);
}
