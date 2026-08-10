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

  // Has the person actually touched this form?
  //
  // isDirty() compares the form against a baseline captured on mount, which is only meaningful if
  // the form was fully populated by then. Several of these forms fill themselves from network
  // calls (a quote loads its client, a lead loads its contact, settings load the standard terms),
  // so a response landing after the baseline makes the form differ from it without anybody having
  // typed a character — and closing then asked "Discard changes?" over changes that were never
  // made. Requiring a real interaction removes that whole class of false prompt regardless of how
  // each form computes its baseline.
  //
  // Deliberately pointerdown/keydown rather than input/change: several fields are custom
  // components (Select, MultiSelect, RichTextEditor) that set state directly and emit no native
  // input event, so listening for edits would MISS real changes — which is the dangerous
  // direction to be wrong in.
  const hasInteractedRef = useRef(false);
  // Only trust the above once the listeners are actually attached. If the panel ref was never
  // wired up we cannot tell interaction from silence, and must fall back to prompting — losing
  // someone's work is far worse than one unnecessary dialog.
  const interactionTrackedRef = useRef(false);

  const guardedClose = useCallback(async () => {
    const untouched = interactionTrackedRef.current && !hasInteractedRef.current;
    if (!untouched && isDirty()) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes. Discard them and close?',
        confirmText: 'Discard',
        cancelText: 'Keep editing',
        // Not 'warning': discarding your own unsaved edits is a routine choice, not a hazard, and
        // amber here spent the alert colour on it. Reserved for things that actually need it.
        variant: 'info',
      });
      if (!ok) return;
    }
    onClose();
  }, [onClose, isDirty, confirm]);

  useEffect(() => {
    if (!active) return;
    const el = panelRef.current;
    if (!el) return;

    const mark = () => { hasInteractedRef.current = true; };
    // Escape and Tab move around the form without editing it, so they do not count.
    const onKeyDown = (e: KeyboardEvent) => { if (e.key !== 'Escape' && e.key !== 'Tab') mark(); };

    el.addEventListener('pointerdown', mark);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('drop', mark);
    el.addEventListener('paste', mark);
    interactionTrackedRef.current = true;

    return () => {
      el.removeEventListener('pointerdown', mark);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('drop', mark);
      el.removeEventListener('paste', mark);
      interactionTrackedRef.current = false;
      hasInteractedRef.current = false;
    };
  }, [active]);

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

  // Exposed so a form can keep re-baselining its "unchanged" snapshot until the first real
  // interaction, instead of guessing with a timer how long its own data takes to arrive.
  const hasInteracted = useCallback(() => hasInteractedRef.current, []);

  return { guardedClose, panelRef, hasInteracted };
}
