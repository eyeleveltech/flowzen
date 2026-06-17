'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Drawer } from '@/components/ui/drawer';

export interface Option {
  label: string;
  value: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
}

export function Select({ value, onChange, options, placeholder = 'Select...', className = '', disabled = false, required = false }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

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
    if (!isOpen) {
      setSearchQuery('');
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    }
  }, [isOpen]);

  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  // Handle focusing the selected item or first item when opened
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const selected = dropdownRef.current.querySelector('[aria-selected="true"]') as HTMLElement;
      if (selected) {
        selected.focus({ preventScroll: true });
      } else {
        const first = dropdownRef.current.querySelector('[role="option"]') as HTMLElement;
        if (first) first.focus({ preventScroll: true });
      }
    }
  }, [isOpen]);

  return (
    <div 
      className={`relative ${className}`} 
      ref={containerRef}
      onKeyDown={(e) => {
        if (!isOpen) return;
        // Ignore navigation/selection keys
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') return;
        
        if (e.key === 'Backspace') {
          e.preventDefault();
          setSearchQuery(prev => prev.slice(0, -1));
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // If space is pressed while typing a search, add it to search instead of selecting
          if (e.key === ' ' && searchQuery.length > 0) {
            e.preventDefault();
          } else if (e.key === ' ' && searchQuery.length === 0) {
            return; // let space select the item if we aren't searching
          }
          setSearchQuery(prev => prev + e.key);
        }

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => setSearchQuery(''), 2000);
      }}
    >
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
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
        className="flex w-full items-center justify-between rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-[#374151] outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50 transition-all text-left"
      >
        <span className={selectedOption && selectedOption.value !== '' ? 'text-primary' : 'text-[#374151]'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 text-[#9CA3AF] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
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
                className={`w-full text-left px-4 py-3.5 rounded-xl text-base transition-colors ${
                  value === option.value
                    ? 'bg-[#F3F4F6] text-primary font-semibold'
                    : 'text-[#374151] active:bg-[#F9FAFB]'
                }`}
              >
                {option.label}
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
                  className="fixed z-[9999] mt-2 max-h-60 overflow-y-auto rounded-xl border border-border bg-white p-1.5 shadow-lg shadow-black/5"
                  style={{ 
                    width: rect ? Math.max(rect.width, 160) : 'auto',
                    top: rect ? rect.bottom : 0,
                    left: rect ? rect.left : 0
                  }}
                >
              {searchQuery && (
                <div className="px-3 py-1.5 text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide border-b border-[#F3F4F6] mb-1">
                  Filtering: "{searchQuery}"
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
                      if (prev) {
                        prev.focus();
                      } else {
                        containerRef.current?.querySelector('button')?.focus();
                      }
                    }
                    if (e.key === 'Escape') {
                      setIsOpen(false);
                      containerRef.current?.querySelector('button')?.focus();
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/10 focus:bg-[#F9FAFB] ${
                    value === option.value
                      ? 'bg-[#F3F4F6] text-primary font-medium'
                      : 'text-[#374151] hover:bg-[#F9FAFB]'
                  }`}
                >
                  {option.label}
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
