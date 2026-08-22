import { ModuleKey } from '@/lib/modules';
import {
  LayoutDashboard,
  Building2,
  TrendingUp,
  FileText,
  DollarSign,
  FolderKanban,
  CheckSquare,
  UsersRound,
  BarChart3,
  Settings,
  User as UserIcon,
  LucideIcon,
} from 'lucide-react';

/**
 * Roles form a ladder: each rung contains everything below it. An item naming
 * `SALES` is visible to Sales, Manager, Admin and Super Admin.
 *
 * Listing every acceptable role at every call site is how one gets forgotten
 * when a rung is added — so a nav item names its MINIMUM and nothing more.
 */
const RANK: Record<string, number> = {
  MEMBER: 0,
  SALES: 1,
  MANAGER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

/**
 * Whether this role reaches the item's minimum rung.
 *
 * Presentation only. Hiding a nav item is not security — the server enforces
 * every rule regardless of what this returns (master plan §5).
 */
export const canSee = (item: { roles?: string[] }, userRole: string): boolean => {
  if (!item.roles || item.roles.length === 0) return true;
  const minimum = Math.min(...item.roles.map((r) => RANK[r] ?? 99));
  return (RANK[userRole] ?? -1) >= minimum;
};

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles?: string[];
  module?: ModuleKey | ModuleKey[];
  isPrimaryMobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // Roles are a LADDER: naming the lowest rung admits everyone above it, so a
  // rung added later cannot be forgotten at one of these call sites (§3.10).
  { label: 'Today', href: '/dashboard', icon: LayoutDashboard, module: 'PM', isPrimaryMobile: true },
  { label: 'CRM Dashboard', href: '/crm', icon: LayoutDashboard, roles: ['SALES'], module: 'CRM', isPrimaryMobile: true },
  // In all three sections: you look a client up whether you are selling to
  // them, delivering for them, or billing them.
  { label: 'Company', href: '/clients', icon: Building2, module: ['CRM', 'PM', 'REVENUE'], isPrimaryMobile: true },
  { label: 'Pipeline', href: '/pipeline', icon: TrendingUp, roles: ['SALES'], module: 'CRM', isPrimaryMobile: true },
  { label: 'Quotations', href: '/quotations', icon: FileText, roles: ['SALES'], module: 'CRM', isPrimaryMobile: true },
  { label: 'Projects', href: '/projects', icon: FolderKanban, module: 'PM', isPrimaryMobile: true },
  { label: 'My Tasks', href: '/my-tasks', icon: CheckSquare, module: 'PM', isPrimaryMobile: true },
  { label: 'All Tasks', href: '/tasks', icon: CheckSquare, roles: ['MANAGER'], module: 'PM' },
  { label: 'Departments', href: '/departments', icon: Building2, roles: ['MANAGER'], module: 'PM' },
  // Money is the one real dividing line — everything above is worth sharing.
  { label: 'Revenue', href: '/revenue', icon: DollarSign, roles: ['ADMIN'], module: 'REVENUE', isPrimaryMobile: true },
  { label: 'Members', href: '/members', icon: UsersRound, roles: ['MANAGER'], module: 'PM' },
  { label: 'PM Reports', href: '/reports', icon: BarChart3, roles: ['MANAGER'], module: 'PM' },
];

export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Settings, roles: ['ADMIN'] },
  { label: 'Profile', href: '/profile', icon: UserIcon },
];
