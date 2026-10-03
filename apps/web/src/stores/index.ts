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

/*
 * Zen's panel: open or closed, docked or expanded — remembered per browser.
 *
 * Every read and write is wrapped: storage can be switched off or full, and a
 * panel that throws on open is worse than one that forgets. Anything that
 * cannot be read comes back closed and docked.
 */
const ZEN_KEY = 'flowzen-zen-panel';
type ZenPanel = { open: boolean; expanded: boolean };
const readZen = (): ZenPanel => {
  try {
    const raw = JSON.parse(localStorage.getItem(ZEN_KEY) ?? 'null');
    return { open: raw?.open === true, expanded: raw?.expanded === true };
  } catch {
    return { open: false, expanded: false };
  }
};
const writeZen = (panel: ZenPanel) => {
  try {
    localStorage.setItem(ZEN_KEY, JSON.stringify(panel));
  } catch {
    // Remembering is a convenience; the panel works without it.
  }
};

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
  /** Zen's panel. */
  zenOpen: boolean;
  zenExpanded: boolean;
  /**
   * Bumped when somebody opens Zen, not when a reload brings it back — so the
   * box takes focus when asked for, and a page that reopens with Zen docked
   * keeps its own keyboard (the calendar's T, J and K).
   */
  zenFocusToken: number;
  setZenOpen: (open: boolean) => void;
  toggleZen: () => void;
  setZenExpanded: (expanded: boolean) => void;
  /** Read back what this browser remembered. Once, after the first render. */
  restoreZen: () => void;
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
  zenOpen: false,
  zenExpanded: false,
  zenFocusToken: 0,
  setZenOpen: (open) =>
    set((s) => {
      writeZen({ open, expanded: s.zenExpanded });
      return { zenOpen: open, zenFocusToken: open ? s.zenFocusToken + 1 : s.zenFocusToken };
    }),
  toggleZen: () =>
    set((s) => {
      const open = !s.zenOpen;
      writeZen({ open, expanded: s.zenExpanded });
      return { zenOpen: open, zenFocusToken: open ? s.zenFocusToken + 1 : s.zenFocusToken };
    }),
  setZenExpanded: (expanded) =>
    set((s) => {
      writeZen({ open: s.zenOpen, expanded });
      return { zenExpanded: expanded };
    }),
  restoreZen: () => {
    const panel = readZen();
    set({ zenOpen: panel.open, zenExpanded: panel.expanded });
  },
}));

export * from './confirm';
