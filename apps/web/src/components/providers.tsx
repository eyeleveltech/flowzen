'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/stores';
import { connectSocket, disconnectSocket } from '@/lib/socket';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

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
        <ConfirmDialog />
      </SocketProvider>
    </QueryClientProvider>
  );
}

function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (isAuthenticated) {
      connectSocket();
    }
    return () => {
      disconnectSocket();
    };
  }, [isAuthenticated]);

  return <>{children}</>;
}
