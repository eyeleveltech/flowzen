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

    // Keep shared dropdown caches live across the app (and across users) when
    // team members or teams change anywhere.
    const handleMemberChanged = () => queryClient.invalidateQueries({ queryKey: ['members'] });
    const handleTeamChanged = () => queryClient.invalidateQueries({ queryKey: ['teams'] });

    sse.off('notification:new');
    sse.on('notification:new', handleNewNotification);
    sse.on('member:changed', handleMemberChanged);
    sse.on('team:changed', handleTeamChanged);

    return () => {
      sse.off('notification:new', handleNewNotification);
      sse.off('member:changed', handleMemberChanged);
      sse.off('team:changed', handleTeamChanged);
    };
  }, [queryClient, showToast]);

  return null;
}
