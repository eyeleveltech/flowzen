'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore, useAuthStore } from '@/stores';
import { cn, getInitials, getAvatarColor } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CheckSquare,
  CalendarDays,
  UsersRound,
  BarChart3,
  Settings,
  ChevronLeft,
  LogOut,
  Zap,
  Building2,
  Network
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Clients', href: '/clients', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'] },
  { label: 'Projects', href: '/projects', icon: FolderKanban },
  { label: 'Tasks', href: '/tasks', icon: CheckSquare },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays },
  { label: 'Members', href: '/team', icon: UsersRound },
  { label: 'Departments', href: '/teams', icon: Network, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Reports', href: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'] },
];

const bottomItems = [
  { label: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleCollapse } = useUIStore();
  const { user, logout } = useAuthStore();

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 72 : 260 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="fixed left-0 top-0 bottom-0 z-40 flex flex-col border-r border-[#E5E7EB] bg-white"
    >
      {/* Logo */}
      <div className={cn("flex h-16 items-center px-5 border-b border-[#E5E7EB]", sidebarCollapsed ? "justify-center px-0" : "justify-start")}>
        <img 
          src="/logo_flowzen.png" 
          alt="Flowzen" 
          className={cn("w-auto object-contain", sidebarCollapsed ? "h-6" : "h-10")} 
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.filter(item => !item.roles || item.roles.includes(user?.role || '')).map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-[#111827] text-white'
                    : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]'
                )}
              >
                <item.icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-white' : 'text-[#9CA3AF] group-hover:text-[#111827]')} />
                <AnimatePresence>
                  {!sidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.15 }}
                      className="whitespace-nowrap overflow-hidden"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="absolute inset-0 rounded-xl bg-[#111827] -z-10"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 space-y-1 border-t border-[#E5E7EB]">
        {bottomItems.filter(item => !item.roles || item.roles.includes(user?.role || '')).map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-[#F9FAFB] text-[#111827]'
                    : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]'
                )}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0 text-[#9CA3AF] group-hover:text-[#111827]" />
                <AnimatePresence>
                  {!sidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="whitespace-nowrap"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </Link>
          );
        })}

        {/* Collapse toggle */}
        <button
          onClick={toggleCollapse}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827] transition-all duration-150"
        >
          <motion.div animate={{ rotate: sidebarCollapsed ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronLeft className="h-[18px] w-[18px] text-[#9CA3AF]" />
          </motion.div>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="whitespace-nowrap">
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* User */}
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 mt-2">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-xs font-semibold ${user ? getAvatarColor(user.name) : 'bg-[#111827]'}`}>
            {user ? getInitials(user.name) : '??'}
          </div>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0"
              >
                <p className="text-sm font-medium text-[#111827] truncate">{user?.name}</p>
                <p className="text-xs text-[#9CA3AF] truncate">{user?.email}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  logout();
                  window.location.href = '/login';
                }}
                className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#EF4444] hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}
