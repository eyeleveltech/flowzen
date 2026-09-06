'use client';
import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
  /** The generic ladder (MEMBER…SUPER_ADMIN) most gating still reads. */
  role: string;
  /** The agency's own vocabulary (EMPLOYEE…MANAGEMENT). Both arrive; see api/utils/roles.ts. */
  preset?: string;
  /** The switches the server actually enforces. The ladder is only for what to SHOW. */
  permissions?: string[];
  avatar?: string | null;
  team?: { id: string; name: string } | null;
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
  // The current screen's title/subtitle, read by TopNav — set once per page via
  // the usePageHeader hook rather than each page drawing its own <h1>, so the
  // heading lives in the sticky bar (matching the prototype's `.top h1`/`.sub`)
  // instead of scrolling away with the body.
  pageTitle: string;
  pageSubtitle: string | null;
  toggleSidebar: () => void;
  toggleCollapse: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setPageHeader: (title: string, subtitle?: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  commandPaletteOpen: false,
  pageTitle: 'Flowzen',
  pageSubtitle: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setPageHeader: (title, subtitle = null) => set({ pageTitle: title, pageSubtitle: subtitle }),
}));

export * from './confirm';
