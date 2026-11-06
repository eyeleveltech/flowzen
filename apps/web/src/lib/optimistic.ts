/**
 * Change the screen now, save after, and put it back if the save fails
 * (Perf Plan 1, decision 6).
 *
 * A tick, a status, a due date or a "working on now" used to wait for the
 * round trip before anything moved — a second on a phone, during which the
 * click looked ignored. Now the cached list is changed first, the request is
 * sent second, and if the server refuses or fails the cache goes back to
 * exactly what it held, with "Couldn't save — changed back" and the server's
 * own reason.
 *
 * Only for a change the rules allow: never show optimistically what the
 * server would refuse. A screen that is not sure asks first (the "Waiting
 * on…" question before On hold), and only then changes what it shows.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ApiError } from '@/lib/api-v2';

export const CHANGED_BACK = 'Couldn’t save — changed back';

/** The toast's words: the fixed phrase, then the server's reason when there is one. */
export function changedBackMessage(e: unknown): string {
  const why = e instanceof ApiError || e instanceof Error ? e.message.trim() : '';
  return why ? `${CHANGED_BACK}: ${why}` : CHANGED_BACK;
}

/**
 * Apply `change` to every cached query under `queryKey` (a prefix matches
 * all its variants — every All tasks filter, say), then run `save`.
 * Resolves true when the save went through, false when it was rolled back.
 */
export async function optimistic<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  change: (current: T) => T,
  save: () => Promise<unknown>,
  opts: { notify?: (message: string) => void } = {},
): Promise<boolean> {
  // A refetch already in flight would land on top of the change and undo it.
  await queryClient.cancelQueries({ queryKey });
  const before = queryClient.getQueriesData<T>({ queryKey });
  queryClient.setQueriesData<T>({ queryKey }, (current) => (current === undefined ? current : change(current)));

  try {
    await save();
    return true;
  } catch (e) {
    for (const [key, data] of before) queryClient.setQueryData(key, data);
    (opts.notify ?? ((m: string) => toast.error(m)))(changedBackMessage(e));
    return false;
  }
}
