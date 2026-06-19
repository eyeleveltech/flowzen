'use client';

import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string | null;
  department?: string | null;
  designation?: string | null;
  organization?: {
    id: string;
    name: string;
    logo?: string | null;
  };
  lastActivityReadAt?: string | null;
}

interface AuthStore {
  user: User | null;
  token?: never; // Removed
  isAuthenticated: boolean;
  setAuth: (user: User) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,

  setAuth: (user) => {
    localStorage.setItem('flowzen-user', JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await fetch(process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/auth/logout` : 'http://localhost:4000/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('Logout failed', e);
    }
    localStorage.removeItem('flowzen-user');
    set({ user: null, isAuthenticated: false });
    window.location.href = '/login';
  },

  loadFromStorage: () => {
    const userStr = localStorage.getItem('flowzen-user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        set({ user, isAuthenticated: true });
      } catch {
        set({ user: null, isAuthenticated: false });
      }
    }
  },
}));

// ─── UI Store ─────────────────────────────────

interface UIStore {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  commandPaletteOpen: boolean;
  toggleSidebar: () => void;
  toggleCollapse: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  commandPaletteOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));

export * from './confirm';
