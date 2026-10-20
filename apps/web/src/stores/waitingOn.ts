'use client';

import { create } from 'zustand';

/** What a task on hold waits on: the client, someone else, or nothing — just on hold. */
export type WaitChoice = 'CLIENT' | 'ANOTHER_PERSON' | null;

interface WaitingOnStore {
  open: boolean;
  /** Whether "The client" is offered — only for a task that has one. */
  hasClient: boolean;
  /** The task's title, for the dialog's description. */
  title: string | null;
  resolve: ((choice: WaitChoice | undefined) => void) | null;
  /** Ask "Waiting on…". Resolves with the choice, or undefined when cancelled. */
  ask: (o: { hasClient: boolean; title?: string | null }) => Promise<WaitChoice | undefined>;
  choose: (choice: WaitChoice) => void;
  cancel: () => void;
}

/**
 * The "Waiting on…" question, asked from anywhere a task goes on hold
 * (QA19 fixes plan, F06) — one dialog, mounted once beside the confirm dialog,
 * so every screen asks it the same way.
 */
export const useWaitingOnStore = create<WaitingOnStore>((set, get) => ({
  open: false,
  hasClient: false,
  title: null,
  resolve: null,
  ask: ({ hasClient, title }) =>
    new Promise((resolve) => {
      // A question still open is answered "cancelled" before the next one.
      get().resolve?.(undefined);
      set({ open: true, hasClient, title: title ?? null, resolve });
    }),
  choose: (choice) => {
    get().resolve?.(choice);
    set({ open: false, resolve: null });
  },
  cancel: () => {
    get().resolve?.(undefined);
    set({ open: false, resolve: null });
  },
}));
