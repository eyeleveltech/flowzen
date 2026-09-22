'use client';

/**
 * Tell the list screens that a detail screen changed something.
 *
 * ─── The gap this closes ────────────────────────────────────────────────────
 *
 * The app is built two ways at once. The list screens — live-work, money,
 * my-work, companies — read through React Query. The detail screens —
 * `retainers/[id]`, `projects/[id]`, `companies/[id]` — predate that and fetch
 * into `useState`, holding no `queryClient` at all between them.
 *
 * That works fine for themselves: each reloads its own data after a write. But
 * completing a task on a retainer moves a figure on /live-work, and closing a
 * month moves one on /money, and those screens were never told. With
 * `refetchOnWindowFocus` off and the SSE layer emitting nothing, in-app
 * navigation would show the figures from before the change.
 *
 * ─── Why invalidating costs nothing here ────────────────────────────────────
 *
 * `invalidateQueries` refetches only queries that are currently MOUNTED, and
 * marks the rest stale. None of these keys are mounted while you are on a
 * detail page, so this makes no request — it just guarantees the next visit
 * re-asks instead of serving a cached figure that is now wrong.
 *
 * Which is why it is safe to call from inside the pages' existing reload
 * functions rather than threading it through all fifteen write sites.
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** The list caches a detail-page write can invalidate the truth of. */
const AFFECTED = [
  ['tasks'],
  ['live-work'],
  ['money'],
  ['costs'],
  ['invoices'],
  ['companies'],
  ['pipeline'],
  ['proposals'],
] as const;

export function useWorkCacheNudge() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    for (const queryKey of AFFECTED) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);
}
