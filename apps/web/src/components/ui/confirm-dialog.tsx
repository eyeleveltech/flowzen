'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useConfirmStore } from '@/stores';
import { AlertTriangle, Info, HelpCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';

export function ConfirmDialog() {
  const { isOpen, options, onConfirm, onCancel } = useConfirmStore();
  const [typed, setTyped] = useState('');

  // Reset the typed value each time the dialog opens.
  useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen]);

  // Escape key close handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!options) return null;

  const {
    title = 'Are you sure?',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'info',
    requireText,
    requireTextLabel,
  } = options;

  // Gate the confirm button on an exact text match when requireText is set.
  const matched = !requireText || typed.trim() === requireText.trim();

  // Icon depending on the variant.
  //
  // Only `danger` gets a colour. A confirm dialog is already the most attention-demanding thing on
  // screen — it has stopped the person and taken their focus — so tinting it as well spends the
  // alert colour on something that cannot be missed. Keeping red for destructive actions alone
  // means the red still says something when it does appear.
  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
        );
      case 'warning':
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-body">
            <AlertTriangle className="h-6 w-6" />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-secondary">
            <HelpCircle className="h-6 w-6" />
          </div>
        );
    }
  };

  // Button styles depending on variant. `warning` now uses the standard primary button: the
  // wording ("Discard", "Cancel Document") already carries the consequence, and an amber button
  // read as a third kind of severity sitting between neutral and destructive that nothing else
  // in the product uses.
  const getConfirmButtonClass = () => {
    const baseClass = "px-4 py-2 text-sm font-semibold rounded-xl transition-[transform,background-color,border-color,color] duration-200 shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1";
    switch (variant) {
      case 'danger':
        return `${baseClass} bg-danger text-white hover:bg-danger-hover`;
      case 'warning':
      case 'info':
      default:
        return `${baseClass} bg-primary text-white hover:bg-primary-hover`;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-999 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/30 backdrop-blur-xs"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white p-6 shadow-modal z-10"
          >
            {/* Close Button */}
            <button
              onClick={onCancel}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-lg p-1.5 text-secondary hover:bg-subtle hover:text-body-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1"
            >
              <Icon as={X} size="md" />
            </button>

            {/* Header / Body */}
            <div className="flex gap-4">
              <div className="shrink-0">
                {getIcon()}
              </div>
              <div className="flex-1 pt-1 min-w-0">
                <h3 className="text-base font-semibold text-primary leading-6 truncate">
                  {title}
                </h3>
                <p className="mt-2 text-sm text-secondary leading-relaxed">
                  {message}
                </p>

                {requireText && (
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-secondary mb-1.5">
                      {requireTextLabel || (
                        <>Type <span className="font-semibold text-primary break-all">{requireText}</span> to confirm</>
                      )}
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && matched) onConfirm(); }}
                      placeholder={requireText}
                      autoComplete="off"
                      spellCheck={false}
                      // House focus convention. This was a red ring on every variant, including
                      // the non-destructive ones, which made an ordinary text field look alarming.
                      className="w-full rounded-xl border border-border px-3 py-2 text-sm text-primary outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 placeholder:text-secondary"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="mt-6 flex justify-end gap-3 border-t border-subtle pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-semibold text-body-soft bg-white border border-border rounded-xl hover:bg-surface transition-[transform,background-color,border-color,color] duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!matched}
                className={`${getConfirmButtonClass()} disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
