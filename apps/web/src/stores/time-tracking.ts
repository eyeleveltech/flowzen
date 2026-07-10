'use client';

import { create } from 'zustand';

interface TimeTrackingPromptOptions {
  taskId: string;
  taskTitle: string;
}

interface TimeTrackingStore {
  isOpen: boolean;
  options: TimeTrackingPromptOptions | null;
  prompt: (options: TimeTrackingPromptOptions) => Promise<number | null>;
  onConfirm: (hours: number) => void;
  onCancel: () => void;
}

// We hold a reference to the promise resolver here so we can call it when the user clicks confirm or cancel.
let resolveCallback: ((value: number | null) => void) | null = null;

export const useTimeTrackingStore = create<TimeTrackingStore>((set) => ({
  isOpen: false,
  options: null,
  prompt: (options) => {
    set({ isOpen: true, options });
    return new Promise((resolve) => {
      resolveCallback = resolve;
    });
  },
  onConfirm: (hours: number) => {
    set({ isOpen: false, options: null });
    if (resolveCallback) {
      resolveCallback(hours);
      resolveCallback = null;
    }
  },
  onCancel: () => {
    set({ isOpen: false, options: null });
    if (resolveCallback) {
      resolveCallback(null);
      resolveCallback = null;
    }
  },
}));
