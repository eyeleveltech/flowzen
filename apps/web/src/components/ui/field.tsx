'use client';

import { useId } from 'react';
import { Select, SelectProps } from '@/components/ui/select';

export interface FieldProps {
  id?: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  icon?: React.ReactNode;
  error?: string;
  hint?: string;
  textarea?: boolean;
  rows?: number;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
}

export function Field({
  id,
  name,
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
  icon,
  error,
  hint,
  textarea = false,
  rows = 3,
  disabled = false,
  autoComplete,
  className = '',
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-body mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {textarea ? (
        <textarea
          id={fieldId}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-body outline-none transition-colors duration-150 motion-reduce:transition-none resize-none ${
            error
              ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
              : 'border-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1'
          }`}
        />
      ) : (
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {icon}
            </div>
          )}
          <input
            id={fieldId}
            name={name}
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete={autoComplete}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
            className={`w-full rounded-xl border bg-white ${
              icon ? 'pl-9' : 'px-4'
            } pr-4 py-2.5 text-sm text-body outline-none transition-colors duration-150 motion-reduce:transition-none ${
              error
                ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                : 'border-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1'
            }`}
          />
        </div>
      )}
      {error && (
        <p id={`${fieldId}-error`} aria-live="polite" className="mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${fieldId}-hint`} className="mt-1 text-xs text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

export interface FieldSelectProps extends SelectProps {
  id?: string;
  label: string;
  error?: string;
}

export function FieldSelect({
  id,
  label,
  required,
  error,
  value,
  onChange,
  options,
  placeholder,
  className = '',
  disabled,
  rounded,
  ariaLabel,
  buttonClassName,
  leadingIcon,
}: FieldSelectProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-body mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <Select
        id={fieldId}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        rounded={rounded}
        ariaLabel={ariaLabel || label}
        buttonClassName={buttonClassName}
        leadingIcon={leadingIcon}
      />
      {error && (
        <p id={`${fieldId}-error`} aria-live="polite" className="mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

export interface FieldCheckboxProps {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function FieldCheckbox({
  id,
  label,
  checked,
  onChange,
  hint,
  disabled = false,
  className = '',
}: FieldCheckboxProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;

  return (
    <div className={`flex items-start gap-3 p-3 bg-gray-50 border border-border rounded-xl ${className}`}>
      <input
        id={fieldId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 mt-0.5 text-primary rounded border-gray-300 focus:ring-primary cursor-pointer"
      />
      <div>
        <label htmlFor={fieldId} className="text-sm font-medium text-body cursor-pointer">
          {label}
        </label>
        {hint && <p className="text-xs text-secondary mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}
