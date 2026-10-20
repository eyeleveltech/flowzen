'use client';

/**
 * My Department → Work: what the department's people are working on.
 *
 * Client work by client, then each retainer or project: who of the department
 * is on it, its open and overdue tasks, and the next deadline. Below it, the
 * department's own internal projects with how far along they are. Every row
 * opens its page.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, formatDate } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorNote } from '@/components/ui/empty-state';
import { cn, plural } from '@/lib/utils';

const names = (people: { name: string }[]) => (people.length ? people.map((p) => p.name).join(', ') : 'Nobody from here');

/** "12 days left", "due today", "3 days past target". */
function daysLeftText(daysLeft: number | null): string {
  if (daysLeft === null) return 'No target date';
  if (daysLeft === 0) return 'Due today';
  if (daysLeft > 0) return `${plural(daysLeft, 'day')} left`;
  return `${plural(-daysLeft, 'day')} past target`;
}

export function WorkTab({ departmentId }: { departmentId: string }) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['department', departmentId, 'work'],
    queryFn: () => api.departments.work(departmentId),
  });

  if (error) return <ErrorNote onDismiss={() => void refetch()}>{error instanceof Error ? error.message : 'Could not load the work'}</ErrorNote>;
  if (isPending || !data) return <p className="text-sm text-secondary">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* ── Client work ── */}
      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Client work</CardTitle>
          <span className="text-micro text-secondary">Open tasks with at least one of {data.department.name} on them</span>
        </CardHeader>
        {data.clients.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">Nobody here is on any client work right now.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.clients.map((c) => (
              <li key={c.id} className="px-5 py-4">
                <Link href={c.href} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                  {c.name}
                </Link>
                <ul className="mt-2 space-y-2">
                  {c.items.map((i) => (
                    <li key={`${i.kind}:${i.id}`}>
                      <Link
                        href={i.href}
                        className="group/item grid gap-1 rounded-lg border border-border px-3 py-2.5 outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary/40 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto_minmax(0,1.2fr)] sm:items-center sm:gap-4"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge tone={i.kind === 'RETAINER' ? 'info' : 'neutral'}>{i.kind === 'RETAINER' ? 'Retainer' : 'Project'}</Badge>
                          {i.kind === 'PROJECT' && (
                            <span className="truncate text-sm font-medium text-primary underline-offset-2 group-hover/item:underline">{i.name}</span>
                          )}
                        </span>
                        <span className="truncate text-xs text-body">{names(i.people)}</span>
                        <span className="text-xs tabular-nums text-secondary">
                          {i.open} open
                          {i.overdue > 0 && <span className="font-semibold text-danger"> · {i.overdue} overdue</span>}
                        </span>
                        <span className="truncate text-xs text-secondary">
                          {i.nextDeadline ? (
                            <>
                              Next: <span className={cn(i.nextDeadline.dueDate < data.today ? 'text-danger' : 'text-body')}>{formatDate(i.nextDeadline.dueDate)}</span> ·{' '}
                              {i.nextDeadline.title}
                            </>
                          ) : (
                            'No deadline'
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Internal projects ── */}
      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Internal projects</CardTitle>
          <span className="text-micro text-secondary">The studio&apos;s own work filed under {data.department.name}</span>
        </CardHeader>
        {data.internalProjects.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">No active internal projects belong to {data.department.name}.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.internalProjects.map((p) => (
              <li key={p.id}>
                <Link
                  href={p.href}
                  className="group/ip grid gap-2 px-5 py-3.5 outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_9rem_auto] sm:items-center sm:gap-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-primary underline-offset-2 group-hover/ip:underline">{p.name}</span>
                    <span className="block truncate text-micro text-secondary">
                      Owner {p.owner?.name ?? 'not set'} · {names(p.people)}
                    </span>
                  </span>
                  {/* How far along — none with no tasks, rather than a 0% that reads as stuck. */}
                  <span className="flex items-center gap-2">
                    {p.percentDone === null ? (
                      <span className="text-xs text-secondary">No tasks yet</span>
                    ) : (
                      <>
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${p.percentDone}%` }} />
                        </span>
                        <span className="text-xs tabular-nums text-body">{p.percentDone}% done</span>
                      </>
                    )}
                  </span>
                  <span className={cn('text-xs', p.pastTarget ? 'font-semibold text-danger' : 'text-secondary')}>
                    {p.targetDate ? `${formatDate(p.targetDate)} · ` : ''}
                    {daysLeftText(p.daysLeft)}
                  </span>
                  <span className="text-xs tabular-nums text-secondary">
                    {p.open} open
                    {p.overdue > 0 && <span className="font-semibold text-danger"> · {p.overdue} overdue</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
