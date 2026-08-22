'use client';

/**
 * Nothing here yet.
 *
 * An empty screen should say why it is empty and what to do about it. "No data"
 * reads as a failure; "No quotations yet — a quotation is raised against a deal"
 * tells somebody where to go.
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-subtle">
          <Icon className="h-5 w-5 text-secondary" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-sm font-medium text-primary">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-secondary">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** An inline problem, not a page-level failure. */
export function ErrorNote({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
      <p className="flex-1 text-sm text-red-700">{children}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-xs font-medium text-red-700 underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

/** Something worth knowing that is not a failure — a setting, or a consequence. */
export function Note({
  tone = 'neutral',
  children,
  onDismiss,
}: {
  tone?: 'neutral' | 'warn' | 'info';
  children: React.ReactNode;
  /** Set when the note reports something that just HAPPENED, rather than a
   *  standing condition — a confirmation nobody can clear is clutter. */
  onDismiss?: () => void;
}) {
  const tones = {
    neutral: 'border-border bg-subtle/60 text-secondary',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  };
  return (
    <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2.5', tones[tone])}>
      <p className="flex-1 text-xs">{children}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-xs font-medium underline">
          Dismiss
        </button>
      )}
    </div>
  );
}
