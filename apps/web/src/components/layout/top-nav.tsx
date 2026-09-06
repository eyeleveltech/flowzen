'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useUIStore, useAuthStore } from '@/stores';
import { api } from '@/lib/api-v2';
import { useNotifications } from '@/hooks/useNotifications';
import { useQueryClient } from '@tanstack/react-query';
import { getInitials, formatRelativeDate, getAvatarColor } from '@/lib/utils';
import {
  Search,
  ArrowLeft,
  Bell,
  Plus,
  ChevronDown,
  LogOut,
  Settings,
  User as UserIcon,
  X,
  Check,
  CheckSquare,
  FolderKanban,
  Users,
  MessageSquare,
  Clock,
  AlertCircle,
  Menu,
  Building2,
  RefreshCw,
  Package,
  IndianRupee,
} from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import toast from 'react-hot-toast';
import { canSee } from '@/config/navigation';

// Keyed by the actual rule names the scanner (workers/scanner.cron.ts) emits —
// these used to be a different, fictional set of notification types that no
// real alert ever carried, so every notification fell through to the AlertCircle
// default regardless of what it actually was.
const notificationIcons: Record<string, typeof CheckSquare> = {
  PROPOSAL_STALLED: Clock,
  VERBAL_NO_ADVANCE: AlertCircle,
  PROFORMA_EXPIRED: AlertCircle,
  PROFORMA_UNPAID: Clock,
  RETAINER_EXPIRING: RefreshCw,
  RETAINER_NO_CONTRACT: AlertCircle,
  TASK_OVERDUE: CheckSquare,
  TASK_WAITING_HOLD: Clock,
  TASK_AGING: Clock,
  INVOICE_OVERDUE: AlertCircle,
  INVOICE_AGING_60: AlertCircle,
  MEMBER_OVERALLOCATED: Users,
  ALLOCATIONS_UNCONFIRMED: Users,
  PERSON_OVERLOADED: Users,
  PERSON_UNDERLOADED: Users,
  PROJECT_OVER_ESTIMATE: FolderKanban,
  PROJECT_BEHIND_SCHEDULE: FolderKanban,
  CLIENT_QUIET: Building2,
  MONTH_CARD_NOT_INVOICED: IndianRupee,
  // The register's four. These were missing, and asset alerts are the only
  // ones open to an Employee — so every notification a designer could see
  // fell through to the generic circle.
  ASSET_OVERDUE: Package,
  ASSET_HELD_BY_INACTIVE_USER: Package,
  ASSET_REPAIR_STALE: Package,
  ASSET_WARRANTY_EXPIRING: Package,
};

const severityDot: Record<string, string> = {
  HIGH: 'bg-danger',
  MED: 'bg-warning',
  LOW: 'bg-line',
};

export function TopNav({ isMobile }: { isMobile?: boolean }) {
  const shouldReduceMotion = useReducedMotion();
  const router = useRouter();
  const pathname = usePathname();
  const { setCommandPaletteOpen, setMobileSidebarOpen, pageTitle, pageSubtitle } = useUIStore();
  const { user, logout } = useAuthStore();
  const showBack = isMobile && pathname !== '/my-work';

  const queryClient = useQueryClient();
  const { data: notifData } = useNotifications();
  const notifications = notifData?.notifications || [];
  const unreadCount = notifData?.unreadCount || 0;

  const markAsRead = async (id: string) => {
    // Optimistically flip read + decrement the badge so the UI responds instantly.
    const previous = queryClient.getQueryData(['notifications']);
    queryClient.setQueryData(['notifications'], (old: any) => {
      if (!old) return old;
      const target = old.notifications?.find((n: any) => n.id === id);
      if (!target || target.read) return old;
      return {
        ...old,
        notifications: old.notifications.map((n: any) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, (old.unreadCount || 0) - 1),
      };
    });
    try {
      await api.notifications.markRead(id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err: any) {
      queryClient.setQueryData(['notifications'], previous); // rollback
      toast.error('Failed to mark read');
    }
  };

  const markAllAsRead = async () => {
    const previous = queryClient.getQueryData(['notifications']);
    queryClient.setQueryData(['notifications'], (old: any) => old ? ({
      ...old,
      notifications: old.notifications?.map((n: any) => ({ ...n, read: true })) || [],
      unreadCount: 0,
    }) : old);
    try {
      await api.notifications.markAllRead();
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All marked as read');
    } catch (err: any) {
      queryClient.setQueryData(['notifications'], previous); // rollback
      toast.error('Failed to mark all read');
    }
  };

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown-container')) {
        setShowNotifications(false);
        setShowUserMenu(false);
        setShowQuickCreate(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

// No " New Client" quick-create, because there are three fuller ways in and all
// of them ask for things this menu cannot: winning a deal, " New Company" on the
// clients screen, or a CSV import. (This comment used to give the import as the
// reason there is no button here, while the import itself did not exist —
// a missing path justifying another missing path. It exists now.)
/**
 * Quick create, gated the same way the navigation is.
 *
 * Each item names the permission its own POST requires on the server, so the
 * menu cannot offer a door that is locked. This used to name a minimum rung on
 * the old role ladder, which is a different question from what the API asks —
 * and before that it had no filter at all, offering an Employee three creates
 * they could not perform, none of them saying so until you walked into them.
 */
  const quickCreateItems = ([
    { label: 'New project', href: '/live-work?tab=PROJECTS&create=true', icon: FolderKanban, needs: 'company.write' as const },
    { label: 'New task', href: '/my-work?create=true', icon: CheckSquare, needs: 'work.own' as const },
    // "New Lead" opened a deal form. There is no deal to create — a card exists
    // because a company exists (§8.7) — so this is what it always meant.
    { label: 'New company', href: '/companies?create=true', icon: Building2, needs: 'company.write' as const },
  ]).filter((item) => canSee(item, user?.permissions));

  return (
    <header className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between border-b border-border bg-white/80 backdrop-blur-xl px-3 sm:px-6">
      <div className="flex items-center flex-1 min-w-0 pr-2 gap-3">
        {showBack ? (
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-secondary hover:bg-surface hover:text-primary transition-colors"
            title="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : isMobile ? (
          <div className="flex items-center gap-1.5 shrink-0 sm:hidden">
          <div className="h-7 w-7 rounded-lg bg-primary text-white font-bold flex items-center justify-center text-xs">
              F
            </div>
            <span className="font-semibold text-primary text-sm tracking-tight">Flowzen</span>
          </div>
        ) : null}

        {/* Page title/subtitle — the sticky-bar equivalent of the prototype's
            `.top h1`/`.sub`, set per-page via usePageHeader() instead of each
            screen drawing its own <h1> in the scrolling body. Desktop only;
            the compact "Flowzen" wordmark above still covers mobile. */}
        <div className="hidden sm:flex min-w-0 items-center gap-3">
          <h1 className="truncate text-lg font-semibold tracking-[-0.3px] text-primary">{pageTitle}</h1>
          {pageSubtitle && (
            <span className="truncate border-l border-border pl-3.5 text-xs text-secondary">{pageSubtitle}</span>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1.5 sm:gap-2 dropdown-container shrink-0">
        {/* Search button on Mobile (compact icon button) */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex sm:hidden h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-secondary hover:bg-white hover:text-primary transition-colors shrink-0"
          title="Search"
        >
          <Search className="h-4 w-4" />
        </button>

        {/* Search bar on Desktop */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="hidden sm:flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm text-secondary hover:bg-white hover:border-line transition-colors duration-150 motion-reduce:transition-none w-64"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Search…</span>
          <kbd className="ml-auto inline-flex items-center gap-0.5 rounded-md border border-border bg-white px-1.5 py-0.5 text-micro font-medium text-secondary">
            ⌘K
          </kbd>
        </button>

        {/* Quick Create */}
        <div className="relative">
          <button
            aria-label="Quick Create"
            onClick={() => { setShowQuickCreate(!showQuickCreate); setShowNotifications(false); setShowUserMenu(false); }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-secondary hover:bg-surface hover:text-primary transition-colors duration-150 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            <Plus className="h-4 w-4" />
          </button>

          {isMobile ? (
            <Drawer isOpen={showQuickCreate} onClose={() => setShowQuickCreate(false)} title="Quick Create">
              <div className="flex flex-col gap-1 pb-4">
                {quickCreateItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { router.push(item.href); setShowQuickCreate(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-body hover:bg-surface active:bg-subtle transition-colors"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle">
                      <item.icon className="h-5 w-5 text-secondary" />
                    </div>
                    {item.label}
                  </button>
                ))}
              </div>
            </Drawer>
          ) : (
            <AnimatePresence>
              {showQuickCreate && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
                  className="absolute right-0 mt-2 w-48 rounded-2xl border border-border bg-white p-1.5"
                >
                  {quickCreateItems.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { router.push(item.href); setShowQuickCreate(false); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-body hover:bg-surface transition-colors"
                    >
                      <item.icon className="h-4 w-4 text-secondary" />
                      {item.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            aria-expanded={showNotifications}
            onClick={() => { setShowNotifications(!showNotifications); setShowQuickCreate(false); setShowUserMenu(false); }}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border text-secondary hover:bg-surface hover:text-primary transition-colors duration-150 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -right-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-micro font-semibold text-white"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.span>
            )}
          </button>

          {isMobile ? (
            <Drawer isOpen={showNotifications} onClose={() => setShowNotifications(false)} title="Needs attention">
              {unreadCount > 0 && (
                <div className="flex justify-end mb-2">
                  <button onClick={markAllAsRead} className="text-xs font-medium text-secondary hover:text-primary transition-colors bg-surface px-3 py-1.5 rounded-lg">
                    Mark all read
                  </button>
                </div>
              )}
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-subtle -mx-6 border-t border-subtle">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-sm text-secondary">Nothing needs attention.</div>
                ) : (
                  notifications.map((n) => {
                    const Icon = notificationIcons[n.type] || AlertCircle;

                    const handleNotificationClick = async () => {
                      if (!n.read) markAsRead(n.id);
                      setShowNotifications(false);
                      // A notification carries the route it points at, rather
                      // than ids this component has to reassemble into one. A
                      // new kind of notification then needs no change here.
                      if (n.link) router.push(n.link);
                    };

                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={handleNotificationClick}
                        className={`flex w-full gap-3 px-6 py-4 text-left hover:bg-surface transition-colors outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${!n.read ? 'bg-subtle/50' : ''}`}
                      >
                        <div className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-subtle">
                          <Icon className="h-4 w-4 text-secondary" aria-hidden="true" />
                          <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${severityDot[n.severity] ?? severityDot.LOW}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-base text-body leading-snug">{n.message}</p>
                          <p className="mt-1 flex items-center gap-1.5 text-micro text-secondary">
                            <span className="font-bold uppercase tracking-[0.13em]">{n.source}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeDate(n.createdAt)}</span>
                            {!n.read && <span className="sr-only">· unread</span>}
                          </p>
                        </div>
                        {!n.read && <div className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-info" aria-hidden="true" />}
                      </button>
                    );
                  })
                )}
              </div>
            </Drawer>
          ) : (
            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
                  className="absolute right-0 mt-2 w-96 rounded-2xl border border-border bg-white"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
                    <div>
                      {/*
                        It said "Real-time activity logs" and was neither: the
                        scanner runs hourly and the bell refetches once a
                        minute, and these are rule-raised alerts, not a log of
                        what people did — that is the activity feed, elsewhere.
                      */}
                      <h3 className="text-sm font-semibold text-primary">Needs attention</h3>
                      <p className="text-xs text-secondary mt-0.5">Raised by rule, checked hourly</p>
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllAsRead} className="text-xs text-secondary hover:text-primary transition-colors">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-subtle">
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center text-sm text-secondary">Nothing needs attention.</div>
                    ) : (
                      notifications.map((n) => {
                        const Icon = notificationIcons[n.type] || AlertCircle;

                        const handleNotificationClick = async () => {
                          if (!n.read) markAsRead(n.id);
                          setShowNotifications(false);
                          // The notification carries the route it points at, so
                          // a new kind of notification needs no change here.
                          if (n.link) router.push(n.link);
                        };

                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={handleNotificationClick}
                            className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-surface transition-colors outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${!n.read ? 'bg-subtle/50' : ''}`}
                          >
                            <div className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-subtle">
                              <Icon className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                              <span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${severityDot[n.severity] ?? severityDot.LOW}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-body leading-snug">{n.message}</p>
                              {/*
                                Where it came from, then when. The rows used to
                                carry only the sentence, so a bell holding
                                forty-four of them read as one undifferentiated
                                column — an overdue invoice, a lens that has not
                                come back and somebody's workload all looked
                                alike until you had read each one.

                                Set in the house label style, the same as every
                                figure label on every screen.
                              */}
                              <p className="mt-1 flex items-center gap-1.5 text-micro text-secondary">
                                <span className="font-bold uppercase tracking-[0.13em]">{n.source}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatRelativeDate(n.createdAt)}</span>
                                {!n.read && <span className="sr-only">· unread</span>}
                              </p>
                            </div>
                            {!n.read && <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* User menu */}
        <div className="relative ml-1 shrink-0">
          <button
            aria-label="User Menu"
            onClick={() => { setShowUserMenu(!showUserMenu); setShowNotifications(false); setShowQuickCreate(false); }}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface transition-colors duration-150 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-primary/25 shrink-0"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${user?.name ? getAvatarColor(user.name) : 'bg-subtle text-secondary'}`}>
              {user?.name ? getInitials(user.name) : <UserIcon className="h-4 w-4 text-secondary" />}
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-secondary" />
          </button>

          {isMobile ? (
            <Drawer isOpen={showUserMenu} onClose={() => setShowUserMenu(false)} title="Account">
              <div className="px-4 py-3.5 mb-3 bg-surface rounded-xl border border-border flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold ${user?.name ? getAvatarColor(user.name) : 'bg-subtle text-secondary'}`}>
                  {user?.name ? getInitials(user.name) : <UserIcon className="h-5 w-5 text-secondary" />}
                </div>
                <div>
                  <p className="text-base font-semibold text-primary leading-snug">{user?.name || 'User Profile'}</p>
                  <p className="text-sm text-secondary">{user?.email || 'Loading...'}</p>
                </div>
              </div>
              <div className="flex flex-col gap-1 pb-4">
                <button
                  onClick={() => { router.push('/profile'); setShowUserMenu(false); }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-body hover:bg-surface active:bg-subtle transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle">
                    <UserIcon className="h-5 w-5 text-secondary" />
                  </div>
                  My Profile
                </button>
                {user?.permissions?.includes('setup.admin') && (
                  <button
                    onClick={() => { router.push('/settings'); setShowUserMenu(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-body hover:bg-surface active:bg-subtle transition-colors"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-subtle">
                      <Settings className="h-5 w-5 text-secondary" />
                    </div>
                    Settings
                  </button>
                )}
                <button
                  onClick={() => { logout(); window.location.href = '/login'; }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-base text-danger hover:bg-danger-tint active:bg-danger-tint transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-tint text-danger">
                    <LogOut className="h-5 w-5" />
                  </div>
                  Sign out
                </button>
              </div>
            </Drawer>
          ) : (
            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
                  className="absolute right-0 mt-2 w-56 rounded-2xl border border-border bg-white p-1.5"
                >
                  <div className="px-3 py-2 mb-1">
                    <p className="text-sm font-medium text-primary">{user?.name}</p>
                    <p className="text-xs text-secondary">{user?.email}</p>
                  </div>
                  <div className="border-t border-subtle pt-1">
                    <button
                      onClick={() => { router.push('/profile'); setShowUserMenu(false); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-body hover:bg-surface transition-colors"
                    >
                      <UserIcon className="h-4 w-4 text-secondary" />
                      My Profile
                    </button>
                    {user?.permissions?.includes('setup.admin') && (
                      <button
                        onClick={() => { router.push('/settings'); setShowUserMenu(false); }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-body hover:bg-surface transition-colors"
                      >
                        <Settings className="h-4 w-4 text-secondary" />
                        Settings
                      </button>
                    )}
                    <button
                      onClick={() => { logout(); window.location.href = '/login'; }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-danger hover:bg-danger-tint transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

    </header>
  );
}
