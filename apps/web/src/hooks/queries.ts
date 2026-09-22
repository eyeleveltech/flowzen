'use client';

/**
 * Shared server-state queries.
 *
 * ─── Why these live in one place ────────────────────────────────────────────
 *
 * Every screen used to fetch its own data in a `useEffect` and hold it in
 * `useState`. That has two costs which only show up once the app is being used
 * rather than built: the same request is made again every single time you
 * arrive on a screen, even one you left two seconds ago; and data that several
 * screens share is fetched once per screen instead of once.
 *
 * `/config` was the clearest case — seven different call sites, all asking for
 * the same organisation settings that change roughly never.
 *
 * React Query was already installed and mounted app-wide in `providers.tsx`,
 * with a 30s `staleTime` configured, and `useQuery` was called nowhere. These
 * hooks are what start using what was already being paid for.
 */

import { useQuery } from '@tanstack/react-query';
import { api, type OrgConfig } from '@/lib/api-v2';

/** Query keys, in one place, so an invalidation elsewhere can find them. */
export const qk = {
  config: ['config'] as const,
  tasksMy: ['tasks', 'my'] as const,
  companies: (filter: string, pages: number) => ['companies', filter, pages] as const,
  liveWork: ['live-work'] as const,
  retainers: (status?: string) => ['retainers', status ?? 'all'] as const,
  projects: (status?: string) => ['projects', status ?? 'all'] as const,
  team: ['team'] as const,
};

/**
 * Organisation settings: stages, sources, verticals, tax defaults, and the
 * caller's own permissions.
 *
 * An hour of `staleTime` rather than the app default of 30 seconds. This is
 * configuration — it changes when somebody edits Settings, and that path
 * invalidates this key itself, so there is nothing to be gained by re-asking
 * for it on every navigation.
 */
export function useConfig() {
  return useQuery<OrgConfig>({
    queryKey: qk.config,
    queryFn: () => api.config.get(),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/** One person, as the owner and assignee pickers need them. */
export type TeamMemberOption = { id: string; name: string; designation: string | null; dept: string };

/**
 * The roster behind every owner / assignee picker.
 *
 * Nine call sites each ran this in their own `useEffect` — two screens and
 * seven modals — so opening a dialog refetched the whole team every time, and
 * a screen that hosts two dialogs fetched it three times over. The list changes
 * when somebody joins or leaves, so it is cached for an hour and shared.
 *
 * Returns `[]` rather than undefined while loading: every caller was already
 * written against an empty array, and a picker with no options is the correct
 * thing to show before the names arrive.
 */
export function useTeamMembers() {
  const { data } = useQuery({
    queryKey: qk.team,
    queryFn: () => api.team.members(),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
  return (data?.members ?? []) as TeamMemberOption[];
}
