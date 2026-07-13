'use client';

import { create } from 'zustand';

// In-memory filter state for the Projects list. Because it lives in the app's
// JS memory (not sessionStorage), it survives client-side navigation — open a
// project and come back and the filters are still applied — but a full page
// refresh re-initializes the module, so the filters reset to empty.
interface ProjectFiltersStore {
  search: string;
  statusFilter: string[];
  clientFilter: string[];
  ownerFilter: string[];
  dueDateFilter: string;
  setSearch: (v: string) => void;
  setStatusFilter: (v: string[]) => void;
  setClientFilter: (v: string[]) => void;
  setOwnerFilter: (v: string[]) => void;
  setDueDateFilter: (v: string) => void;
}

export const useProjectFilters = create<ProjectFiltersStore>((set) => ({
  search: '',
  statusFilter: [],
  clientFilter: [],
  ownerFilter: [],
  dueDateFilter: '',
  setSearch: (v) => set({ search: v }),
  setStatusFilter: (v) => set({ statusFilter: v }),
  setClientFilter: (v) => set({ clientFilter: v }),
  setOwnerFilter: (v) => set({ ownerFilter: v }),
  setDueDateFilter: (v) => set({ dueDateFilter: v }),
}));
