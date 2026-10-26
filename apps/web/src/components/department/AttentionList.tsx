'use client';

/**
 * "Needs you" — what in the department wants a look, grouped by why: overdue
 * work, work on hold more than 3 working days, work stuck in review, urgent
 * work not started, gear late back, and from the 25th a time split nobody has
 * confirmed. Each item opens what it is about.
 *
 * Grouped, because a flat list of eight rows that all say "Overdue" reads as
 * one thing eight times. Two forms: a rail beside the tabs on a wide screen,
 * and a bar that opens on anything narrower.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import { formatDate, type DepartmentAttention, type DepartmentOverview, type TeamBoardReason } from '@/lib/api-v2';
import { cn, plural } from '@/lib/utils';
import { reasonDetail } from './boardBits';

type GroupKey = TeamBoardReason | 'GEAR_OVERDUE' | 'TIME_SPLIT';

/** The groups, in the order a head deals with them. */
const GROUPS: { key: GroupKey; label: string; dot: string }[] = [
  { key: 'OVERDUE', label: 'Overdue', dot: 'bg-danger' },
  { key: 'GEAR_OVERDUE', label: 'Gear late back', dot: 'bg-danger' },
  { key: 'REVIEW_LONG', label: 'Stuck in review', dot: 'bg-review' },
  { key: 'URGENT_NOT_STARTED', label: 'Urgent, not started', dot: 'bg-warning' },
  { key: 'WAITING_LONG', label: 'On hold 3+ working days', dot: 'bg-warning' },
  { key: 'TIME_SPLIT', label: 'Time split not confirmed', dot: 'bg-warning' },
];

/** How many of a group show before "and N more". */
const SHOWN = 4;

const groupOf = (a: DepartmentAttention): GroupKey => (a.kind === 'TASK' ? a.reasons[0] : a.kind);

export function AttentionList({
  overview,
  variant,
  onOpenTask,
  onTimeSplit,
}: {
  overview: DepartmentOverview;
  /** `rail`: beside the tabs, always open. `bar`: above them, opened on demand. */
  variant: 'rail' | 'bar';
  onOpenTask: (id: string) => void;
  onTimeSplit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<GroupKey>>(() => new Set());

  const items = useMemo(
    () => overview.attention.filter((a) => a.kind !== 'TASK' || overview.tasks[a.taskId]),
    [overview],
  );
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((a) => groupOf(a) === g.key) })).filter((g) => g.items.length > 0);
  // A time split item is one entry for several people — count the people.
  const total = items.reduce((n, a) => n + (a.kind === 'TIME_SPLIT' ? a.people.length : 1), 0);

  const itemRow = (a: DepartmentAttention) => {
    const rowClass =
      'group/att block w-full rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle';
    if (a.kind === 'TASK') {
      const t = overview.tasks[a.taskId];
      return (
        <li key={`t:${a.taskId}`}>
          <button type="button" onClick={() => onOpenTask(t.id)} className={rowClass}>
            <span className="block truncate text-sm font-medium text-primary underline-offset-2 group-hover/att:underline">{t.title}</span>
            <span className="block truncate text-micro text-secondary">
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
            <span className="block truncate text-sm font-medium text-primary underline-offset-2 group-hover/att:underline">
              {a.tag} {a.name}
            </span>
            <span className="block truncate text-micro text-secondary">
              with {a.holder.name} · was due {formatDate(a.dueAt)}
            </span>
          </Link>
        </li>
      );
    }
    return (
      <li key="time-split">
        <button type="button" onClick={onTimeSplit} className={rowClass}>
          <span className="block truncate text-sm font-medium text-primary underline-offset-2 group-hover/att:underline">
            {new Date(`${a.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })}’s split
          </span>
          <span className="block truncate text-micro text-secondary">{a.people.map((p) => p.name).join(', ')}</span>
        </button>
      </li>
    );
  };

  const body =
    groups.length === 0 ? (
      <p className="flex items-start gap-2 px-2.5 py-2 text-sm text-secondary">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        Nothing needs you: nothing overdue, nothing stuck, no gear late back.
      </p>
    ) : (
      <div className="space-y-3">
        {groups.map((g) => {
          const all = expanded.has(g.key);
          const list = all ? g.items : g.items.slice(0, SHOWN);
          return (
            <section key={g.key} aria-label={g.label}>
              <h3 className="flex items-center gap-2 px-2.5 pb-1 text-xs font-semibold text-body">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', g.dot)} aria-hidden="true" />
                {g.label}
                <span className="ml-auto tabular-nums text-secondary">
                  {g.key === 'TIME_SPLIT' && g.items[0]?.kind === 'TIME_SPLIT' ? g.items[0].people.length : g.items.length}
                </span>
              </h3>
              <ul>{list.map(itemRow)}</ul>
              {g.items.length > SHOWN && (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.key)) next.delete(g.key);
                      else next.add(g.key);
                      return next;
                    })
                  }
                  className="ml-2.5 mt-0.5 rounded-sm text-micro font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {all ? 'Show fewer' : `and ${g.items.length - SHOWN} more`}
                </button>
              )}
            </section>
          );
        })}
      </div>
    );

  if (variant === 'rail') {
    return (
      <aside aria-labelledby="needs-you" className="rounded-card border border-border bg-white p-3">
        <h2 id="needs-you" className="flex items-baseline justify-between px-2.5 pb-2.5 text-sm font-semibold text-primary">
          Needs you
          {total > 0 && <span className="text-micro font-normal text-secondary">{plural(total, 'item')}</span>}
        </h2>
        {body}
      </aside>
    );
  }

  // The bar: the groups as a line of counts, the items behind it.
  return (
    <section aria-labelledby="needs-you-bar" className="rounded-card border border-border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={groups.length === 0}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default"
      >
        <span id="needs-you-bar" className="text-sm font-semibold text-primary">
          Needs you
        </span>
        {groups.length === 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-secondary">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" /> nothing right now
          </span>
        ) : (
          groups.map((g) => (
            <span key={g.key} className="flex items-center gap-1.5 text-xs text-body">
              <span className={cn('h-2 w-2 rounded-full', g.dot)} aria-hidden="true" />
              <span className="tabular-nums font-semibold">
                {g.key === 'TIME_SPLIT' && g.items[0]?.kind === 'TIME_SPLIT' ? g.items[0].people.length : g.items.length}
              </span>
              {g.label.toLowerCase()}
            </span>
          ))
        )}
        {groups.length > 0 && (
          <ChevronDown className={cn('ml-auto h-4 w-4 text-secondary transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
        )}
      </button>
      {open && <div className="border-t border-border p-3">{body}</div>}
    </section>
  );
}
