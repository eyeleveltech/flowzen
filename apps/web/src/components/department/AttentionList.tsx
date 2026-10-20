'use client';

/**
 * "Needs attention", at the top of My Department: the team's overdue work, work
 * on hold more than 3 working days, work stuck in review, urgent work not
 * started, gear overdue back, and — from the 25th — a time split nobody has
 * confirmed. Each item goes to what it is about.
 */

import { useState } from 'react';
import Link from 'next/link';
import { formatDate, type DepartmentOverview } from '@/lib/api-v2';
import { Badge } from '@/components/ui/badge';
import { plural } from '@/lib/utils';
import { REASON, reasonDetail } from './boardBits';

/** How many show before "Show all". */
const SHOWN = 6;

const rowClass =
  'group/att flex w-full flex-col gap-1 px-5 py-2.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle sm:flex-row sm:items-center sm:gap-3';

export function AttentionList({
  overview,
  onOpenTask,
  onTimeSplit,
}: {
  overview: DepartmentOverview;
  onOpenTask: (id: string) => void;
  onTimeSplit: () => void;
}) {
  const [all, setAll] = useState(false);
  const items = overview.attention.filter((a) => a.kind !== 'TASK' || overview.tasks[a.taskId]);
  const shown = all ? items : items.slice(0, SHOWN);

  return (
    <section aria-labelledby="needs-attention" className="overflow-hidden rounded-card border border-border bg-white">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
        <h2 id="needs-attention" className="text-sm font-semibold text-primary">
          Needs attention
        </h2>
        {items.length > 0 && <span className="text-micro text-secondary">{plural(items.length, 'item')}</span>}
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-3.5 text-sm text-secondary">
          Nothing needs a look: nothing overdue, nothing stuck on hold or in review, no urgent work waiting, no gear late back.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {shown.map((a) => {
              if (a.kind === 'TASK') {
                const t = overview.tasks[a.taskId];
                return (
                  <li key={`t:${a.taskId}`}>
                    <button type="button" onClick={() => onOpenTask(t.id)} className={rowClass}>
                      <span className="flex shrink-0 flex-wrap gap-1">
                        {a.reasons.map((r) => (
                          <Badge key={r} tone={REASON[r].tone}>
                            {REASON[r].label}
                          </Badge>
                        ))}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary underline-offset-2 group-hover/att:underline">
                        {t.title}
                      </span>
                      <span className="min-w-0 truncate text-micro text-secondary sm:max-w-[45%] sm:text-right">
                        {t.assignees.map((p) => p.name).join(', ')} · {reasonDetail(a.reasons[0], t)}
                      </span>
                    </button>
                  </li>
                );
              }
              if (a.kind === 'GEAR_OVERDUE') {
                return (
                  <li key={`g:${a.assetId}`}>
                    <Link href={`/assets/${a.assetId}`} className={rowClass}>
                      <span className="shrink-0">
                        <Badge tone="bad">Gear overdue back</Badge>
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary underline-offset-2 group-hover/att:underline">
                        {a.tag} {a.name}
                      </span>
                      <span className="min-w-0 truncate text-micro text-secondary sm:text-right">
                        with {a.holder.name} · was due {formatDate(a.dueAt)}
                      </span>
                    </Link>
                  </li>
                );
              }
              return (
                <li key="time-split">
                  <button type="button" onClick={onTimeSplit} className={rowClass}>
                    <span className="shrink-0">
                      <Badge tone="warn">Time split not confirmed</Badge>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary underline-offset-2 group-hover/att:underline">
                      {new Date(`${a.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })}’s split
                    </span>
                    <span className="min-w-0 truncate text-micro text-secondary sm:max-w-[50%] sm:text-right">
                      {a.people.map((p) => p.name).join(', ')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {items.length > SHOWN && (
            <div className="border-t border-border px-5 py-2.5">
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="rounded-sm text-xs font-semibold text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {all ? 'Show fewer' : `Show all ${items.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
