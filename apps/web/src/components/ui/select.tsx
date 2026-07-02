'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Drawer } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

export interface Option {
  label: string;
  value: string;
  sublabel?: string; // optional secondary line shown under the label (e.g. designation)
  avatar?: string;   // optional initials shown in a circular badge (e.g. for users)
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  rounded?: string;
  ariaLabel?: string; // accessible name for the control (use when there's a visible label nearby)
  buttonClassName?: string; // override trigger styling (e.g. compact padding in a dense table)
}

export function Select({ value, onChange, options, placeholder = 'Select...', className = '', disabled = false, required = false, rounded = 'rounded-xl', ariaLabel, buttonClassName }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Only surface the search box once the list is long enough to need it.
  const showSearch = options.length > 7;

  // Update bounds
  useEffect(() => {
    if (isOpen && containerRef.current) {
      setRect(containerRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  // Close on scroll to prevent detached portaled dropdowns
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      // Don't close if scrolling inside the dropdown itself
      if ((e.target as HTMLElement)?.closest?.('[role="listbox"]')) return;
      setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setSearchQuery('');
  }, [isOpen]);

  const q = searchQuery.trim().toLowerCase();
  const filteredOptions = q
    ? options.filter(opt =>
      opt.label.toLowerCase().includes(q) ||
      (opt.sublabel ? opt.sublabel.toLowerCase().includes(q) : false)
    )
    : options;

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  // When opened: focus the search box (so the user can type immediately) when it
  // exists, otherwise focus the selected/first option for keyboard navigation.
  useEffect(() => {
    if (!isOpen) return;
    if (showSearch && !isMobile) {
      searchInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (dropdownRef.current) {
      const selected = dropdownRef.current.querySelector('[aria-selected="true"]') as HTMLElement;
      if (selected) {
        selected.focus({ preventScroll: true });
      } else {
        const first = dropdownRef.current.querySelector('[role="option"]') as HTMLElement;
        if (first) first.focus({ preventScroll: true });
      }
    }
  }, [isOpen]);

  // Flip the dropdown upward when there isn't enough room below the trigger
  // (e.g. a Status field at the bottom of a slide-in form), and clamp its
  // height to the available space so it never runs off-screen.
  const DROPDOWN_MAX = 240;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0;
  const spaceBelow = rect ? viewportH - rect.bottom : 0;
  const spaceAbove = rect ? rect.top : 0;
  const openUp = rect ? spaceBelow < Math.min(DROPDOWN_MAX, 220) && spaceAbove > spaceBelow : false;
  const dropdownMaxHeight = rect
    ? Math.max(120, Math.min(DROPDOWN_MAX, (openUp ? spaceAbove : spaceBelow) - 16))
    : DROPDOWN_MAX;

  return (
    <div
      className={`relative ${className}`}
      ref={containerRef}
    >
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            setIsOpen(true);
          }
          if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        className={cn(`flex w-full items-center justify-between ${rounded} border border-border bg-white px-4 py-2.5 text-sm text-[#374151] outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50 transition-all text-left`, buttonClassName)}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selectedOption?.avatar && (
            <span className="h-5 w-5 shrink-0 rounded-full bg-[#F3F4F6] border border-border text-primary text-[9px] font-semibold flex items-center justify-center">{selectedOption.avatar}</span>
          )}
          <span className={`min-w-0 truncate ${selectedOption && selectedOption.value !== '' ? 'text-primary' : 'text-[#374151]'}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {required && (
        <input
          tabIndex={-1}
          required
          value={value}
          readOnly
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none -z-10"
        />
      )}

      {isMobile ? (
        <Drawer isOpen={isOpen} onClose={() => setIsOpen(false)} title={placeholder}>
          <div className="flex flex-col space-y-1">
            {showSearch && (
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" aria-hidden="true" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  autoComplete="off"
                  className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-3 text-sm text-primary outline-none focus:border-primary"
                />
              </div>
            )}
            {filteredOptions.length === 0 && (
              <div className="px-4 py-3.5 text-sm text-[#9CA3AF]">No options found</div>
            )}
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2 rounded-xl text-sm transition-colors ${value === option.value
                  ? 'bg-[#F3F4F6] text-primary font-semibold'
                  : 'text-[#374151] active:bg-[#F9FAFB]'
                  }`}
              >
                <span className="flex items-center gap-3">
                  {option.avatar && (
                    <span className="h-8 w-8 shrink-0 rounded-full bg-[#F3F4F6] border border-border text-primary text-xs font-semibold flex items-center justify-center">{option.avatar}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.sublabel && <span className="block text-xs text-[#9CA3AF] truncate">{option.sublabel}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Drawer>
      ) : (
        <>
          {typeof document !== 'undefined' && createPortal(
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  ref={dropdownRef}
                  role="listbox"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="fixed z-9999 overflow-y-auto rounded-xl border border-border bg-white p-1.5 shadow-lg shadow-black/5"
                  style={{
                    width: rect ? Math.max(rect.width, 160) : 'auto',
                    left: rect ? rect.left : 0,
                    maxHeight: dropdownMaxHeight,
                    ...(openUp
                      ? { bottom: rect ? viewportH - rect.top + 8 : 0 }
                      : { top: rect ? rect.bottom + 8 : 0 }),
                  }}
                >
                  {showSearch && (
                    <div className="sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1 border-b border-[#F3F4F6] bg-white px-1.5 pt-1.5 pb-1.5">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
                        <input
                          ref={searchInputRef}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search..."
                          autoComplete="off"
                          className="w-full rounded-lg border border-border bg-white py-1.5 pl-8 pr-2 text-sm text-primary outline-none focus:border-primary"
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              (dropdownRef.current?.querySelector('[role="option"]') as HTMLElement)?.focus();
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              if (filteredOptions[0]) {
                                onChange(filteredOptions[0].value);
                                setIsOpen(false);
                                containerRef.current?.querySelector('button')?.focus();
                              }
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setIsOpen(false);
                              containerRef.current?.querySelector('button')?.focus();
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {filteredOptions.length === 0 && (
                    <div className="px-3 py-2 text-sm text-[#9CA3AF]">No options found</div>
                  )}
                  {filteredOptions.map((option) => (
                    <button
                      key={option.value}
                      role="option"
                      aria-selected={value === option.value}
                      type="button"
                      tabIndex={isOpen ? 0 : -1}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                        containerRef.current?.querySelector('button')?.focus();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onChange(option.value);
                          setIsOpen(false);
                          containerRef.current?.querySelector('button')?.focus();
                        }
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          const next = e.currentTarget.nextElementSibling as HTMLElement;
                          if (next) next.focus();
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          const prev = e.currentTarget.previousElementSibling as HTMLElement;
                          if (prev && prev.getAttribute('role') === 'option') {
                            prev.focus();
                          } else if (showSearch) {
                            searchInputRef.current?.focus();
                          } else {
                            containerRef.current?.querySelector('button')?.focus();
                          }
                        }
                        if (e.key === 'Escape') {
                          setIsOpen(false);
                          containerRef.current?.querySelector('button')?.focus();
                        }
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/10 focus:bg-[#F9FAFB] ${value === option.value
                        ? 'bg-[#F3F4F6] text-primary font-medium'
                        : 'text-[#374151] hover:bg-[#F9FAFB]'
                        }`}
                    >
                      <span className="flex items-center gap-2.5">
                        {option.avatar && (
                          <span className="h-7 w-7 shrink-0 rounded-full bg-[#F3F4F6] border border-border text-primary text-[10px] font-semibold flex items-center justify-center">{option.avatar}</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{option.label}</span>
                          {option.sublabel && <span className="block text-[11px] text-[#9CA3AF] truncate">{option.sublabel}</span>}
                        </span>
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
        </>
      )}
    </div>
  );
}
