import React, { useState, useRef, useEffect } from 'react';
import { X, Check, ChevronsUpDown } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  image?: string;
  colorClass?: string;
}

interface MultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

export function MultiSelect({ options, value, onChange, placeholder = 'Select...' }: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
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
      <div 
        className="min-h-[42px] w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] cursor-pointer flex flex-wrap gap-2 items-center transition-all focus-within:border-[#111827] focus-within:ring-1 focus-within:ring-[#111827]"
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
            {opt.image && <div className={`w-4 h-4 rounded-full text-white flex items-center justify-center text-[8px] font-bold ${opt.colorClass || 'bg-[#111827]'}`}>{opt.image}</div>}
            {opt.label}
            <button 
              type="button" 
              onClick={(e) => handleRemove(e, opt.value)}
              className="hover:bg-[#E5E7EB] rounded-full p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        
        <input
          type="text"
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

      {isOpen && (
        <div className="absolute top-full mt-1.5 w-full rounded-xl border border-[#E5E7EB] bg-white py-1.5 shadow-lg z-50 max-h-60 overflow-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-4 py-2.5 text-sm text-[#6B7280]">No results found.</div>
          ) : (
            filteredOptions.map(opt => {
              const isSelected = value.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  role="option"
                  tabIndex={0}
                  aria-selected={isSelected}
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[#F9FAFB] focus:bg-[#F9FAFB] outline-none transition-colors"
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
                      if (prev) {
                        prev.focus();
                      } else {
                        containerRef.current?.querySelector('input')?.focus();
                      }
                    }
                    if (e.key === 'Escape') {
                      setIsOpen(false);
                      containerRef.current?.querySelector('input')?.focus();
                    }
                  }}
                >
                  <div className={`flex items-center justify-center w-4 h-4 rounded border ${isSelected ? 'bg-[#111827] border-[#111827]' : 'border-[#D1D5DB]'}`}>
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  {opt.image && <div className={`w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold ${opt.colorClass || 'bg-[#111827]'}`}>{opt.image}</div>}
                  <span className="text-[#374151]">{opt.label}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
