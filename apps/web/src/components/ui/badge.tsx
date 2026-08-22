'use client';

/**
 * A small piece of state.
 *
 * The tones are named after what they MEAN rather than after their colour, so a
 * status cannot be styled green in one screen and grey in another — and so
 * "project completed" can be a good ending without being confused with "active"
 * (master plan §3.2).
 */

import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-secondary border-border',
  good: 'bg-green-50 text-green-700 border-green-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  bad: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A client's status, and what it means, in one place (§3.2). */
export const COMPANY_TONE: Record<string, { label: string; tone: Tone }> = {
  PROSPECT: { label: 'Prospect', tone: 'neutral' },
  ACTIVE: { label: 'Active client', tone: 'good' },
  ONHOLD: { label: 'On hold', tone: 'warn' },
  // A delivered project is a GOOD ending, so it is not styled as a loss.
  PROJECT_COMPLETED: { label: 'Project completed', tone: 'info' },
  CHURNED: { label: 'Churned', tone: 'bad' },
};
