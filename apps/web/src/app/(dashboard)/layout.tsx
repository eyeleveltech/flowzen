'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api-v2';
import { useAuthStore, useUIStore } from '@/stores';
import { permissionForPath, canSee } from '@/config/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { TopNav } from '@/components/layout/top-nav';
import { BottomTabs } from '@/components/layout/bottom-tabs';
import { CommandPalette } from '@/components/layout/command-palette';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { X, Bell } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { useIsMobile } from '@/hooks/use-breakpoint';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, loadFromStorage, setAuth } = useAuthStore();
  const { sidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const { activeToast, clearToast } = useNotificationStore();
  const isMobile = useIsMobile();

  useEffect(() => {
    loadFromStorage();
    // Refresh the session (incl. role and enabledModules) so gating reflects the
    // server. /auth/me answers { user: … } — storing the envelope instead of the
    // user left role and name undefined, which silently hid every nav item that
    // names a role and rendered the avatar as "??".
    api.auth
      .me()
      .then((fresh: any) => setAuth(fresh?.user ?? fresh))
      .catch(() => { });
  }, [loadFromStorage]);

  useEffect(() => {
    const userStr = localStorage.getItem('flowzen-user');
    if (!userStr && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  /*
   * The one guard on a typed or bookmarked URL.
   *
   * The sidebar leaves out what this person cannot open, so this only fires on
   * a URL they typed or kept. They land on Today, which everybody has.
   *
   * It used to ask whether the ORGANISATION had a "module", and returned early
   * unless `user.enabledModules` was set — a field the API stopped sending, so
   * the guard never ran. Now it asks the same permission the screen's own
   * request will ask, which is the question that was always meant.
   */
  const pathname = usePathname();

  /*
   * Decided during RENDER, not inside the effect.
   *
   * The redirect used to live in an effect, which runs AFTER the child has
   * already mounted — so a blocked screen still fired its own first request
   * and collected a 403 in the console before the redirect landed. Every
   * refused navigation logged one to four of them, which is noise that trains
   * people to ignore the console.
   *
   * Working it out here means the page never mounts at all.
   */
  const needs = permissionForPath(pathname);

  /*
   * Three answers, not two: allowed, refused, and DON'T KNOW YET.
   *
   * The session arrives from localStorage in an effect, so the very first
   * render has no `user` — and treating that as "allowed" is what let a
   * blocked page mount and fire its own request before the redirect landed.
   * Every refused navigation logged a 403 in the console that way, which is
   * noise that teaches people to stop reading the console.
   *
   * A screen that names no permission renders immediately; only the gated ones
   * wait, and only for the frame it takes to read localStorage.
   */
  const known = Boolean(user?.permissions);
  const refused = known && Boolean(needs) && !canSee({ needs }, user!.permissions);
  const waiting = Boolean(needs) && !known;

  useEffect(() => {
    if (refused) router.replace('/my-work');
  }, [refused, router]);

  // Close mobile sidebar when route changes
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [router, setMobileSidebarOpen]);

  return (
    <div className="flex min-h-screen bg-white">
      {/* Desktop Sidebar only — hidden on mobile */}
      {!isMobile && <Sidebar isMobile={false} />}

      <motion.main
        animate={{ marginLeft: isMobile ? 0 : (sidebarCollapsed ? 72 : 260) }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex-1 flex flex-col min-w-0 bg-surface w-full"
      >
        <TopNav isMobile={isMobile} />
        <div className={`px-4 sm:px-6 lg:px-8 py-8 w-full max-w-400 mx-auto ${isMobile ? 'pb-24' : ''}`}>
          {refused || waiting ? null : children}
        </div>
      </motion.main>

      {/* Bottom Tabs — mobile only */}
      {isMobile && <BottomTabs />}

      <CommandPalette />

      {/* Real-time Toast Notification — positioned above bottom tabs on mobile */}
      {activeToast && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className={`fixed ${isMobile ? 'bottom-20 left-4 right-4' : 'bottom-6 right-6 w-80'} z-50 flex items-start gap-3 rounded-card border border-border bg-white p-4 shadow-modal`}
        >
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-body">
            <Icon as={Bell} size="md" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">New Notification</p>
            <p className="mt-1 text-xs text-secondary leading-snug">{activeToast.message}</p>
          </div>
          <button
            aria-label="Close notification"
            onClick={clearToast}
            className="flex shrink-0 items-center justify-center rounded-lg p-1 text-secondary hover:bg-subtle hover:text-primary transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            <Icon as={X} size="md" />
          </button>
        </motion.div>
      )}
    </div>
  );
}
