import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { API_KEY_RULE } from '../services/alertRules.js';
import { IDEMPOTENCY_HOURS } from '../middleware/apiKey.js';

/** How long an API key's call log is kept (API Plan 1, decision 6). Settings → API says so. */
export const API_LOG_KEEP_DAYS = 30;

/** How long "API key 'n8n' created" stays in the bell before it closes itself. */
const API_KEY_BELL_DAYS = 14;

/**
 * Once a day: API call logs older than 30 days, Idempotency-Keys older than
 * a day, and API key bells older than a fortnight. Only these — the Activity
 * log is the app's audit history and keeps its own rules.
 */
export async function cleanUpApi(now = new Date()) {
  const logsBefore = new Date(now.getTime() - API_LOG_KEEP_DAYS * 86_400_000);
  const retriesBefore = new Date(now.getTime() - IDEMPOTENCY_HOURS * 3_600_000);
  const bellsBefore = new Date(now.getTime() - API_KEY_BELL_DAYS * 86_400_000);
  const [logs, retries, bells] = await Promise.all([
    prisma.apiRequestLog.deleteMany({ where: { at: { lt: logsBefore } } }),
    prisma.apiIdempotency.deleteMany({ where: { createdAt: { lt: retriesBefore } } }),
    prisma.alert.updateMany({
      where: { rule: API_KEY_RULE, resolvedAt: null, createdAt: { lt: bellsBefore } },
      data: { resolvedAt: now },
    }),
  ]);
  if (logs.count || retries.count) {
    logger.info(`API clean-up: ${logs.count} call log rows, ${retries.count} idempotency keys removed`);
  }
  return { logs: logs.count, retries: retries.count, bells: bells.count };
}

/** Once at start, then once a day. Nothing in tests. */
export function startApiCleanup(intervalMs = 24 * 60 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test') return;
  const run = () => cleanUpApi().catch((e) => logger.error(`API clean-up error: ${e}`));
  void run();
  setInterval(run, intervalMs);
}
