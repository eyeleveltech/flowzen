'use client';

/**
 * What the server pushes, and what the cache does about it.
 *
 * ─── Why none of this worked ────────────────────────────────────────────────
 *
 * Two independent faults, stacked, either of which alone was enough:
 *
 *   1. The API never emitted anything. `emitToUser` and `emitToOrganization`
 *      were defined in sse.ts and called from nowhere, so the only traffic on
 *      the stream was the `connected` handshake and keep-alive comments.
 *
 *   2. Three of the four listeners here invalidated keys that no query uses —
 *      `['members']`, `['teams']` and `['leads']`, while the app's real keys
 *      are `['team', …]` and `['companies', …]`. They would have been no-ops
 *      even once the server started emitting.
 *
 * The result was a live EventSource per signed-in browser that changed nothing
 * on screen, ever. The bell only moved because React Query's staleTime made it
 * re-ask on a remount.
 *
 * `team:changed` is gone rather than repaired: nothing emits it, and member and
 * team data are the same `['team']` cache here, so `member:changed` covers it.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSSE } from '@/lib/sse';
import { qk } from '@/hooks/queries';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { AppNotification } from '@/lib/api-v2';

export function GlobalEvents() {
  const queryClient = useQueryClient();
  const { showToast } = useNotificationStore();

  /** Toast each alert once, however many events arrive while a tab is open. */
  const toasted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const sse = getSSE();
    if (!sse) return;

    /**
     * The event carries no alert, deliberately — see the note on
     * `emitToOrganization`. `/notifications` withholds a rule the reader has no
     * permission for, so the only safe way to learn what to show is to re-ask
     * and toast what comes back.
     */
    const handleNewNotification = async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });

      const data = queryClient.getQueryData<{ notifications: AppNotification[] }>([
        'notifications',
      ]);
      const newest = data?.notifications?.find((n) => !n.read && !toasted.current.has(n.id));
      if (!newest) return;

      toasted.current.add(newest.id);
      showToast({
        id: newest.id,
        type: newest.type,
        message: newest.message,
        read: newest.read,
        createdAt: newest.createdAt,
      });
    };

    const handleMemberChanged = () => queryClient.invalidateQueries({ queryKey: qk.team });
    const handleLeadChanged = () => queryClient.invalidateQueries({ queryKey: ['companies'] });

    sse.off('notification:new');
    sse.on('notification:new', handleNewNotification);
    sse.on('member:changed', handleMemberChanged);
    sse.on('lead:updated', handleLeadChanged);

    return () => {
      sse.off('notification:new', handleNewNotification);
      sse.off('member:changed', handleMemberChanged);
      sse.off('lead:updated', handleLeadChanged);
    };
  }, [queryClient, showToast]);

  return null;
}
