'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useTimeTrackingStore } from '@/stores';
import { Clock, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function TimeTrackingPrompt() {
  const { isOpen, options, onConfirm, onCancel } = useTimeTrackingStore();
  const [hours, setHours] = useState('');

  // Reset the input when the dialog opens
  useEffect(() => {
    if (isOpen) setHours('');
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

  const handleSubmit = () => {
    const parsed = parseFloat(hours);
    if (!isNaN(parsed) && parsed > 0) {
      onConfirm(parsed);
    } else {
      onCancel();
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
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white p-6 shadow-2xl z-10"
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
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/5 text-primary">
                  <Clock className="h-6 w-6" />
                </div>
              </div>
              <div className="flex-1 pt-1 min-w-0">
                <h3 className="text-base font-semibold text-primary leading-6 truncate">
                  Task Completed!
                </h3>
                <p className="mt-2 text-sm text-secondary leading-relaxed line-clamp-2">
                  <span className="font-medium text-primary">{options.taskTitle}</span>
                </p>
                
                <p className="mt-4 text-sm text-secondary mb-1.5 font-medium">
                  How long did this take?
                </p>
                <div className="relative">
                  <input
                    type="number"
                    autoFocus
                    step="0.5"
                    min="0"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                    placeholder="e.g. 1.5"
                    autoComplete="off"
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm text-primary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-[#9CA3AF]"
                  />
                  <span className="absolute right-4 top-2.5 text-xs font-medium text-secondary">
                    hours
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="mt-6 flex justify-end gap-3 border-t border-[#F3F4F6] pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-semibold text-[#4B5563] bg-white border border-border rounded-xl hover:bg-[#F9FAFB] transition-all duration-200 active:scale-95"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!hours || isNaN(parseFloat(hours)) || parseFloat(hours) <= 0}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-[#1F2937] transition-all duration-200 shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100"
              >
                Log Time
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
