'use client';

/**
 * The bell's data.
 *
 * Its own file rather than one hook in a 300-line barrel of v1 query hooks —
 * every other hook in that file called an endpoint that no longer exists.
 *
 * Backed by real rule-based alerts — the hourly scanner (workers/scanner.cron.ts)
 * writes to the Alert table, and GET /notifications reads straight from it.
 */

import { useQuery } from '@tanstack/react-query';
import { api, type AppNotification } from '@/lib/api-v2';

export function useNotifications() {
  return useQuery<{ notifications: AppNotification[]; unreadCount: number }>({
    queryKey: ['notifications'],
    queryFn: () => api.notifications.list(),
    // A bell does not need to be live to the second, and a tight poll on every
    // page is how a quiet app still makes a request a second.
    staleTime: 60_000,
  });
}
