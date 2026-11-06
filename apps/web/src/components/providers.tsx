'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores';
import { connectSSE, disconnectSSE } from '@/lib/sse';
import { Toaster } from 'react-hot-toast';
import { useIsMobile } from '@/hooks/use-breakpoint';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WaitingOnDialog } from '@/components/work/WaitingOnDialog';
import { GlobalEvents } from '@/components/global-events';
import { NumberWheelGuard } from '@/components/number-wheel-guard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /*
       * Two minutes (Perf Plan 1, decision 5). A screen left two seconds ago
       * paints from cache and does not re-ask; anything written in this tab
       * invalidates what it touched (lib/task-sync, the hand-wired
       * invalidations after every write), and what another person wrote
       * arrives through the live events or on the next visit past two
       * minutes. Settings-like data holds for ten (hooks/queries.ts).
       */
      staleTime: 2 * 60 * 1000,
      retry: 1,
      /*
       * Off. On, coming back to the tab refetched EVERY mounted query at
       * once — a dozen requests for a glance at another window — and with six
       * tabs open that was the API's busiest moment of the day. The bell and
       * the lists still change: the live stream says when something is new,
       * and the two-minute staleTime re-asks on the next navigation.
       */
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <QueryClientProvider client={queryClient}>
      {/* reducedMotion="user" makes every framer-motion animation in the app honour the OS
          "reduce motion" setting. Framer animates through inline styles, so the
          prefers-reduced-motion block in globals.css cannot reach it — without this, 54 files
          worth of transitions would keep moving for someone who asked the system to stop.
          Set once here rather than per-component, which is the only way it stays true. */}
      <MotionConfig reducedMotion="user">
        <SocketProvider>
          {children}
          <GlobalEvents />
          <NumberWheelGuard />
          <ConfirmDialog />
          <WaitingOnDialog />
          <Toaster
            position={isMobile ? 'bottom-center' : 'top-right'}
            containerStyle={
              isMobile
                ? { bottom: 80, left: 16, right: 16 }
                : { top: 72, right: 16 }
            }
            toastOptions={{
              duration: 3500,
              error: { duration: 8000 },
              className: 'rounded-2xl border border-border bg-white text-sm text-primary shadow-overlay',
            }}
          />
        </SocketProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loadFromStorage } = useAuthStore();
  const router = useRouter();

  /*
   * A phone notification tapped while Flowzen is already open: the service
   * worker focuses this window and says where to go (public/sw.js). Only a
   * path of our own; the bell is opened rather than navigated to.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; url?: unknown } | null;
      if (msg?.type !== 'flowzen:navigate' || typeof msg.url !== 'string') return;
      if (!msg.url.startsWith('/') || msg.url.startsWith('//')) return;
      router.push(msg.url);
      if (/[?&]bell=1\b/.test(msg.url)) window.dispatchEvent(new Event('flowzen:open-bell'));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  useEffect(() => {
    loadFromStorage();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // fail silently in dev
      });
    }
  }, [loadFromStorage]);

  useEffect(() => {
    if (isAuthenticated) {
      connectSSE();
    }
    return () => {
      disconnectSSE();
    };
  }, [isAuthenticated]);

  return <>{children}</>;
}
