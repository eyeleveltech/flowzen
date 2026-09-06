'use client';

/**
 * One sidebar.
 *
 * Everything the person can reach, listed at once, grouped by what it is about.
 * There is no longer a section to be "in" and nothing to switch between — see
 * navigation.ts's own history note for what the mode used to cost.
 *
 * Groups are headings, not folders: nothing collapses, nothing hides behind a
 * disclosure. At four groups and ten items the whole navigation fits on screen,
 * and a list you can see is faster than a list you have to search.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useUIStore, useAuthStore } from '@/stores';
import { cn, getInitials, getAvatarColor } from '@/lib/utils';
import {
  visibleSections,
  BOTTOM_NAV_ITEMS,
  NavItem,
  canSee,
} from '@/config/navigation';
import { ChevronLeft, LogOut } from 'lucide-react';

export function Sidebar({ isMobile }: { isMobile?: boolean }) {
  const shouldReduceMotion = useReducedMotion();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { sidebarCollapsed, toggleCollapse, mobileSidebarOpen } = useUIStore();
  const { user, logout } = useAuthStore();

  // Nothing is rendered from the user until the session has been read from
  // storage — rendering the ladder against an empty role first would flash the
  // Member-sized navigation at an Admin on every load.
  const sections = mounted ? visibleSections(user) : [];
  const collapsed = mounted && sidebarCollapsed;

  const isCurrent = (href: string) =>
    // /revenue has child routes that are their own screens, so a prefix match
    // would light two items at once.
    href === '/revenue' ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  const link = (item: NavItem) => {
    const active = isCurrent(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
      >
        <div
          className={cn(
            'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none',
            active ? 'bg-white/12 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
            collapsed && 'justify-center px-0',
          )}
        >
          <item.icon
            className={cn(
              'h-4.5 w-4.5 shrink-0',
              active ? 'text-white' : 'text-white/60 group-hover:text-white',
            )}
          />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
                className="whitespace-nowrap overflow-hidden"
              >
                {item.label}
              </motion.span>
            )}
          </AnimatePresence>
          {active && (
            <motion.div
              layoutId="sidebar-indicator"
              className="absolute inset-0 rounded-xl bg-white/12 -z-10"
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </div>
      </Link>
    );
  };

  return (
    <motion.aside
      initial={false}
      animate={
        isMobile
          ? { x: mobileSidebarOpen ? 0 : '-100%', width: 260 }
          : { x: 0, width: sidebarCollapsed ? 72 : 260 }
      }
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn(
        'fixed left-0 top-0 bottom-0 flex flex-col bg-primary overflow-hidden',
        isMobile ? 'z-50 shadow-modal' : 'z-40',
      )}
    >
      {/* Logo — the brand's own green mark (same file as the proforma PDF
          letterhead, apps/api/assets/brand/eyelevel-logo-color-new.png), light
          enough to sit directly on the dark rail without a chip behind it. */}
      <div className={cn('flex h-16 items-center px-5 border-b border-white/10', collapsed ? 'justify-center px-0' : 'justify-start')}>
        <img
          src="/eyelevel-logo-green.png"
          alt="Flowzen"
          width={180}
          height={48}
          className={cn('w-auto object-contain', collapsed ? 'h-8' : 'h-9')}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, i) => (
          <div
            // A section reduced to one row loses its heading (see
            // `visibleSections`), and an Employee has two of those — so the
            // title is no longer unique enough to key on. The first item's
            // href is.
            key={section.title ?? section.items[0]?.href ?? 'top'}
            className={cn(i > 0 && (collapsed ? 'mt-3 border-t border-white/10 pt-3' : 'mt-5'))}
          >
            {/*
              Collapsed, the heading becomes the rule above the group. The words
              do not fit in 72px, and truncating "Clients" to "Cli…" names nothing.
            */}
            {section.title && !collapsed && (
              <p className="eyebrow px-3 pb-1.5 text-white/[0.32]">
                {section.title}
              </p>
            )}
            <div className="space-y-1">{section.items.map(link)}</div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 space-y-1 border-t border-white/10">
        {BOTTOM_NAV_ITEMS.filter(
          (item) => item.href !== '/profile' && canSee(item, user?.permissions),
        ).map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <div
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none',
                  active ? 'bg-white/12 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
                  collapsed && 'justify-center px-0',
                )}
              >
                <item.icon className="h-4.5 w-4.5 shrink-0 text-white/60 group-hover:text-white" />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="whitespace-nowrap">
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
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white transition-colors duration-150 motion-reduce:transition-none"
          >
            <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}>
              <ChevronLeft className="h-4.5 w-4.5 text-white/60" />
            </motion.div>
            <AnimatePresence>
              {!collapsed && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="whitespace-nowrap">
                  Collapse
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        )}

        {/* User */}
        <div className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 mt-2', collapsed && 'flex-col justify-center px-0 gap-2')}>
          <div
            title={collapsed ? user?.name : undefined}
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-micro font-bold',
              user ? getAvatarColor(user.name) : 'bg-white/15 text-white',
            )}
          >
            {user ? getInitials(user.name) : '??'}
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-w-0">
                <p className="text-xs font-[650] text-white truncate">{user?.name}</p>
                <p className="text-micro text-white/60 truncate">{user?.email}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            title="Sign out"
            aria-label="Sign out"
            onClick={() => {
              logout();
              window.location.href = '/login';
            }}
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.aside>
  );
}
