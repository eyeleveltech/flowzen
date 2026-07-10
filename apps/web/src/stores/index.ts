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
  enabledModules?: string[];
  lastActivityReadAt?: string | null;
  teamId?: string | null;
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

// ─── Active Module Store ──────────────────────
// Which module the user is currently working in (drives the sidebar). The route
// is the primary signal; this persists the last module for shared/core pages.

interface ModuleStore {
  activeModule: 'CRM' | 'PM';
  setActiveModule: (m: 'CRM' | 'PM') => void;
  hydrate: () => void;
}

export const useModuleStore = create<ModuleStore>((set) => ({
  activeModule: 'PM',
  setActiveModule: (m) => {
    if (typeof window !== 'undefined') localStorage.setItem('flowzen-active-module', m);
    set({ activeModule: m });
  },
  hydrate: () => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('flowzen-active-module');
    if (saved === 'CRM' || saved === 'PM') set({ activeModule: saved });
  },
}));

export * from './confirm';
export * from './time-tracking';
