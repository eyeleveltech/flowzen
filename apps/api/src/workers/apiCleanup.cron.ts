import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { API_KEY_RULE } from '../services/alertRules.js';
import { IDEMPOTENCY_HOURS } from '../middleware/apiKey.js';

/** How long an API key's call log is kept (API Plan 1, decision 6). Settings → API says so. */
export const API_LOG_KEEP_DAYS = 30;

/** How long "API key 'n8n' created" stays in the bell before it closes itself. */
const API_KEY_BELL_DAYS = 14;

/** How long a dead OAuth token or code stays, for the "already used" checks that read it. */
const OAUTH_DEAD_KEEP_DAYS = 7;
/** A client that registered and never signed anybody in is forgotten after this. */
const OAUTH_UNUSED_CLIENT_DAYS = 30;

/**
 * Once a day: API call logs older than 30 days, Idempotency-Keys older than
 * a day, API key bells older than a fortnight, and the sign-in leftovers of
 * API Plan 2 — expired codes and tokens, and clients nobody ever connected
 * through. Only these — the Activity log is the app's audit history and
 * keeps its own rules.
 */
export async function cleanUpApi(now = new Date()) {
  const logsBefore = new Date(now.getTime() - API_LOG_KEEP_DAYS * 86_400_000);
  const retriesBefore = new Date(now.getTime() - IDEMPOTENCY_HOURS * 3_600_000);
  const bellsBefore = new Date(now.getTime() - API_KEY_BELL_DAYS * 86_400_000);
  const deadBefore = new Date(now.getTime() - OAUTH_DEAD_KEEP_DAYS * 86_400_000);
  const clientsBefore = new Date(now.getTime() - OAUTH_UNUSED_CLIENT_DAYS * 86_400_000);
  const [logs, retries, bells, codes, tokens, clients] = await Promise.all([
    prisma.apiRequestLog.deleteMany({ where: { at: { lt: logsBefore } } }),
    prisma.apiIdempotency.deleteMany({ where: { createdAt: { lt: retriesBefore } } }),
    prisma.alert.updateMany({
      where: { rule: API_KEY_RULE, resolvedAt: null, createdAt: { lt: bellsBefore } },
      data: { resolvedAt: now },
    }),
    prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: deadBefore } } }),
    prisma.oAuthToken.deleteMany({ where: { OR: [{ expiresAt: { lt: deadBefore } }, { revokedAt: { lt: deadBefore } }] } }),
    prisma.oAuthClient.deleteMany({ where: { createdAt: { lt: clientsBefore }, grants: { none: {} } } }),
  ]);
  if (logs.count || retries.count || codes.count || tokens.count || clients.count) {
    logger.info(
      `API clean-up: ${logs.count} call log rows, ${retries.count} idempotency keys, ${codes.count} sign-in codes, ${tokens.count} tokens, ${clients.count} unused clients removed`,
    );
  }
  return { logs: logs.count, retries: retries.count, bells: bells.count, codes: codes.count, tokens: tokens.count, clients: clients.count };
}

/** Once at start, then once a day. Nothing in tests. */
export function startApiCleanup(intervalMs = 24 * 60 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test') return;
  const run = () => cleanUpApi().catch((e) => logger.error(`API clean-up error: ${e}`));
  void run();
  setInterval(run, intervalMs);
}
