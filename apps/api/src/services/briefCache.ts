import { ttlCache } from '../utils/ttlCache.js';

/**
 * The composed Monday brief, held a minute (Perf Plan 2, decision 2).
 *
 * The brief is the heaviest read in the app — the scoreboard, every open
 * alert, the week ahead, the team — and Management open it together on Monday
 * morning. Held per organisation, week and audience: what a reader is shown
 * depends on whether they are Management (the "Not using Flowzen" line) and
 * on which screens they can open (a row only links where they can follow), so
 * readers who would be shown different things never share an entry.
 *
 * Its own module so services/briefSummary.ts can clear it without importing
 * the route.
 */
const BRIEF_KEEP_MS = 60_000;

export const briefCache = ttlCache<unknown>(BRIEF_KEEP_MS, 200);

export const briefKey = (orgId: string, weekFrom: string, audience: string) => `${orgId}|${weekFrom}|${audience}`;

/** Forget an organisation's briefs — its summary was just written again. */
export const forgetBrief = (orgId: string) => briefCache.forgetPrefix(`${orgId}|`);
