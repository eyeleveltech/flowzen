import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, ChevronsUpDown } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Drawer } from '@/components/ui/drawer';

interface Option {
  value: string;
  label: string;
  image?: string;
  colorClass?: string;
  capacity?: number;
  isOverloaded?: boolean;
}

interface MultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  // compact = fixed-height trigger with a "N selected" summary (good for filter bars).
  // false = the chip trigger that grows as you add items (good for tall forms).
  compact?: boolean;
  showSelectAll?: boolean;
}

export function MultiSelect({ options, value, onChange, placeholder = 'Select...', compact = true, showSelectAll = true }: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const t = event.target as Node;
      // If click target is inside a portaled select dropdown or drawer, ignore it.
      if (t instanceof HTMLElement && (t.closest('.multiselect-drawer') || t.closest('[data-multiselect-dropdown]'))) {
        return;
      }
      // The dropdown is portaled to <body>, so check it too (not just the trigger).
      if (
        containerRef.current && !containerRef.current.contains(t) &&
        (!dropdownRef.current || !dropdownRef.current.contains(t))
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset the search box each time the dropdown closes.
  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

  // Capture the trigger position when opening, so the portaled dropdown can anchor to it.
  useEffect(() => {
    if (isOpen && containerRef.current) setRect(containerRef.current.getBoundingClientRect());
  }, [isOpen]);

  // Close on outside scroll (but not when scrolling within the dropdown list).
  useEffect(() => {
    if (!isOpen) return;
    const onScroll = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('[data-multiselect-dropdown]')) return;
      setIsOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [isOpen]);

  // Flip the dropdown upward when there isn't room below, and clamp its height to the viewport.
  const DROPDOWN_MAX = 260;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0;
  const spaceBelow = rect ? viewportH - rect.bottom : 0;
  const spaceAbove = rect ? rect.top : 0;
  const openUp = rect ? spaceBelow < Math.min(DROPDOWN_MAX, 220) && spaceAbove > spaceBelow : false;
  const dropdownMaxHeight = rect ? Math.max(140, Math.min(DROPDOWN_MAX, (openUp ? spaceAbove : spaceBelow) - 16)) : DROPDOWN_MAX;

  const selectedOptions = options.filter(opt => value.includes(opt.value));
  const filteredOptions = options.filter(opt => opt.label.toLowerCase().includes(search.toLowerCase()));

  const handleSelect = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter(v => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const handleRemove = (e: React.MouseEvent, optionValue: string) => {
    e.stopPropagation();
    onChange(value.filter(v => v !== optionValue));
  };

  return (
    <div className="relative" ref={containerRef}>
      {compact ? (
        // Fixed-height summary trigger — keeps filter bars aligned regardless of selection.
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={placeholder}
          onClick={() => setIsOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setIsOpen(true); }
            if (e.key === 'Escape') setIsOpen(false);
          }}
          className="flex h-[42px] w-full items-center justify-between rounded-xl border border-border bg-white px-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-left"
        >
          <span className={`min-w-0 truncate ${selectedOptions.length === 0 ? 'text-[#9CA3AF]' : 'text-primary'}`}>
            {selectedOptions.length === 0
              ? placeholder
              : selectedOptions.length === 1
                ? selectedOptions[0].label
                : `${selectedOptions.length} selected`}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-[#9CA3AF] ml-2" />
        </button>
      ) : (
      <div
        className="min-h-[42px] w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary cursor-pointer flex flex-wrap gap-2 items-center transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
        onClick={() => setIsOpen(true)}
      >
        {selectedOptions.length === 0 && (
          <span className="text-[#9CA3AF] px-1">{placeholder}</span>
        )}

        {selectedOptions.map(opt => (
          <span
            key={opt.value}
            className="flex items-center gap-1 bg-[#F3F4F6] text-[#374151] px-2 py-1 rounded-lg text-xs font-medium"
          >
            {opt.image && <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-semibold ${opt.colorClass || 'bg-primary text-white'}`}>{opt.image}</div>}
            {opt.label}
            <button
              type="button"
              onClick={(e) => handleRemove(e, opt.value)}
              className="hover:bg-border rounded-full p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <input
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="flex-1 min-w-[50px] bg-transparent outline-none text-sm placeholder:text-[#9CA3AF]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={selectedOptions.length === 0 ? "" : "Search..."}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && isOpen) {
               e.preventDefault();
               const first = containerRef.current?.querySelector('[role="option"]') as HTMLElement;
               if (first) first.focus();
            }
            if (e.key === 'Escape') {
               setIsOpen(false);
            }
          }}
        />

        <div className="ml-auto flex items-center shrink-0">
          <ChevronsUpDown className="h-4 w-4 text-[#9CA3AF]" />
        </div>
      </div>
      )}

      {isOpen && isMobile ? (
        <Drawer isOpen={isOpen} onClose={() => setIsOpen(false)} title={placeholder} className="multiselect-drawer">
          <div className="flex flex-col space-y-1 mb-4">
            {compact && options.length > 7 && (
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-xl border border-border bg-white py-2.5 px-3 text-base text-primary outline-none focus:border-primary mb-2"
              />
            )}
            {filteredOptions.length === 0 ? (
              <div className="px-4 py-2.5 text-sm text-secondary">No results found.</div>
            ) : (
              <>
                {showSelectAll && (
                  <button
                    type="button"
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      if (value.length === options.length) {
                        onChange([]);
                      } else {
                        onChange(options.map(o => o.value));
                      }
                    }}
                    className="flex w-full items-center text-left gap-3 px-4 py-3.5 rounded-xl text-base transition-colors text-primary active:bg-[#F9FAFB] font-semibold border-b border-border/50 mb-1"
                  >
                    <div className={`flex items-center justify-center w-5 h-5 rounded border shrink-0 ${value.length === options.length ? 'bg-primary border-primary' : 'border-[#D1D5DB]'}`}>
                      {value.length === options.length && <Check className="h-3.5 w-3.5 text-white" />}
                    </div>
                    <span>Select All</span>
                  </button>
                )}
                {filteredOptions.map((opt) => {
                  const isSelected = value.includes(opt.value);
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={(e) => { e.stopPropagation(); handleSelect(opt.value); }}
                    className={`flex w-full items-center text-left gap-3 px-4 py-3.5 rounded-xl text-base transition-colors ${
                      isSelected
                        ? 'bg-[#F3F4F6] text-primary font-semibold'
                        : 'text-[#374151] active:bg-[#F9FAFB]'
                    }`}
                  >
                    <div className={`flex items-center justify-center w-5 h-5 rounded border shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-[#D1D5DB]'}`}>
                      {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                    </div>
                    {opt.image && <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold ${opt.colorClass || 'bg-primary text-white'}`}>{opt.image}</div>}
                    <span className="truncate flex-1">{opt.label}</span>
                    {opt.capacity !== undefined && (
                      <span className="flex items-center gap-1.5 shrink-0 ml-2" title={`Capacity: ${opt.capacity}%`}>
                        <span className={`w-2 h-2 rounded-full ${opt.isOverloaded || opt.capacity > 80 ? 'bg-red-500' : opt.capacity > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                        <span className="text-[11px] font-medium text-[#86868B]">{opt.capacity}%</span>
                      </span>
                    )}
                  </button>
                );
              })}
              </>
            )}
          </div>
        </Drawer>
      ) : (
        typeof document !== 'undefined' && isOpen && createPortal(
        <div
          ref={dropdownRef}
          data-multiselect-dropdown
          role="listbox"
          aria-multiselectable="true"
          className="fixed z-9999 overflow-y-auto rounded-xl border border-border bg-white py-1.5 shadow-lg shadow-black/5"
          style={{
            width: rect ? Math.max(rect.width, 160) : 'auto',
            left: rect ? rect.left : 0,
            maxHeight: dropdownMaxHeight,
            ...(openUp
              ? { bottom: rect ? viewportH - rect.top + 8 : 0 }
              : { top: rect ? rect.bottom + 8 : 0 }),
          }}
        >
          {compact && options.length > 7 && (
            <div className="sticky top-0 z-10 -mt-1.5 mb-1 bg-white px-1.5 pt-1.5 pb-1.5 border-b border-[#F3F4F6]">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-lg border border-border bg-white py-1.5 px-2.5 text-sm text-primary outline-none focus:border-primary"
              />
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-4 py-2.5 text-sm text-secondary">No results found.</div>
          ) : (
            <>
              {showSelectAll && (
                <div
                  className="flex items-center gap-2 mx-1.5 px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-[#F9FAFB] text-primary font-medium transition-colors border-b border-border/50 mb-1 pb-2"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (value.length === options.length) {
                      onChange([]);
                    } else {
                      onChange(options.map(o => o.value));
                    }
                  }}
                >
                  <div className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${value.length === options.length ? 'bg-primary border-primary' : 'border-[#D1D5DB]'}`}>
                    {value.length === options.length && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <span>Select All</span>
                </div>
              )}
              {filteredOptions.map(opt => {
                const isSelected = value.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  role="option"
                  tabIndex={isOpen ? 0 : -1}
                  aria-selected={isSelected}
                  className="flex items-center gap-2 mx-1.5 px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-[#F9FAFB] focus:bg-[#F9FAFB] focus:ring-2 focus:ring-inset focus:ring-primary/10 outline-none transition-colors"
                  onClick={(e) => { e.stopPropagation(); handleSelect(opt.value); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(opt.value);
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
                      } else {
                        dropdownRef.current?.querySelector('input')?.focus();
                      }
                    }
                    if (e.key === 'Escape') {
                      setIsOpen(false);
                    }
                  }}
                >
                  <div className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-[#D1D5DB]'}`}>
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  {opt.image && <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${opt.colorClass || 'bg-primary text-white'}`}>{opt.image}</div>}
                  <span className="text-[#374151] truncate flex-1">{opt.label}</span>
                  {opt.capacity !== undefined && (
                    <span className="flex items-center gap-1.5 shrink-0 ml-2" title={`Capacity: ${opt.capacity}%`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${opt.isOverloaded || opt.capacity > 80 ? 'bg-red-500' : opt.capacity > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      <span className="text-[10px] font-medium text-[#86868B]">{opt.capacity}%</span>
                    </span>
                  )}
                </div>
              );
            })}
            </>
          )}
        </div>,
        document.body
        )
      )}
    </div>
  );
}
