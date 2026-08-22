// Module-based system: the two modules, who can access them, and routing helpers.

export type ModuleKey = 'CRM' | 'PM' | 'REVENUE';

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  description: string;
  home: string;                 // route to enter the module
  /** The lowest rung that may enter. null = everyone. */
  minimumRole: string | null;
}

export const MODULES: ModuleDef[] = [
  {
    key: 'CRM',
    label: 'CRM',
    description: 'Sales pipeline & lead management.',
    home: '/clients',
    minimumRole: 'SALES', // selling is what CRM is for
  },
  {
    key: 'PM',
    label: 'Project Management',
    description: 'Projects, tasks, calendar, team & reports.',
    home: '/dashboard',
    minimumRole: null, // everyone
  },
  {
    key: 'REVENUE',
    label: 'Revenue',
    description: 'Contracts, Invoices, Subscriptions & P&L.',
    home: '/revenue',
    minimumRole: 'ADMIN', // money is the one real dividing line
  },
];

type MaybeUser = { role?: string; enabledModules?: string[] } | null | undefined;

/**
 * Roles form a ladder: each rung contains everything below it. A module names
 * its MINIMUM rung, so a rung added later cannot be forgotten here.
 *
 * Exact matching was the bug: CRM listed SUPER_ADMIN and ADMIN, so a Manager or
 * a Sales user got no CRM module at all — and with no accessible modules the
 * picker had nothing to route to and span forever.
 */
const RANK: Record<string, number> = {
  MEMBER: 0,
  SALES: 1,
  MANAGER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

// Modules a user can enter = enabled for the org AND at or above the minimum rung.
export function accessibleModules(user: MaybeUser): ModuleDef[] {
  if (!user) return [];
  const enabled = user.enabledModules ?? [];
  const rank = RANK[user.role ?? ''] ?? -1;
  return MODULES.filter(
    (m) => enabled.includes(m.key) && (m.minimumRole === null || rank >= RANK[m.minimumRole]),
  );
}

export function canAccessModule(user: MaybeUser, key: ModuleKey): boolean {
  return accessibleModules(user).some((m) => m.key === key);
}

/**
 * Which section a route belongs to.
 *
 * `null` means shared — /clients, /settings, /profile and /modules are reached
 * from every section, so landing on one keeps whichever you were already in
 * rather than silently moving you.
 *
 * Only routes that still exist are listed. The dozen v1 paths that used to be
 * here (contracts, subscriptions, receivables…) are gone: they were folded into
 * /revenue and /clients by the new design.
 */
export function moduleForPath(pathname: string): ModuleKey | null {
  if (pathname.startsWith('/revenue')) return 'REVENUE';
  if (pathname.startsWith('/pipeline') || pathname.startsWith('/quotations')) return 'CRM';
  if (['/dashboard', '/projects', '/tasks', '/my-tasks', '/departments', '/members', '/reports'].some((p) => pathname.startsWith(p))) {
    return 'PM';
  }
  return null; // /clients, /settings, /profile, /modules
}
