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
    <div className="grid gap-4 md:grid-cols-2">
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
  const now: BoardTask | null = p.nowTaskId ? (tasks[p.nowTaskId] ?? null) : null;
  const next: BoardTask | null = p.nextUpTaskId ? (tasks[p.nextUpTaskId] ?? null) : null;

  /** Their list as one line — only what is there, overdue in red. */
  const counts = PERSON_COUNTS.map((c) => ({ ...c, n: p.lists[c.key].length })).filter((c) => c.n > 0);

  const iconButton =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-border text-secondary outline-none transition-colors hover:border-line hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40';

  const taskButton = (t: BoardTask) => (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        onOpenTask(t.id);
      }}
      className="group/task block min-w-0 max-w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className={cn('block truncate text-sm font-medium underline-offset-2 group-hover/task:underline', t.overdue ? 'text-danger' : 'text-primary')}>
        {t.title}
      </span>
      <span className="block truncate text-micro text-secondary">{placeLine(t)}</span>
    </button>
  );

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${p.name}`}
      className="flex cursor-pointer flex-col rounded-card border border-border bg-white text-left outline-none transition-[border-color,box-shadow] hover:border-line hover:shadow-card focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {/* Who — and the three things you do with a person: call, mail, give them work. */}
      <header className="flex items-center gap-3 px-5 pt-5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${getAvatarColor(p.name)}`}>
          {getInitials(p.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-primary">{p.name}</h3>
          <p className="truncate text-xs text-secondary">{p.designation || 'No designation yet'}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {p.phone && (
            <a href={`tel:${p.phone.replace(/\s+/g, '')}`} onClick={stop} className={iconButton} aria-label={`Call ${p.name}`} title={p.phone}>
              <Phone className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          <a href={`mailto:${p.email}`} onClick={stop} className={iconButton} aria-label={`Email ${p.name}`} title={p.email}>
            <Mail className="h-4 w-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              onAssign();
            }}
            className={cn(iconButton, 'border-primary/20 text-primary')}
            aria-label={`Assign a task to ${p.name}`}
            title="Assign a task"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* What they said they are on — they set it themselves — and what is next on their own list. */}
      <div className="mx-5 mt-4 space-y-2.5">
        {now ? (
          <div className="rounded-lg bg-success-tint px-3 py-2.5">
            <p className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              Working on now
            </p>
            {taskButton(now)}
          </div>
        ) : (
          // Nothing marked: one quiet line, not an empty box on every card.
          <p className="px-3 text-micro text-secondary">
            <span className="font-semibold uppercase tracking-[0.08em]">Working on now</span> — nothing marked yet
          </p>
        )}
        <div className="px-3">
          <p className="mb-1 text-micro font-semibold uppercase tracking-[0.08em] text-secondary">Next up</p>
          {next ? taskButton(next) : <p className="text-sm text-secondary">Nothing waiting on their list</p>}
        </div>
      </div>

      {/* Their list in one line: only what is there. */}
      <p className="mx-5 mt-3 flex flex-wrap gap-x-2 gap-y-0.5 px-3 text-xs text-body">
        {counts.length === 0 ? (
          <span className="text-secondary">Nothing on their list this week</span>
        ) : (
          counts.map((c, i) => (
            <span key={c.key} title={c.hint} className="whitespace-nowrap">
              {i > 0 && <span className="mr-2 text-line" aria-hidden="true">·</span>}
              <span className={cn('font-semibold tabular-nums', c.key === 'overdue' ? 'text-danger' : 'text-primary')}>{c.n}</span>{' '}
              {c.label.toLowerCase()}
            </span>
          ))
        )}
      </p>

      {/* Today, and what they are holding. */}
      <div className="mt-4 space-y-1.5 border-t border-border px-5 py-3.5 text-xs">
        <p className="flex items-start gap-2 text-body">
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
        <p className="flex items-start gap-2 text-body">
          <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
          {p.gear.length === 0 ? (
            <span className="text-secondary">No gear held</span>
          ) : (
            <span className="min-w-0">
              {p.gear.map((g, i) => (
                <span key={g.id} className={g.overdue ? 'font-medium text-danger' : undefined}>
                  {i > 0 && ' · '}
                  {g.tag} {g.name}
                  {g.overdue ? ` — ${g.daysOverdue}d late back` : ''}
                </span>
              ))}
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
