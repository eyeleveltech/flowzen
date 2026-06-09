'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSSE } from '@/lib/sse';
import { useNotificationStore, Notification } from '@/stores/useNotificationStore';

export function GlobalEvents() {
  const queryClient = useQueryClient();
  const { showToast } = useNotificationStore();

  useEffect(() => {
    const sse = getSSE();
    if (!sse) return;

    const handleNewNotification = (notification: Notification) => {
      // Show the temporary pop-up
      showToast(notification);
      // Automatically refresh the notifications list across the entire app
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    sse.off('notification:new');
    sse.on('notification:new', handleNewNotification);

    return () => {
      sse.off('notification:new', handleNewNotification);
    };
  }, [queryClient, showToast]);

  return null;
}
