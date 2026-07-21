import { ModuleKey } from '@/lib/modules';
import {
  LayoutDashboard,
  Building2,
  TrendingUp,
  FileText,
  DollarSign,
  Receipt,
  RefreshCw,
  Wallet,
  TrendingDown,
  FolderKanban,
  CheckSquare,
  CalendarDays,
  UsersRound,
  Network,
  BarChart3,
  Settings,
  User as UserIcon,
  LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles?: string[];
  module?: ModuleKey | ModuleKey[];
  isPrimaryMobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, module: 'PM', isPrimaryMobile: true },
  { label: 'Clients', href: '/clients', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'], module: ['CRM', 'PM'], isPrimaryMobile: true },
  { label: 'Pipeline', href: '/pipeline', icon: TrendingUp, roles: ['SUPER_ADMIN', 'ADMIN'], module: 'CRM', isPrimaryMobile: true },
  { label: 'Quotations', href: '/quotations', icon: FileText, roles: ['SUPER_ADMIN', 'ADMIN'], module: 'CRM' },
  { label: 'Revenue Overview', href: '/revenue', icon: DollarSign, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Per-Project P&L', href: '/revenue/pnl', icon: FileText, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Contracts', href: '/contracts', icon: FileText, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Invoice Drafts', href: '/invoice-drafts', icon: FileText, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Invoices', href: '/invoices', icon: Receipt, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Payments', href: '/payments', icon: DollarSign, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Receivables', href: '/receivables', icon: Wallet, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Expenses', href: '/expenses', icon: Wallet, roles: ['SUPER_ADMIN'], module: 'REVENUE' },
  { label: 'Renewals', href: '/renewals', icon: RefreshCw, roles: ['SUPER_ADMIN', 'ADMIN'], module: 'CRM' },
  { label: 'Lost Deals', href: '/lost-deals', icon: TrendingDown, roles: ['SUPER_ADMIN', 'ADMIN'], module: 'CRM' },
  { label: 'Projects', href: '/projects', icon: FolderKanban, module: 'PM', isPrimaryMobile: true },
  { label: 'Tasks', href: '/tasks', icon: CheckSquare, module: 'PM', isPrimaryMobile: true },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays, module: 'PM' },
  { label: 'Members', href: '/members', icon: UsersRound, module: 'PM' },
  { label: 'Departments', href: '/departments', icon: Network, roles: ['SUPER_ADMIN', 'ADMIN'], module: 'PM' },
  { label: 'Reports', href: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'], module: ['CRM', 'PM'] },
];

export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Profile', href: '/profile', icon: UserIcon },
];
