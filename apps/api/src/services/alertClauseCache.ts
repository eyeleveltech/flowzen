import type { Prisma } from '@prisma/client';
import type { UserSession } from '../middleware/auth.js';
import { ttlCache } from '../utils/ttlCache.js';

/**
 * Who may be told what, per person, held a minute (Perf Plan 2, decision 4).
 *
 * The bell works out a person's clause set — their rules, their team's
 * tasks, their own tasks, their events — on every open, every "Mark all
 * read" and every row read. It is the same answer for a minute at a time.
 *
 * Cleared for the whole organisation whenever new alerts are announced
 * (`notification:new`): a clause can name the alerts or events it covers, so
 * a set worked out before a new one was raised might not reach it, and the
 * bell refetches the moment that announcement lands. Push and the morning
 * digest never use this — they work the set out fresh, at the moment they send.
 *
 * Its own small module so the scanner and the calendar can clear it without
 * loading the bell's route.
 */
const CLAUSES_KEEP_MS = 60_000;

export const alertClauseCache = ttlCache<Prisma.AlertWhereInput[]>(CLAUSES_KEEP_MS, 2000);

/** One entry per person and permission set, so a changed preset is never answered from the old one. */
export const alertClauseKey = (user: UserSession): string =>
  `${user.organizationId}|${user.userId}|${user.preset}|${user.active ? 1 : 0}|${[...user.permissions].sort().join(',')}`;

/** New alerts were raised: every bell in the organisation works its clauses out again. */
export const forgetAlertClauses = (organizationId: string): void => alertClauseCache.forgetPrefix(`${organizationId}|`);
