import { create } from 'zustand';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

export interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  metadata?: any;
  createdAt: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  activeToast: Notification | null;
  
  // Actions
  clearToast: () => void;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  addRealTimeNotification: (notification: Notification) => void;
  addToast: (notification: Notification) => void;
  initializeSocketListeners: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: true,
  activeToast: null,

  clearToast: () => set({ activeToast: null }),

  fetchNotifications: async () => {
    try {
      set({ isLoading: true });
      const data = await api.get<{ notifications: Notification[], unreadCount: number }>('/notifications');
      set({ notifications: data.notifications, unreadCount: data.unreadCount, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch notifications', error);
      set({ isLoading: false });
    }
  },

  markAsRead: async (id: string) => {
    const { notifications, unreadCount } = get();
    const notification = notifications.find(n => n.id === id);
    if (!notification || notification.read) return;

    // Optimistic update
    set({
      notifications: notifications.map(n => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, unreadCount - 1)
    });

    try {
      await api.patch(`/notifications/${id}/read`);
    } catch (error) {
      // Revert if failed (optional, simplified here)
      console.error('Failed to mark as read', error);
      get().fetchNotifications();
    }
  },

  markAllAsRead: async () => {
    // Optimistic update
    const { notifications } = get();
    set({
      notifications: notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0
    });

    try {
      await api.patch('/notifications/read-all');
    } catch (error) {
      console.error('Failed to mark all as read', error);
      get().fetchNotifications();
    }
  },

  addRealTimeNotification: (notification: Notification) => {
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + 1,
      activeToast: notification
    }));
    
    // Auto-clear toast after 5 seconds
    setTimeout(() => {
      set((state) => (state.activeToast?.id === notification.id ? { activeToast: null } : state));
    }, 5000);
  },

  addToast: (notification: Notification) => {
    set({ activeToast: notification });
    
    setTimeout(() => {
      set((state) => (state.activeToast?.id === notification.id ? { activeToast: null } : state));
    }, 5000);
  },

  initializeSocketListeners: () => {
    const socket = getSocket();
    if (!socket) return;

    // Prevent duplicate listeners
    socket.off('notification:new');
    socket.on('notification:new', (notification: Notification) => {
      get().addRealTimeNotification(notification);
      // Optional: We can trigger a toast notification here if desired
    });
  }
}));
