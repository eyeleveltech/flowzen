'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/stores';
import { connectSSE, disconnectSSE } from '@/lib/sse';
import { Toaster } from 'react-hot-toast';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TimeTrackingPrompt } from '@/components/ui/time-tracking-prompt';
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
      <SocketProvider>
        {children}
        <GlobalEvents />
        <ConfirmDialog />
        <TimeTrackingPrompt />
        <Toaster position="top-right" />
      </SocketProvider>
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
