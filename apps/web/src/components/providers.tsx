'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/stores';
import { connectSSE, disconnectSSE } from '@/lib/sse';
import { Toaster } from 'react-hot-toast';

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
          <Toaster position="top-right" />
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
