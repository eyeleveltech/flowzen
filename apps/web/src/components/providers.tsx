'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
