import React from 'react';
import { getStatusColor, getStatusLabel } from '@/lib/status';

export interface StatusBadgeProps {
  status?: string | null;
  className?: string;
  showDot?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  labelOverride?: string;
}

export function StatusBadge({
  status,
  className = '',
  showDot = false,
  size = 'md',
  labelOverride,
}: StatusBadgeProps) {
  const config = getStatusColor(status);
  const label = labelOverride || getStatusLabel(status);

  const sizeClasses = {
    xs: 'px-2 py-0.5 text-[10px]',
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  }[size];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-lg border shrink-0 whitespace-nowrap ${config.bg} ${config.text} ${config.border} ${sizeClasses} ${className}`}
    >
      {showDot && <div className={`h-1.5 w-1.5 rounded-full mr-1.5 shrink-0 ${config.dot}`} />}
      {label}
    </span>
  );
}
