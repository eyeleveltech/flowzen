/**
 * Where an old Team tab now lives (Department head page plan).
 *
 * Team → Board became My Department, so a `/members?tab=board` link — in a
 * bookmark, an old Zen answer, a message somebody was sent — goes there rather
 * than quietly opening the Team tab instead. Null for every tab still on Team.
 */
export const teamTabRedirect = (tab: string | null | undefined): string | null =>
  tab?.toLowerCase() === 'board' ? '/my-department' : null;
