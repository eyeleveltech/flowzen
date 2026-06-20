'use client';

import { create } from 'zustand';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  /**
   * When set, the user must type this exact string into a text field before the
   * confirm button is enabled (GitHub-style "type the name to confirm" guard for
   * permanent deletes).
   */
  requireText?: string;
  /** Optional label shown above the input; defaults to a sensible prompt. */
  requireTextLabel?: string;
}

interface ConfirmStore {
  isOpen: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onConfirm: () => void;
  onCancel: () => void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  isOpen: false,
  options: null,
  resolve: null,
  confirm: (options) => {
    return new Promise<boolean>((resolve) => {
      set({
        isOpen: true,
        options: {
          title: options.title || 'Are you sure?',
          confirmText: options.confirmText || 'Confirm',
          cancelText: options.cancelText || 'Cancel',
          variant: options.variant || 'info',
          ...options
        },
        resolve,
      });
    });
  },
  onConfirm: () => {
    const resolve = get().resolve;
    if (resolve) resolve(true);
    set({ isOpen: false, options: null, resolve: null });
  },
  onCancel: () => {
    const resolve = get().resolve;
    if (resolve) resolve(false);
    set({ isOpen: false, options: null, resolve: null });
  },
}));
