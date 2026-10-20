'use client';

/**
 * My Department → People: one card per person.
 *
 * Who they are and how to reach them, what they said they are on now and what
 * is next on their own list, plain counts, today's meetings and shoots, and
 * the gear they hold. The card opens the person panel; the buttons on it act
 * without opening anything.
 *
 * In the department's order of names — never by any of the numbers. No label
 * says busy, idle or overloaded.
 */

import { CalendarClock, Mail, Package, Phone, Plus } from 'lucide-react';
import type { DepartmentOverview } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { NowBadge } from '@/components/work/WorkingOnNow';
import { cn, getAvatarColor, getInitials } from '@/lib/utils';
import { PERSON_COUNTS, placeLine, type BoardTask } from './boardBits';

type Person = DepartmentOverview['people'][number];

/** "10:00–11:00" or "All day". */
export const eventTime = (e: { allDay: boolean; time: string | null; endTime: string | null }) =>
  e.allDay ? 'All day' : `${e.time}–${e.endTime}`;

export function PeopleTab({
  overview,
  onOpenPerson,
  onOpenTask,
  onAssign,
}: {
  overview: DepartmentOverview;
  onOpenPerson: (id: string) => void;
  onOpenTask: (id: string) => void;
  onAssign: (person: { id: string; name: string }) => void;
}) {
  if (overview.people.length === 0) {
    return (
      <p className="rounded-card border border-border bg-white px-5 py-10 text-center text-sm text-secondary">
        Nobody is in {overview.department.name} yet. People are placed in Settings → Departments.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {overview.people.map((p) => (
        <PersonCard
          key={p.id}
          person={p}
          tasks={overview.tasks}
          onOpen={() => onOpenPerson(p.id)}
          onOpenTask={onOpenTask}
          onAssign={() => onAssign({ id: p.id, name: p.name })}
        />
      ))}
    </div>
  );
}

function PersonCard({
  person: p,
  tasks,
  onOpen,
  onOpenTask,
  onAssign,
}: {
  person: Person;
  tasks: DepartmentOverview['tasks'];
  onOpen: () => void;
  onOpenTask: (id: string) => void;
  onAssign: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  /** A task's title as the way into it — or a dash. */
  const taskLine = (id: string | null, now = false) => {
    const t: BoardTask | null = id ? (tasks[id] ?? null) : null;
    if (!t) return <span className="text-sm text-secondary">—</span>;
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          onOpenTask(t.id);
        }}
        className="group/task block min-w-0 max-w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {now && <NowBadge className="shrink-0" />}
          <span className={cn('truncate text-sm font-medium underline-offset-2 group-hover/task:underline', t.overdue ? 'text-danger' : 'text-primary')}>
            {t.title}
          </span>
        </span>
        <span className="block truncate text-micro text-secondary">{placeLine(t)}</span>
      </button>
    );
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${p.name}`}
      className="flex cursor-pointer flex-col gap-4 rounded-card border border-border bg-white p-5 text-left outline-none transition-colors hover:border-line focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {/* Who, and how to reach them. */}
      <header className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${getAvatarColor(p.name)}`}>
          {getInitials(p.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-primary">{p.name}</h3>
          <p className="truncate text-xs text-secondary">{p.designation || 'No designation yet'}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {p.phone && (
              <a href={`tel:${p.phone.replace(/\s+/g, '')}`} onClick={stop} className="inline-flex items-center gap-1 text-body hover:text-primary hover:underline">
                <Phone className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                {p.phone}
              </a>
            )}
            <a href={`mailto:${p.email}`} onClick={stop} className="inline-flex min-w-0 items-center gap-1 text-body hover:text-primary hover:underline">
              <Mail className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
              <span className="truncate">{p.email}</span>
            </a>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          onClick={(e: React.MouseEvent) => {
            stop(e);
            onAssign();
          }}
          aria-label={`Assign a task to ${p.name}`}
        >
          Assign
        </Button>
      </header>

      {/* What they said they are on, and what is next on their own list. */}
      <dl className="grid gap-2.5 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="eyebrow mb-1">Working on now</dt>
          <dd>{taskLine(p.nowTaskId, true)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="eyebrow mb-1">Next up</dt>
          <dd>{taskLine(p.nextUpTaskId)}</dd>
        </div>
      </dl>

      {/* Plain counts — red only for overdue above zero. */}
      <dl className="grid grid-cols-5 divide-x divide-border rounded-lg border border-border">
        {PERSON_COUNTS.map((c) => {
          const n = p.lists[c.key].length;
          return (
            <div key={c.key} className="min-w-0 px-1.5 py-2 text-center" title={c.hint}>
              <dd className={cn('text-base font-semibold tabular-nums', c.key === 'overdue' && n > 0 ? 'text-danger' : n === 0 ? 'text-secondary' : 'text-primary')}>
                {n}
              </dd>
              {/* Wraps rather than truncates: "Done this week" is three words on a phone. */}
              <dt className="text-micro leading-tight text-secondary">{c.label}</dt>
            </div>
          );
        })}
      </dl>

      {/* Today, and what they are holding. */}
      <div className="space-y-1.5 text-xs">
        <p className="flex items-start gap-1.5 text-body">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
          {p.todayEvents.length === 0 ? (
            <span className="text-secondary">No meetings or shoots today</span>
          ) : (
            <span className="min-w-0">
              {p.todayEvents.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && ' · '}
                  <span className="tabular-nums text-secondary">{eventTime(e)}</span> {e.title}
                </span>
              ))}
            </span>
          )}
        </p>
        <p className="flex items-start gap-1.5 text-body">
          <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
          {p.gear.length === 0 ? (
            <span className="text-secondary">No gear held</span>
          ) : (
            <span className="min-w-0">
              {p.gear.map((g, i) => (
                <span key={g.id} className={g.overdue ? 'font-medium text-danger' : undefined}>
                  {i > 0 && ' · '}
                  {g.tag} {g.name}
                  {g.overdue ? ` (${g.daysOverdue}d late back)` : ''}
                </span>
              ))}
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
