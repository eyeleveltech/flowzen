'use client';

import React, { ReactNode, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useIsMobile } from '@/hooks/use-breakpoint';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/icon';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  variant?: 'modal' | 'slideover';
  ariaLabel?: string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  variant = 'modal',
  ariaLabel
}: DrawerProps) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-focus + focus restore
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Small delay to let the animation start, then focus first field
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

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
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
              className={`fixed bottom-0 left-0 right-0 z-201 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl ${className}`}
              role="dialog"
              aria-modal="true"
              aria-label={title || ariaLabel || 'Drawer'}
            >
              <div className="sticky top-0 z-10 flex flex-col items-center justify-center bg-white pt-3 pb-2 border-b border-border">
                <div className="h-1.5 w-12 rounded-full bg-gray-300" />
                {title && (
                  <div className="mt-4 flex w-full items-center justify-between px-6 pb-2">
                    <h2 className="text-lg font-semibold text-primary">{title}</h2>
                    <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100" aria-label="Close">
                      <Icon as={X} size="lg" className="text-gray-500" />
                    </button>
                  </div>
                )}
              </div>
              <div className="px-6 pb-8 pt-4">{children}</div>
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
              className={`fixed right-0 top-0 bottom-0 z-201 w-full max-w-md bg-white border-l border-border shadow-2xl overflow-y-auto flex flex-col ${className}`}
              role="dialog"
              aria-modal="true"
              aria-label={title || ariaLabel || 'Drawer'}
            >
              {title && (
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface sticky top-0 z-10 shrink-0">
                  <h3 className="text-base font-semibold text-primary">{title}</h3>
                  <button type="button" onClick={onClose} className="text-secondary hover:text-primary p-1.5 rounded-xl hover:bg-gray-100 transition-colors" aria-label="Close">
                    <Icon as={X} size="lg" />
                  </button>
                </div>
              )}
              <div className="p-6 flex-1 overflow-y-auto">{children}</div>
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
                className={`w-full max-w-lg pointer-events-auto rounded-2xl bg-white shadow-xl ${className}`}
                role="dialog"
                aria-modal="true"
                aria-label={title || ariaLabel || 'Modal'}
              >
                {title && (
                  <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100" aria-label="Close">
                      <Icon as={X} size="lg" className="text-gray-500" />
                    </button>
                  </div>
                )}
                <div className={title ? "p-6" : ""}>{children}</div>
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
