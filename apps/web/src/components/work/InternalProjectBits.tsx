'use client';

/**
 * How an internal project is going, said the same way on its page and on Live
 * work → Internal: the days to its target date, a progress bar, and who is on
 * its open work (Internal work plan, decision 5).
 */

import { formatDate, type InternalProjectProgress } from '@/lib/api-v2';
import { cn, plural } from '@/lib/utils';

/** A calendar day ("2026-10-19", or midnight UTC) as "19 Oct" — never shifted by a timezone. */
export const calendarDay = (value: string | null | undefined, withYear = false) =>
  formatDate(value, 'UTC', 'en-IN', withYear);

/**
 * "12 days left", "Due today", or "Overdue by 3 days" (red) — or nothing,
 * with no target date or once the project is marked done. Past its date with
 * nothing left open is not overdue: the work is done.
 */
export function daysLeftLabel(
  progress: Pick<InternalProjectProgress, 'daysLeft' | 'open'>,
  status: string,
): { text: string; tone: 'bad' | 'warn' | 'plain' | 'muted' } | null {
  const d = progress.daysLeft;
  if (d === null || status === 'DONE') return null;
  if (d < 0) return progress.open > 0 ? { text: `Overdue by ${plural(-d, 'day')}`, tone: 'bad' } : { text: 'Target passed, all done', tone: 'muted' };
  if (d === 0) return { text: 'Due today', tone: 'warn' };
  return { text: `${plural(d, 'day')} left`, tone: 'plain' };
}

const TONE = {
  bad: 'font-semibold text-danger',
  warn: 'font-semibold text-warning-ink',
  plain: 'text-body',
  muted: 'text-secondary',
};

/** The target date with its days left beneath — or "No target date". */
export function TargetLine({
  targetDate,
  progress,
  status,
  className,
}: {
  targetDate?: string | null;
  progress: InternalProjectProgress;
  status: string;
  className?: string;
}) {
  if (!targetDate) return <span className={cn('text-secondary', className)}>No target date</span>;
  const left = daysLeftLabel(progress, status);
  return (
    <span className={cn('block', className)}>
      <span className="block text-body">{calendarDay(targetDate)}</span>
      {left && <span className={cn('block text-micro', TONE[left.tone])}>{left.text}</span>}
    </span>
  );
}

/** % done as a bar, with the number beside it. No tasks: a dash, not 0%. */
export function ProgressBar({ progress, className }: { progress: InternalProjectProgress; className?: string }) {
  const pct = progress.percentDone;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="Done"
        aria-valuenow={pct ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn('h-full rounded-full', pct === 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-micro tabular-nums text-secondary">{pct === null ? '—' : `${pct}%`}</span>
    </div>
  );
}

/** Everyone with open tasks in it, with their open counts — by name. */
export function PeopleOnIt({ people, max = 3 }: { people: InternalProjectProgress['people']; max?: number }) {
  if (people.length === 0) return <span className="text-secondary">—</span>;
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <span className="text-body" title={people.map((p) => `${p.name} (${p.open})`).join(', ')}>
      {shown.map((p) => p.name.split(' ')[0]).join(', ')}
      {more > 0 && <span className="text-secondary"> +{more}</span>}
    </span>
  );
}
