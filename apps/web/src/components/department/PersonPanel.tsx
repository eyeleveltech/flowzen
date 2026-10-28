'use client';

/**
 * Everything about one person in the department, without leaving the page:
 * their tasks by Overdue / Today / This week / Later / Waiting,
 * the clients and projects they are on, their week, the gear they hold and
 * what is reserved for them, and this month's time split as percentages.
 *
 * A task opens the task drawer, where the head reassigns it or moves its due
 * date through the same route every task screen uses. "Assign a task" opens
 * the new-task form with them already filled in.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Plus } from 'lucide-react';
import { api, formatDate, type CalendarItem, type DepartmentOverview } from '@/lib/api-v2';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NowBadge } from '@/components/work/WorkingOnNow';
import { cn, getAvatarColor, getInitials, plural } from '@/lib/utils';
import { addDays, WEEKDAY } from '@/components/calendar/calendarDrawing';
import { groupTasks, placeLine, statusLabel, TASK_GROUPS, type BoardTask } from './boardBits';
import { eventTime } from './PeopleTab';

type Person = DepartmentOverview['people'][number];

const Section = ({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) => (
  <section className="space-y-2">
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="eyebrow">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

export function PersonPanel({
  person,
  overview,
  allocation,
  onClose,
  onOpenTask,
  onAssign,
}: {
  person: Person | null;
  overview: DepartmentOverview;
  /** This month's split for them, from the Time split tab's own read. Undefined while it loads. */
  allocation?: { totalPercent: number; isConfirmed: boolean; allocations: { id: string; jobTitle: string; percent: number; confirmedAt: string | null }[] } | null;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onAssign: (person: { id: string; name: string }) => void;
}) {
  const departmentId = overview.department.id;
  const week = overview.week;

  // Their week: task deadlines, meetings and shoots, Google busy time — the calendar's own read.
  const { data: calendar, isPending: calendarLoading } = useQuery({
    queryKey: ['department', departmentId, 'person-week', person?.id, week.from],
    enabled: Boolean(person),
    queryFn: () =>
      api.calendar.get({ from: week.from, to: week.to, layers: ['team', 'events', 'google'], person: person!.id, onlyDepartment: departmentId }),
  });

  const theirs = useMemo(
    () => (person ? Object.values(overview.tasks).filter((t) => t.assignees.some((a) => a.id === person.id)) : []),
    [overview.tasks, person],
  );
  const groups = useMemo(() => groupTasks(theirs, overview.today, week.to), [theirs, overview.today, week.to]);

  /** The clients and work they are on, from their open tasks: "Acme · Website build — 3 tasks". */
  const work = useMemo(() => {
    const by = new Map<string, number>();
    for (const t of theirs) {
      if (t.status === 'DONE' || t.status === 'CANCELLED') continue;
      const line = placeLine(t) || 'Internal';
      by.set(line, (by.get(line) ?? 0) + 1);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [theirs]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week.from, i)), [week.from]);
  const itemsOn = (day: string) =>
    (calendar?.items ?? [])
      .filter((i: CalendarItem) => i.date === day || (i.endDate && i.date < day && i.endDate > day))
      .sort((a: CalendarItem, b: CalendarItem) => (a.time ?? '').localeCompare(b.time ?? ''));

  const reserved = person ? overview.equipment.reserved.filter((r) => r.people.some((x) => x.id === person.id)) : [];

  const row = (t: BoardTask) => (
    <li key={t.id}>
      <button
        type="button"
        onClick={() => onOpenTask(t.id)}
        className="group/row w-full rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {person?.nowTaskId === t.id && <NowBadge className="shrink-0" />}
          <span className={cn('truncate text-sm font-medium underline-offset-2 group-hover/row:underline', t.overdue ? 'text-danger' : 'text-primary')}>
            {t.title}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-micro text-secondary">
          {[placeLine(t), statusLabel(t.status), `${t.overdue ? 'was due' : 'due'} ${formatDate(t.dueDate)}`].filter(Boolean).join(' · ')}
        </span>
      </button>
    </li>
  );

  return (
    <Drawer
      isOpen={Boolean(person)}
      onClose={onClose}
      variant="slideover"
      title={person?.name ?? ''}
      description={person?.designation ?? undefined}
      className="max-w-2xl"
    >
      {person && (
        <div className="h-full space-y-7 overflow-y-auto px-6 py-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${getAvatarColor(person.name)}`}>
              {getInitials(person.name)}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 text-sm">
              {person.phone && (
                <a href={`tel:${person.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 text-body hover:text-primary hover:underline">
                  <Phone className="h-4 w-4 text-secondary" aria-hidden="true" />
                  {person.phone}
                </a>
              )}
              <a href={`mailto:${person.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-body hover:text-primary hover:underline">
                <Mail className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                <span className="truncate">{person.email}</span>
              </a>
            </div>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => onAssign({ id: person.id, name: person.name })}>
              Assign a task
            </Button>
          </div>

          {/* ── Tasks ── */}
          <Section title="Tasks" aside={<span className="text-micro text-secondary">Open a task to reassign it or move its date</span>}>
            {theirs.filter((t) => t.status !== 'DONE').length === 0 ? (
              <p className="text-sm text-secondary">Nothing open.</p>
            ) : (
              <div className="space-y-4">
                {TASK_GROUPS.filter((g) => groups[g].length > 0).map((g) => (
                  <div key={g}>
                    <p className={cn('mb-1 px-3 text-xs font-semibold', g === 'Overdue' ? 'text-danger' : 'text-body')}>
                      {g} <span className="font-normal text-secondary">{groups[g].length}</span>
                    </p>
                    <ul className="divide-y divide-border rounded-lg border border-border">{groups[g].map(row)}</ul>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Clients and projects ── */}
          <Section title="Clients and projects">
            {work.length === 0 ? (
              <p className="text-sm text-secondary">No open work.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {work.map(([line, n]) => (
                  <li key={line} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-body">{line}</span>
                    <span className="shrink-0 tabular-nums text-secondary">{plural(n, 'task')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── The week ── */}
          <Section title="This week">
            {calendarLoading ? (
              <p className="text-sm text-secondary">Loading…</p>
            ) : (
              <ol className="divide-y divide-border rounded-lg border border-border">
                {days.map((day) => {
                  const items = itemsOn(day);
                  const isToday = day === overview.today;
                  return (
                    <li key={day} className="flex gap-3 px-3 py-2">
                      <span className={cn('w-16 shrink-0 text-xs tabular-nums', isToday ? 'font-semibold text-primary' : 'text-secondary')}>
                        {WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]} {Number(day.slice(8, 10))}
                      </span>
                      {items.length === 0 ? (
                        <span className="text-xs text-secondary">—</span>
                      ) : (
                        <ul className="min-w-0 flex-1 space-y-0.5">
                          {items.map((i) => (
                            <li key={i.id} className={cn('truncate text-xs', i.overdue ? 'text-danger' : 'text-body')}>
                              <span className="tabular-nums text-secondary">{i.time ? `${i.time} ` : ''}</span>
                              {i.kind === 'task' ? `Due: ${i.title.split(' · ')[0]}` : i.title}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          {/* ── Gear ── */}
          <Section title="Gear">
            {person.gear.length === 0 && reserved.length === 0 ? (
              <p className="text-sm text-secondary">Holding nothing, and nothing reserved.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {person.gear.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className={g.overdue ? 'font-medium text-danger' : 'text-body'}>
                      {g.tag} {g.name}
                    </span>
                    <span className={cn('text-xs', g.overdue ? 'font-medium text-danger' : 'text-secondary')}>
                      {g.kind === 'CUSTODY' ? 'Held long-term' : g.overdue ? `Was due back ${formatDate(g.dueAt)}` : `Due back ${formatDate(g.dueAt)}`}
                    </span>
                  </li>
                ))}
                {reserved.map((r) => (
                  <li key={r.eventId} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-body">{r.assets.map((a) => `${a.tag} ${a.name}`).join(', ')}</span>
                    <span className="text-xs text-secondary">
                      Reserved for {r.title}, {formatDate(r.day)} {eventTime(r)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Time split — percentages, never money ── */}
          <Section
            title={`Time split · ${new Date(`${overview.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })}`}
            aside={
              allocation && allocation.allocations.length > 0 ? (
                <Badge tone={allocation.isConfirmed ? 'good' : 'warn'}>{allocation.isConfirmed ? 'Confirmed' : 'Not confirmed'}</Badge>
              ) : null
            }
          >
            {allocation === undefined ? (
              <p className="text-sm text-secondary">Loading…</p>
            ) : !allocation || allocation.allocations.length === 0 ? (
              <p className="text-sm text-secondary">No split entered for this month. Set it on the Time split tab.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {allocation.allocations.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-body">{a.jobTitle}</span>
                    <span className="shrink-0 tabular-nums font-medium text-primary">{a.percent}%</span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-border pt-1 text-xs text-secondary">
                  <span>Total</span>
                  <span className="tabular-nums">{allocation.totalPercent}%</span>
                </li>
              </ul>
            )}
          </Section>
        </div>
      )}
    </Drawer>
  );
}
