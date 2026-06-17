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
  Network,
  TrendingUp
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Pipeline', href: '/pipeline', icon: TrendingUp, roles: ['SUPER_ADMIN', 'ADMIN'] },
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

export function Sidebar({ isMobile }: { isMobile?: boolean }) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleCollapse, mobileSidebarOpen } = useUIStore();
  const { user, logout } = useAuthStore();

  return (
    <motion.aside
      initial={false}
      animate={
        isMobile
          ? { x: mobileSidebarOpen ? 0 : '-100%', width: 260 }
          : { x: 0, width: sidebarCollapsed ? 72 : 260 }
      }
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn(
        "fixed left-0 top-0 bottom-0 flex flex-col border-r border-border bg-white",
        isMobile ? "z-50 shadow-2xl" : "z-40"
      )}
    >
      {/* Logo */}
      <div className={cn("flex h-16 items-center px-5 border-b border-border", sidebarCollapsed ? "justify-center px-0" : "justify-start")}>
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
                    ? 'bg-primary text-white'
                    : 'text-secondary hover:bg-[#F9FAFB] hover:text-primary'
                )}
              >
                <item.icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-white' : 'text-[#9CA3AF] group-hover:text-primary')} />
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
                    className="absolute inset-0 rounded-xl bg-primary -z-10"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 space-y-1 border-t border-border">
        {bottomItems.filter(item => !item.roles || item.roles.includes(user?.role || '')).map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-[#F9FAFB] text-primary'
                    : 'text-secondary hover:bg-[#F9FAFB] hover:text-primary'
                )}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0 text-[#9CA3AF] group-hover:text-primary" />
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
        {!isMobile && (
          <button
            onClick={toggleCollapse}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-secondary hover:bg-[#F9FAFB] hover:text-primary transition-all duration-150"
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
        )}

        {/* User */}
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 mt-2">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${user ? getAvatarColor(user.name) : 'bg-primary text-white'}`}>
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
                <p className="text-sm font-medium text-primary truncate">{user?.name}</p>
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
