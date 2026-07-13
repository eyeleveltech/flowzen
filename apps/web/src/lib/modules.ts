// Module-based system: the two modules, who can access them, and routing helpers.

export type ModuleKey = 'CRM' | 'PM' | 'REVENUE';

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  description: string;
  home: string;                 // route to enter the module
  allowedRoles: string[] | null; // null = every role
}

export const MODULES: ModuleDef[] = [
  {
    key: 'PM',
    label: 'Project Management',
    description: 'Projects, tasks, calendar, team & reports.',
    home: '/dashboard',
    allowedRoles: null, // everyone
  },
  {
    key: 'CRM',
    label: 'CRM',
    description: 'Sales pipeline & lead management.',
    home: '/pipeline',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'], // admins only
  },
  {
    key: 'REVENUE',
    label: 'Revenue',
    description: 'Contracts, Invoices, Subscriptions & P&L.',
    home: '/revenue',
    allowedRoles: ['SUPER_ADMIN'], // Only Akmal
  },
];

type MaybeUser = { role?: string; enabledModules?: string[] } | null | undefined;

// Modules a user can actually enter = enabled for the org AND allowed for the role.
export function accessibleModules(user: MaybeUser): ModuleDef[] {
  if (!user) return [];
  const enabled = user.enabledModules ?? [];
  return MODULES.filter(
    (m) => enabled.includes(m.key) && (!m.allowedRoles || m.allowedRoles.includes(user.role || '')),
  );
}

export function canAccessModule(user: MaybeUser, key: ModuleKey): boolean {
  return accessibleModules(user).some((m) => m.key === key);
}

// Which module a route belongs to (null = shared/core: keep the current module).
export function moduleForPath(pathname: string): ModuleKey | null {
  if (pathname.startsWith('/invoices') || pathname.startsWith('/contracts') || pathname.startsWith('/expenses') || pathname.startsWith('/subscriptions') || pathname.startsWith('/payments') || pathname.startsWith('/revenue') || pathname.startsWith('/invoice-drafts') || pathname.startsWith('/receivables')) return 'REVENUE';
  if (pathname.startsWith('/pipeline') || pathname.startsWith('/quotations') || pathname.startsWith('/renewals') || pathname.startsWith('/lost-deals')) return 'CRM';
  if (['/dashboard', '/projects', '/tasks', '/calendar', '/members', '/departments'].some((p) => pathname.startsWith(p))) {
    return 'PM';
  }
  return null; // /clients, /settings, /profile, /modules
}
