'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowDownAZ, ArrowUpZA } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ColumnDropdownProps {
  title: string;
  // Sort
  sortAscValue?: string;
  sortDescValue?: string;
  sortAscLabel?: string;
  sortDescLabel?: string;
  currentSort?: string;
  onSortChange?: (val: string) => void;
  align?: 'left' | 'right';
}

export function ColumnDropdown({
  title,
  sortAscValue,
  sortDescValue,
  sortAscLabel = 'Sort Lowest to Highest',
  sortDescLabel = 'Sort Highest to Lowest',
  currentSort,
  onSortChange,
  align = 'left'
}: ColumnDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  // Close on scroll or resize
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = () => setIsOpen(false);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      // Very basic outside click logic (since we portal, it's a bit tricky, but checking if it's a button helps)
      const target = e.target as HTMLElement;
      if (!target.closest('.column-dropdown-content') && !triggerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleSort = (val: string) => {
    if (onSortChange) {
      // Toggle off if already selected
      if (currentSort === val) onSortChange('');
      else onSortChange(val);
    }
    setIsOpen(false);
  };

  const isSorted = currentSort === sortAscValue || currentSort === sortDescValue;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 hover:text-primary transition-colors focus:outline-none rounded-md px-1 -ml-1",
          isSorted ? "text-primary font-semibold" : ""
        )}
      >
        {title}
        <ChevronDown className={cn(
          "h-3.5 w-3.5 transition-transform",
          isOpen ? "rotate-180" : "",
          isSorted ? "text-primary" : "text-secondary opacity-50"
        )} />
      </button>

      {isOpen && rect && typeof window !== 'undefined' && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'fixed',
              top: rect.bottom + 8,
              left: align === 'left' ? rect.left : undefined,
              right: align === 'right' ? window.innerWidth - rect.right : undefined,
            }}
            className="column-dropdown-content z-100 min-w-[200px] rounded-xl border border-border bg-white shadow-xl overflow-hidden text-sm flex flex-col"
          >
            {/* Sorting Section */}
            {(sortAscValue || sortDescValue) && (
              <div className="p-1">
                {sortAscValue && (
                  <button
                    onClick={() => handleSort(sortAscValue)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface transition-colors",
                      currentSort === sortAscValue ? "bg-surface font-medium text-primary" : "text-[#374151]"
                    )}
                  >
                    <ArrowDownAZ className="h-4 w-4 text-secondary" /> {sortAscLabel}
                  </button>
                )}
                {sortDescValue && (
                  <button
                    onClick={() => handleSort(sortDescValue)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface transition-colors",
                      currentSort === sortDescValue ? "bg-surface font-medium text-primary" : "text-[#374151]"
                    )}
                  >
                    <ArrowUpZA className="h-4 w-4 text-secondary" /> {sortDescLabel}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
