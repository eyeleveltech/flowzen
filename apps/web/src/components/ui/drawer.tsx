'use client';

import React, { ReactNode, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-breakpoint';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useConfirmStore } from '@/stores/confirm';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  variant?: 'modal' | 'slideover';
  ariaLabel?: string;
  /**
   * Ask before throwing away what somebody has filled in.
   *
   * On for every form (Modal turns it on). A click on the dimmed page behind a
   * form, Escape, or the close button shut it on the spot, and the half-written
   * proposal or cost went with it — one stray click and the lot typed again.
   * Once anything has been typed or picked, those three ask first. Cancel and
   * Save inside the form are deliberate and close as they always did.
   */
  guardUnsaved?: boolean;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  className = '',
  variant = 'modal',
  ariaLabel,
  guardUnsaved = false,
}: DrawerProps) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  /*
   * Has anything been filled in since it opened?
   *
   * Read off the events, not the form's state: this component cannot see
   * forty-six forms' state, but every one of them raises an input or change
   * event when typed in, and the custom pickers are clicks on an option,
   * switch or radio. A ref, not state — nothing on screen changes with it.
   */
  const dirtyRef = useRef(false);
  const askingRef = useRef(false);
  useEffect(() => {
    if (isOpen) dirtyRef.current = false;
  }, [isOpen]);

  const markDirty = () => {
    dirtyRef.current = true;
  };
  const noticePick = (e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[role="option"], [role="switch"], [role="radio"], [role="checkbox"], [aria-pressed]')) {
      markDirty();
    }
  };

  /** Every way of closing that is not the form's own Cancel or Save. */
  const requestClose = useCallback(async () => {
    if (!guardUnsaved || !dirtyRef.current) {
      onClose();
      return;
    }
    // Escape pressed again while the question is up answers the question.
    if (askingRef.current) return;
    askingRef.current = true;
    try {
      const discard = await useConfirmStore.getState().confirm({
        title: 'Discard what you have filled in?',
        message: 'This form has details that are not saved yet. Close it now and they are gone.',
        confirmText: 'Discard',
        cancelText: 'Keep editing',
        variant: 'danger',
      });
      if (discard) onClose();
    } finally {
      askingRef.current = false;
    }
  }, [guardUnsaved, onClose]);

  // A refresh or a closed tab loses the form just the same.
  useEffect(() => {
    if (!isOpen || !guardUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isOpen, guardUnsaved]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isOpen) return;
      // Escape in an open dropdown closes the dropdown, not the whole form.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[role="listbox"], [aria-expanded="true"]')) return;
      void requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, requestClose]);

  // Auto-focus + focus restore
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      const timer = setTimeout(() => {
        const el = panelRef.current?.querySelector<HTMLElement>(
          'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        el?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  // Focus trap
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!isOpen && typeof document === 'undefined') return null;

  /*
   * `contents`, so the wrapper adds no box: the form inside stays a direct
   * flex child of the panel and its footer stays pinned. React events bubble
   * through portals, so a pick in a dropdown rendered on <body> still lands
   * here.
   */
  const watched = guardUnsaved ? (
    <div className="contents" onInputCapture={markDirty} onChangeCapture={markDirty} onClickCapture={noticePick}>
      {children}
    </div>
  ) : (
    children
  );

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => void requestClose()}
            className="fixed inset-0 z-200 bg-black/30 backdrop-blur-xs"
          />

          {isMobile ? (
            /* MOBILE: Bottom Sheet */
            <motion.div
              ref={panelRef}
              onKeyDown={handleKeyDown}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={cn('fixed bottom-0 left-0 right-0 z-201 max-h-[90dvh] overflow-hidden rounded-t-2xl bg-white border-t border-border flex flex-col', className)}
              role="dialog"
              aria-modal="true"
              aria-label={title || ariaLabel || 'Drawer'}
            >
              <div className="sticky top-0 z-10 flex flex-col items-center justify-center bg-white pt-3 pb-2 border-b border-border shrink-0">
                <div className="h-1.5 w-12 rounded-full bg-line" />
                {title && (
                  <div className="mt-3 flex w-full items-center justify-between px-6 pb-1">
                    <div>
                      <h2 className="text-base font-semibold text-primary">{title}</h2>
                      {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
                    </div>
                    <button type="button" onClick={() => void requestClose()} className="rounded-full p-1 hover:bg-subtle" aria-label="Close">
                      <Icon as={X} size="lg" className="text-secondary" />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-8 pt-4">{watched}</div>
            </motion.div>
          ) : variant === 'slideover' ? (
            /* DESKTOP: Slideover Panel */
            <motion.div
              ref={panelRef}
              onKeyDown={handleKeyDown}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              // `cn` rather than a template string: the width is a DEFAULT that a
              // caller may replace, and two competing `max-w-*` classes in one
              // attribute are settled by stylesheet order rather than by intent.
              className={cn('fixed right-0 top-0 bottom-0 z-201 w-full max-w-md bg-white border-l border-border overflow-hidden flex flex-col', className)}
              role="dialog"
              aria-modal="true"
              aria-label={title || ariaLabel || 'Drawer'}
            >
              {title && (
                <div className="flex flex-col border-b border-border bg-white sticky top-0 z-10 shrink-0">
                  <div className="flex items-center justify-between px-6 pt-5 pb-3">
                    <h3 className="text-base font-semibold text-primary">{title}</h3>
                    <button
                      type="button"
                      onClick={() => void requestClose()}
                      className="text-secondary hover:text-primary p-1.5 rounded-xl hover:bg-subtle transition-colors"
                      aria-label="Close"
                    >
                      <Icon as={X} size="lg" />
                    </button>
                  </div>
                  {description && (
                    <div className="px-6 pb-3 text-xs font-medium text-secondary">
                      {description}
                    </div>
                  )}
                </div>
              )}
              {/*
                A COLUMN that can also scroll.

                This used to be `flex-1 overflow-y-auto` alone, which made the
                panel the only scroller — so a `ScrollingModalBody` inside it was a
                flex child of a block element, its own `flex-1` did nothing, and
                `ModalFooter` stopped wherever the content happened to end rather
                than on the panel's bottom edge. On a short form that left the
                lower half of a full-height panel blank.

                Adding `flex flex-col min-h-0` makes the documented pairing work:
                the body takes the free space and scrolls inside itself, and the
                footer — already `shrink-0` — sits on the bottom edge. `min-h-0` is
                what allows a flex child to shrink below its content height;
                without it the child refuses, and the scrollbar never appears.

                `overflow-y-auto` STAYS. Most dialogs pass a plain `ModalBody`, or
                wrap their body and footer in a `<form>` without the documented
                `flex h-full flex-col` — in both cases nothing inside claims the
                free space, and this is the scroller that keeps tall content
                reachable. It costs nothing when a body already scrolls itself,
                because then the column exactly fills this box.
              */}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{watched}</div>
            </motion.div>
          ) : (
            /* DESKTOP: Centered Modal */
            <div className="fixed inset-0 z-201 flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                ref={panelRef}
                onKeyDown={handleKeyDown}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1 }}
                transition={{ duration: 0.15 }}
                className={cn('w-full max-w-lg pointer-events-auto rounded-2xl bg-white border border-border overflow-hidden', className)}
                role="dialog"
                aria-modal="true"
                aria-label={title || ariaLabel || 'Modal'}
              >
                {title && (
                  <div className="flex items-center justify-between border-b border-border px-6 py-4">
                    <div>
                      <h2 className="text-base font-semibold text-primary">{title}</h2>
                      {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
                    </div>
                    <button type="button" onClick={() => void requestClose()} className="rounded-full p-1 hover:bg-subtle" aria-label="Close">
                      <Icon as={X} size="lg" className="text-secondary" />
                    </button>
                  </div>
                )}
                <div className={title ? "" : "p-6"}>{watched}</div>
              </motion.div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return null;
}
