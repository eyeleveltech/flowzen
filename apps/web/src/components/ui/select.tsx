'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  // Handle focusing the selected item or first item when opened
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const selected = containerRef.current.querySelector('[aria-selected="true"]') as HTMLElement;
      if (selected) {
        selected.focus();
      } else {
        const first = containerRef.current.querySelector('[role="option"]') as HTMLElement;
        if (first) first.focus();
      }
    }
  }, [isOpen]);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
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
        className="flex w-full items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm text-[#374151] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] disabled:opacity-50 transition-all text-left"
      >
        <span className={selectedOption && selectedOption.value !== '' ? 'text-[#111827]' : 'text-[#374151]'}>
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

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 z-50 mt-2 min-w-full max-h-60 overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white p-1.5 shadow-lg shadow-black/5"
            style={{ width: 'max-content' }}
          >
            {options.map((option) => (
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
                      // Top of list, close it or focus input
                      containerRef.current?.querySelector('button')?.focus();
                    }
                  }
                  if (e.key === 'Escape') {
                    setIsOpen(false);
                    containerRef.current?.querySelector('button')?.focus();
                  }
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#111827]/10 focus:bg-[#F9FAFB] ${
                  value === option.value
                    ? 'bg-[#F3F4F6] text-[#111827] font-medium'
                    : 'text-[#374151] hover:bg-[#F9FAFB]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
