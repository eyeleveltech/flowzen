'use client';

import type { BriefTeamRow } from '@/lib/api-v2';
import { cn } from '@/lib/utils';

/** The four pieces of open work, in the order the bar draws them. */
const PIECES = [
  { key: 'overdue', label: 'Overdue', cls: 'bg-warning' },
  { key: 'onTrack', label: 'On track', cls: 'bg-primary/70' },
  { key: 'inReview', label: 'In review', cls: 'bg-review' },
  { key: 'waitingOnClient', label: 'Waiting on client', cls: 'bg-info' },
] as const;

/**
 * The team, by department — counts only, never a name.
 *
 * Each bar is one department's open work split so no task is in two pieces,
 * drawn to the same scale as the busiest department so two bars can be
 * compared. The numbers beside it are the brief's own counts.
 */
export function TeamBars({ rows }: { rows: BriefTeamRow[] }) {
  const total = (r: BriefTeamRow) => PIECES.reduce((s, p) => s + r.segments[p.key], 0);
  const widest = Math.max(1, ...rows.map(total));

  return (
    <div className="rounded-card border border-border bg-white px-4 py-3">
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-micro text-secondary" aria-label="Key">
        {PIECES.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-sm', p.cls)} aria-hidden="true" />
            {p.label}
          </li>
        ))}
      </ul>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.departmentId ?? 'none'} className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[10rem_1fr_auto]">
            <span className="text-sm font-medium text-primary">{r.dept}</span>
            <div
              className="flex h-2.5 overflow-hidden rounded-full bg-subtle"
              role="img"
              aria-label={`${r.dept}: ${r.segments.overdue} overdue, ${r.segments.onTrack} on track, ${r.segments.inReview} in review, ${r.segments.waitingOnClient} waiting on the client`}
            >
              {PIECES.map((p) =>
                r.segments[p.key] > 0 ? (
                  <span
                    key={p.key}
                    className={cn('h-full border-r-2 border-white last:border-r-0', p.cls)}
                    style={{ width: `${(r.segments[p.key] / widest) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
            <span className="flex flex-wrap gap-x-3 text-xs tabular-nums text-secondary sm:justify-end">
              <span className={r.overdue > 0 ? 'font-medium text-warning-ink' : undefined}>{r.overdue} overdue</span>
              <span>{r.active} active</span>
              {r.inReview > 0 && <span>{r.inReview} in review</span>}
              {r.waitingOnClient > 0 && <span>{r.waitingOnClient} waiting</span>}
              {r.overAllocatedPeople > 0 && (
                <span className="text-warning-ink">
                  {r.overAllocatedPeople} over-allocated
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-micro text-secondary">
        {rows.reduce((s, r) => s + r.dueThisWeek, 0)} due in the next seven days ·{' '}
        {rows.reduce((s, r) => s + r.doneLastWeek, 0)} done last week (a task with two departments counts in each).
      </p>
    </div>
  );
}
