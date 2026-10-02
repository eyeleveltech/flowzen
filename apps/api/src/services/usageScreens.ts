/**
 * Which screen a path is, for usage tracking — by name, never by address.
 *
 * The web app reports the path it is on; this turns it into one of a fixed set
 * of screen keys built from the sidebar (config/navigation.ts on the web) and
 * the record pages behind it. Anything else is ignored. Ids and search text
 * are never kept: `/companies/abc123?q=pavilion` is "client-page" and nothing
 * more. The one query parameter read is Money's tab, because "Money · Billing"
 * is a different job from the invoice list.
 */

export const SCREENS = {
  'my-work': 'My Work',
  calendar: 'Calendar',
  team: 'Team',
  'all-tasks': 'All tasks',
  companies: 'Companies',
  'client-page': 'Client page',
  outreach: 'Outreach list',
  pipeline: 'Pipeline',
  proposals: 'Proposals',
  'live-work': 'Live work',
  'project-page': 'Project page',
  'retainer-page': 'Retainer page',
  'retainer-project-page': 'Retainer project page',
  'internal-project-page': 'Internal project page',
  'monday-brief': 'Monday brief',
  money: 'Money',
  'money-billing': 'Money · Billing',
  'money-costs': 'Money · Costs',
  'money-profit': 'Money · Profit',
  forecast: 'Forecast',
  assets: 'Assets',
  'asset-page': 'Asset page',
  'time-split': 'Time split',
  settings: 'Settings',
  profile: 'Profile',
} as const;

export type ScreenKey = keyof typeof SCREENS;

/** The address, as path segments: one screen for each shape. */
const SHAPES: { match: (s: string[]) => boolean; key: ScreenKey }[] = [
  { match: (s) => s.length === 1 && s[0] === 'my-work', key: 'my-work' },
  { match: (s) => s.length === 1 && s[0] === 'calendar', key: 'calendar' },
  { match: (s) => s.length === 1 && s[0] === 'members', key: 'team' },
  { match: (s) => s.length === 1 && s[0] === 'all-work', key: 'all-tasks' },
  { match: (s) => s.length === 1 && s[0] === 'companies', key: 'companies' },
  { match: (s) => s.length === 2 && s[0] === 'companies', key: 'client-page' },
  { match: (s) => s.length === 1 && s[0] === 'outreach', key: 'outreach' },
  { match: (s) => s.length === 1 && s[0] === 'pipeline', key: 'pipeline' },
  { match: (s) => s.length === 1 && s[0] === 'quotations', key: 'proposals' },
  { match: (s) => s.length === 1 && s[0] === 'live-work', key: 'live-work' },
  { match: (s) => s.length === 2 && s[0] === 'projects', key: 'project-page' },
  { match: (s) => s.length === 2 && s[0] === 'retainers', key: 'retainer-page' },
  { match: (s) => s.length === 4 && s[0] === 'retainers' && s[2] === 'projects', key: 'retainer-project-page' },
  { match: (s) => s.length === 2 && s[0] === 'internal-projects', key: 'internal-project-page' },
  { match: (s) => s.length === 1 && s[0] === 'brief', key: 'monday-brief' },
  { match: (s) => s.length === 1 && s[0] === 'money', key: 'money' },
  { match: (s) => s.length === 1 && s[0] === 'forecast', key: 'forecast' },
  { match: (s) => s.length === 1 && s[0] === 'assets', key: 'assets' },
  { match: (s) => s.length === 2 && s[0] === 'assets', key: 'asset-page' },
  { match: (s) => s.length === 1 && s[0] === 'allocations', key: 'time-split' },
  { match: (s) => s.length === 1 && s[0] === 'settings', key: 'settings' },
  { match: (s) => s.length === 1 && s[0] === 'profile', key: 'profile' },
];

const MONEY_TABS: Record<string, ScreenKey> = { billing: 'money-billing', costs: 'money-costs', profit: 'money-profit' };

/** The screen key for a reported path, or null for anything not on the list. */
export function screenFor(path: unknown): ScreenKey | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) return null;
  let url: URL;
  try {
    // Only ever a path on our own site; the host is a placeholder for parsing.
    url = new URL(path, 'http://flowzen.local');
  } catch {
    return null;
  }
  if (url.host !== 'flowzen.local') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const shape = SHAPES.find((s) => s.match(segments));
  if (!shape) return null;
  if (shape.key === 'money') return MONEY_TABS[(url.searchParams.get('tab') ?? '').toLowerCase()] ?? 'money';
  return shape.key;
}

/** What a screen key is called, for the summary. */
export const screenLabel = (key: string): string => SCREENS[key as ScreenKey] ?? key;
