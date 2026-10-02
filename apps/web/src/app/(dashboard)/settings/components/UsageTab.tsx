'use client';

/**
 * Who is using Flowzen — management only.
 *
 * Built from the screens each person opened each day (a per-day summary, never
 * clicks or time on a screen) and the changes they made. Everybody is told on
 * their Profile that this is recorded and that management can see it; rows go
 * after 90 days.
 *
 * Least recently active first, because the question this answers is "who has
 * stopped using it", not "who uses it most". A person is not a timeline here:
 * clicking one opens the Activity tab, filtered to them.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type UsageSummary } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { ErrorNote } from '@/components/ui/empty-state';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useDepartments } from '@/hooks/queries';

type Person = UsageSummary['people'][number];

/** The calendar day an instant falls on, in the organisation's zone. */
const dayKeyIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function UsageTab({
  tz,
  locale,
  onOpenPerson,
}: {
  tz: string;
  locale: string;
  /** Opens the Activity tab, filtered to this person. */
  onOpenPerson: (userId: string) => void;
}) {
  const [days, setDays] = useState<7 | 30>(7);
  // The one department list, in Settings' order; the table narrows by id.
  const { departments } = useDepartments();
  const [departmentId, setDepartmentId] = useState('');
  const { data, isPending, error } = useQuery({
    queryKey: ['usage-summary', days],
    queryFn: () => api.usage.summary(days),
  });

  /** "today 10:42", "yesterday", "3 days ago", "Never". */
  const lastActive = (p: Person, today: string) => {
    if (!p.lastActiveAt) return 'Never';
    const ago = daysBetween(dayKeyIn(p.lastActiveAt, tz), today);
    if (ago <= 0) {
      const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(
        new Date(p.lastActiveAt),
      );
      return `today ${time}`;
    }
    return ago === 1 ? 'yesterday' : `${ago} days ago`;
  };

  return (
    <SectionCard
      title="Usage"
      description="Who is using Flowzen, from the screens each person opened each day. Kept for 90 days."
      aside={
        <div role="group" aria-label="Period" className="flex gap-1.5">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                days === d ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border text-secondary hover:bg-subtle',
              )}
            >
              {d} days
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-6"
    >
      {error ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load who is using Flowzen'}</ErrorNote>
      ) : isPending || !data ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-8 w-2/3 animate-pulse rounded-lg bg-subtle" />
          <div className="h-32 animate-pulse rounded-lg bg-subtle" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-subtle" />
          ))}
        </div>
      ) : (
        <>
          <div>
            <p className="text-lg font-semibold text-primary tabular-nums">
              {data.activeInPeriod} of {data.totalPeople} {data.totalPeople === 1 ? 'person' : 'people'} used Flowzen{' '}
              {days === 7 ? 'this week' : 'in the last 30 days'}
            </p>
            <p className="mt-0.5 text-xs text-secondary tabular-nums">
              {data.activeToday} today · {data.period.workingDays} working{' '}
              {data.period.workingDays === 1 ? 'day' : 'days'} in the period
            </p>
          </div>

          <ActiveChart perDay={data.perDay} total={data.totalPeople} today={data.today} locale={locale} />

          {departments.length > 1 && (
            <div className="-mb-3 flex justify-end">
              <select
                aria-label="Show one department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="h-8 rounded-lg border border-border bg-white px-2 text-xs text-body outline-none focus:border-primary"
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>Department</TH>
                <TH>Last active</TH>
                <TH numeric>Days active</TH>
                <TH numeric>Changes</TH>
                <TH>Top screens</TH>
              </tr>
            </THead>
            <TBody>
              {data.people.filter((p) => !departmentId || p.user.departmentId === departmentId).map((p) => {
                const never = !p.lastActiveAt;
                const quiet = !never && (p.inactiveWorkingDays ?? 0) >= 3;
                return (
                  <TR key={p.user.id} onClick={() => onOpenPerson(p.user.id)}>
                    <TD>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPerson(p.user.id);
                        }}
                        title={`What ${p.user.name} did — the Activity tab`}
                        className="whitespace-nowrap rounded-sm text-left font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {p.user.name}
                      </button>
                    </TD>
                    <TD className="text-secondary">{p.user.dept || '—'}</TD>
                    <TD className="whitespace-nowrap">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5',
                          never ? 'font-medium text-danger' : quiet ? 'font-medium text-warning-ink' : 'text-body',
                        )}
                      >
                        {(never || quiet) && (
                          <span
                            aria-hidden="true"
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', never ? 'bg-danger' : 'bg-warning')}
                          />
                        )}
                        {lastActive(p, data.today)}
                      </span>
                    </TD>
                    <TD numeric className="whitespace-nowrap">
                      {p.daysActive} of {data.period.workingDays}
                    </TD>
                    <TD numeric>{p.changes}</TD>
                    <TD className="text-secondary">{p.topScreens.length ? p.topScreens.join(', ') : '—'}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <p className="-mt-3 text-xs text-secondary">
            Amber: 3 or more working days without opening Flowzen. Click a person to see what they changed.
          </p>
        </>
      )}
    </SectionCard>
  );
}

/**
 * People active on each of the last 14 working days.
 *
 * One series, so no legend — the heading names it. The scale tops out at the
 * whole team, so a short bar reads as "few of us", not "less than the busiest
 * day". Each column is the hover and focus target, wider than its bar.
 */
function ActiveChart({
  perDay,
  total,
  today,
  locale,
}: {
  perDay: UsageSummary['perDay'];
  total: number;
  today: string;
  locale: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(total, ...perDay.map((d) => d.activePeople), 1);
  const dayLabel = (day: string, long = false) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      ...(long ? { month: 'short' as const } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00Z`));
  if (perDay.length === 0) return null;
  const last = perDay[perDay.length - 1]!;

  return (
    <figure className="space-y-2">
      <figcaption className="eyebrow">People active · last {perDay.length} working days</figcaption>
      <div className="flex gap-2">
        {/* The scale: the whole team at the top, nobody at the bottom. */}
        <div className="flex h-28 flex-col justify-between text-right text-micro tabular-nums text-secondary" aria-hidden="true">
          <span className="-translate-y-1/2">{top}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-28 border-b border-line">
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden="true" />
            <ol className="absolute inset-0 flex items-end">
              {perDay.map((d, i) => {
                const pct = (d.activePeople / top) * 100;
                const on = hover === i;
                return (
                  <li
                    key={d.day}
                    tabIndex={0}
                    aria-label={`${dayLabel(d.day, true)}: ${d.activePeople} of ${total} people${d.day === today ? ', so far today' : ''}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="relative flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-subtle"
                  >
                    <span
                      className={cn(
                        'block w-full max-w-6 rounded-t-[4px] transition-colors',
                        on ? 'bg-primary' : 'bg-body-soft/70',
                      )}
                      style={{ height: d.activePeople ? `max(${pct}%, 2px)` : 0, marginInline: 1 }}
                    />
                    {on && (
                      <span
                        role="tooltip"
                        className={cn(
                          'pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-white px-2 py-1 text-xs text-body shadow-overlay',
                          i < 2 ? 'left-0' : i > perDay.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                        )}
                      >
                        <span className="block text-secondary">
                          {dayLabel(d.day, true)}
                          {d.day === today ? ' · so far' : ''}
                        </span>
                        <span className="font-medium tabular-nums text-primary">
                          {d.activePeople} of {total} people
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <ol className="mt-1 flex text-micro text-secondary" aria-hidden="true">
            {perDay.map((d, i) => (
              <li key={d.day} className="flex-1 truncate text-center tabular-nums">
                {/* Every other day, and always the last, so the labels never crowd. */}
                {i % 2 === (perDay.length - 1) % 2 ? dayLabel(d.day) : ''}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="text-xs text-secondary tabular-nums">
        {last.day === today ? 'Today so far' : dayLabel(last.day, true)}: {last.activePeople} of {total}
      </p>
    </figure>
  );
}
