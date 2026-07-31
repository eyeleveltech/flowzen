'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useConfirmStore } from '@/stores';

export function useModalSafety({
  onClose,
  isDirty,
  active = true,
}: {
  onClose: () => void;
  isDirty: () => boolean;
  active?: boolean;
}) {
  const confirm = useConfirmStore((s) => s.confirm);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const guardedClose = useCallback(async () => {
    if (isDirty()) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes. Discard them and close?',
        confirmText: 'Discard',
        cancelText: 'Keep editing',
        variant: 'warning',
      });
      if (!ok) return;
    }
    onClose();
  }, [onClose, isDirty, confirm]);

  // Escape key handler: guardedClose when Escape key is pressed
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if the confirm dialog itself is open in store
      if (useConfirmStore.getState().isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        guardedClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [active, guardedClose]);

  // Focus trap & focus restore & body scroll lock
  useEffect(() => {
    if (!active) return;

    prevFocusRef.current = document.activeElement as HTMLElement;

    // Lock body scroll
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Initial focus into panel
    if (panelRef.current) {
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length > 0) {
        focusables[0].focus();
      }
    }

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !panelRef.current.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !panelRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTabKey);

    return () => {
      document.body.style.overflow = origOverflow;
      window.removeEventListener('keydown', handleTabKey);
      if (prevFocusRef.current && typeof prevFocusRef.current.focus === 'function') {
        prevFocusRef.current.focus();
      }
    };
  }, [active]);

  return { guardedClose, panelRef };
}
