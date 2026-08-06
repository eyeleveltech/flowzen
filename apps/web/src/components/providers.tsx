'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/stores';
import { connectSSE, disconnectSSE } from '@/lib/sse';
import { Toaster } from 'react-hot-toast';
import { useIsMobile } from '@/hooks/use-breakpoint';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GlobalEvents } from '@/components/global-events';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
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
          <ConfirmDialog />
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
              className: 'rounded-2xl border border-border bg-white text-sm text-primary shadow-xl shadow-black/5',
            }}
          />
        </SocketProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loadFromStorage } = useAuthStore();

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
