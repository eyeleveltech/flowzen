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

    const handleMemberChanged = () => queryClient.invalidateQueries({ queryKey: ['members'] });
    const handleTeamChanged = () => queryClient.invalidateQueries({ queryKey: ['teams'] });
    const handleLeadChanged = () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    };

    sse.off('notification:new');
    sse.on('notification:new', handleNewNotification);
    sse.on('member:changed', handleMemberChanged);
    sse.on('team:changed', handleTeamChanged);
    sse.on('lead:updated', handleLeadChanged);

    return () => {
      sse.off('notification:new', handleNewNotification);
      sse.off('member:changed', handleMemberChanged);
      sse.off('team:changed', handleTeamChanged);
      sse.off('lead:updated', handleLeadChanged);
    };
  }, [queryClient, showToast]);

  return null;
}
