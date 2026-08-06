import { cn } from '@/lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  id?: string;
  size?: 'md' | 'sm';
  className?: string;
  labelClassName?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
  size = 'md',
  className,
  labelClassName,
}: ToggleProps) {
  const switchSizeClass = size === 'sm' ? 'h-4.5 w-8' : 'h-5 w-9';
  const knobSizeClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const knobTranslateClass = size === 'sm'
    ? (checked ? 'translate-x-4' : 'translate-x-0.5')
    : (checked ? 'translate-x-4.5' : 'translate-x-0.5');

  return (
    <label
      htmlFor={id}
      className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}
    >
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          switchSizeClass,
          checked ? 'bg-primary' : 'bg-gray-200'
        )}
      >
        <span
          className={cn(
            'inline-block rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none',
            knobSizeClass,
            knobTranslateClass
          )}
        />
      </button>
      {label && (
        <span className={cn('text-xs font-semibold text-secondary', labelClassName)}>
          {label}
        </span>
      )}
    </label>
  );
}
