import { create } from 'zustand';

export interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  metadata?: any;
  createdAt: string;
}

interface NotificationState {
  activeToast: Notification | null;
  
  // Actions
  clearToast: () => void;
  showToast: (notification: Notification) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  activeToast: null,

  clearToast: () => set({ activeToast: null }),

  showToast: (notification: Notification) => {
    set({ activeToast: notification });
    
    // Auto-clear toast after 5 seconds
    setTimeout(() => {
      set((state) => (state.activeToast?.id === notification.id ? { activeToast: null } : state));
    }, 5000);
  },
}));
