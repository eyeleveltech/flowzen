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

/**
 * A section that could not load — said in place of its figures, never as ₹0.
 *
 * A failed load used to show zeros, or a note blaming permissions for every
 * failure. This names what did not load, says why when the server said (your
 * role, or the server), and offers to try again.
 */
export function LoadError({
  what,
  error,
  onRetry,
  className,
}: {
  /** "the forecast", "this month's profit"… */
  what: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : null;
  const why =
    status === 403
      ? 'Your role does not include these figures.'
      : status === 401
        ? 'You have been signed out. Sign in again.'
        : message || 'The server did not answer.';
  return (
    <div role="alert" className={cn('flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-tint px-4 py-3', className)}>
      <div className="flex-1">
        <p className="text-sm font-semibold text-danger">Could not load {what}.</p>
        <p className="mt-0.5 text-xs text-secondary">{why}</p>
      </div>
      {onRetry && status !== 403 && (
        <button onClick={onRetry} className="shrink-0 rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger hover:bg-white/60">
          Try again
        </button>
      )}
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
    <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-tint px-3 py-2.5">
      <p className="flex-1 text-sm text-danger">{children}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-xs font-medium text-danger underline">
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
    warn: 'border-warning/30 bg-warning-tint text-warning-ink',
    info: 'border-info/30 bg-info-tint text-info',
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
