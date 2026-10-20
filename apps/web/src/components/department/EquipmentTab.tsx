'use client';

/**
 * My Department → Equipment: the gear the department's people are holding —
 * long-term, or out on a booking with the day it is due back (red once that
 * has passed) — and the gear reserved for their coming meetings and shoots,
 * with the asset register's own clash warnings.
 */

import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { formatDate, type DepartmentOverview } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { eventTime } from './PeopleTab';

export function EquipmentTab({ overview }: { overview: DepartmentOverview }) {
  const nameOf = new Map(overview.people.map((p) => [p.id, p.name]));
  const { held, reserved } = overview.equipment;
  const out = held.filter((g) => g.kind === 'BOOKING').sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  const custody = held.filter((g) => g.kind === 'CUSTODY');

  const gearRow = (g: (typeof held)[number]) => (
    <li key={g.id}>
      <Link
        href={`/assets/${g.id}`}
        className="grid gap-1 px-5 py-3 outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4"
      >
        <span className={cn('truncate text-sm font-medium', g.overdue ? 'text-danger' : 'text-primary')}>
          {g.tag} {g.name}
        </span>
        <span className="truncate text-xs text-body">{nameOf.get(g.holderId) ?? '—'}</span>
        <span className={cn('text-xs', g.overdue ? 'font-semibold text-danger' : 'text-secondary')}>
          {g.kind === 'CUSTODY'
            ? 'Held long-term'
            : g.overdue
              ? `Was due back ${formatDate(g.dueAt)} · ${g.daysOverdue}d late`
              : `Due back ${formatDate(g.dueAt)}`}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="space-y-6">
      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Out on booking</CardTitle>
          <span className="text-micro text-secondary">Checked out to the team, with the day it is due back</span>
        </CardHeader>
        {out.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">Nothing is out on a booking.</p>
        ) : (
          <ul className="divide-y divide-border">{out.map(gearRow)}</ul>
        )}
      </Card>

      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Held long-term</CardTitle>
        </CardHeader>
        {custody.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">Nobody here holds gear long-term.</p>
        ) : (
          <ul className="divide-y divide-border">{custody.map(gearRow)}</ul>
        )}
      </Card>

      <Card padding="none" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Reserved for the team&apos;s shoots</CardTitle>
          <span className="text-micro text-secondary">Set aside on the calendar — nothing leaves until it is checked out</span>
        </CardHeader>
        {reserved.length === 0 ? (
          <p className="px-5 py-6 text-sm text-secondary">No gear is reserved for anything coming up.</p>
        ) : (
          <ul className="divide-y divide-border">
            {reserved.map((r) => (
              <li key={r.eventId} className="space-y-1.5 px-5 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link href={`/calendar?event=${r.eventId}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                    {r.title}
                  </Link>
                  <span className="text-xs tabular-nums text-secondary">
                    {formatDate(r.day)} · {eventTime(r)}
                  </span>
                </div>
                <p className="text-xs text-body">
                  {r.assets.map((a) => `${a.tag} ${a.name}`).join(', ')}
                  <span className="text-secondary"> · {r.people.map((p) => p.name).join(', ')}</span>
                </p>
                {r.clashes.length > 0 && (
                  <ul className="space-y-1">
                    {r.clashes.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-warning-ink">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {c.subject} — {c.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
