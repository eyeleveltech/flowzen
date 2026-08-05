import { X } from 'lucide-react';
import { Icon } from '@/components/ui/icon';

interface ActiveFilterChipProps {
  label: string;
  onRemove: () => void;
  className?: string;
}

export function ActiveFilterChip({ label, onRemove, className = '' }: ActiveFilterChipProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/4 px-2.5 py-1 text-xs font-semibold text-primary shrink-0 transition-colors ${className}`}>
      <span>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-primary/10 transition-colors focus:outline-none"
        aria-label={`Remove filter: ${label}`}
      >
        <Icon as={X} size="sm" className="h-3 w-3 text-primary/70 hover:text-primary" />
      </button>
    </span>
  );
}
