'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useConfirmStore } from '@/stores';
import { AlertTriangle, Info, HelpCircle, X } from 'lucide-react';
import { useEffect } from 'react';

export function ConfirmDialog() {
  const { isOpen, options, onConfirm, onCancel } = useConfirmStore();

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
    variant = 'info'
  } = options;

  // Icon depending on the variant
  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
        );
      case 'warning':
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500">
            <HelpCircle className="h-6 w-6" />
          </div>
        );
    }
  };

  // Button styles depending on variant
  const getConfirmButtonClass = () => {
    const baseClass = "px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 shadow-sm active:scale-95";
    switch (variant) {
      case 'danger':
        return `${baseClass} bg-[#EF4444] text-white hover:bg-[#DC2626] hover:shadow-red-100`;
      case 'warning':
        return `${baseClass} bg-[#F59E0B] text-white hover:bg-[#D97706] hover:shadow-amber-100`;
      case 'info':
      default:
        return `${baseClass} bg-[#111827] text-white hover:bg-[#1F2937]`;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-[#000000]/30 backdrop-blur-xs"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-2xl z-10"
          >
            {/* Close Button */}
            <button
              onClick={onCancel}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#4B5563] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Header / Body */}
            <div className="flex gap-4">
              <div className="shrink-0">
                {getIcon()}
              </div>
              <div className="flex-1 pt-1 min-w-0">
                <h3 className="text-base font-semibold text-[#111827] leading-6 truncate">
                  {title}
                </h3>
                <p className="mt-2 text-sm text-[#6B7280] leading-relaxed">
                  {message}
                </p>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="mt-6 flex justify-end gap-3 border-t border-[#F3F4F6] pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-semibold text-[#4B5563] bg-white border border-[#E5E7EB] rounded-xl hover:bg-[#F9FAFB] transition-all duration-200 active:scale-95"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={getConfirmButtonClass()}
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
