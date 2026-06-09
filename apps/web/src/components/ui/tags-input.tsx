import React, { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';

interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagsInput({ value = [], onChange, placeholder = "Type and press Enter to add tags..." }: TagsInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newTag = inputValue.trim();
      if (newTag && !value.includes(newTag)) {
        onChange([...value, newTag]);
      }
      setInputValue('');
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter(tag => tag !== tagToRemove));
  };

  return (
    <div className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 flex flex-wrap gap-2 focus-within:border-[#111827] focus-within:ring-1 focus-within:ring-[#111827] transition-all min-h-[46px]">
      {value.map(tag => (
        <div key={tag} className="flex items-center gap-1.5 bg-[#F3F4F6] text-[#374151] px-2.5 py-1 rounded-lg text-sm font-medium">
          <span>{tag}</span>
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-[#9CA3AF] hover:text-[#4B5563] transition-colors focus:outline-none"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-[#111827] placeholder:text-[#9CA3AF] py-1"
      />
    </div>
  );
}
