'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Clapperboard, Flag, IndianRupee, RefreshCw, Users, type LucideIcon } from 'lucide-react';
import type { BriefComingUp } from '@/lib/api-v2';
import { cn } from '@/lib/utils';
import { compactMoney, localDay, shortDay, weekdayDate } from './format';

type Kind = 'shoot' | 'meeting' | 'invoice' | 'renewal' | 'ending';

type Chip = { key: string; kind: Kind; day: string; text: string; title: string; link: string | null };

/** Each kind keeps its own icon and colour everywhere it appears. */
const KIND: Record<Kind, { icon: LucideIcon; cls: string; word: string }> = {
  shoot: { icon: Clapperboard, cls: 'bg-review-tint text-review', word: 'Shoot' },
  meeting: { icon: Users, cls: 'bg-info-tint text-info', word: 'Meeting' },
  invoice: { icon: IndianRupee, cls: 'bg-success-tint text-success', word: 'Invoice due' },
  renewal: { icon: RefreshCw, cls: 'bg-warning-tint text-warning-ink', word: 'Renewal' },
  ending: { icon: Flag, cls: 'bg-subtle text-primary', word: 'Project ends' },
};

/** A day shows this many before "+2 more". */
const PER_DAY = 3;

function ChipView({ chip, wide }: { chip: Chip; wide?: boolean }) {
  const k = KIND[chip.kind];
  const Icon = k.icon;
  const inner = (
    <>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className={cn('min-w-0', wide ? '' : 'truncate')}>{chip.text}</span>
    </>
  );
  const cls = cn(
    'flex items-center gap-1 rounded-md px-1.5 py-1 text-micro font-medium leading-tight',
    k.cls,
    chip.link && 'transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
  );
  return chip.link ? (
    <Link href={chip.link} title={chip.title} aria-label={chip.title} className={cls}>
      {inner}
    </Link>
  ) : (
    <span title={chip.title} className={cls}>
      {inner}
    </span>
  );
}

/**
 * This week, Monday to Sunday: today marked with the gold rule the app keeps
 * for "you are here", the days gone dimmed, days off shaded. Under each day,
 * what lands on it — shoots, meetings, invoices due, renewals, projects
 * ending — each one opening its record. On a phone, the same week as a list.
 */
export function WeekTimeline({
  days,
  today,
  comingUp,
  timezone,
  currency,
}: {
  days: { day: string; working: boolean }[];
  today: string;
  comingUp: BriefComingUp;
  timezone: string;
  currency: string;
}) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const lastDay = days[days.length - 1]?.day ?? today;

  const chips: Chip[] = [
    ...comingUp.events.map((e) => {
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(e.startsAt));
      const who = e.clientName ?? e.title;
      return {
        key: `e-${e.id}`,
        kind: (e.kind === 'SHOOT' ? 'shoot' : 'meeting') as Kind,
        day: localDay(e.startsAt, timezone),
        text: `${time} ${who}`,
        title: [e.kind === 'SHOOT' ? 'Shoot' : 'Meeting', who, e.when, e.location, e.people.join(', ')].filter(Boolean).join(' · '),
        link: e.link,
      };
    }),
    ...comingUp.invoicesDue.map((i) => ({
      key: `i-${i.id}`,
      kind: 'invoice' as Kind,
      day: i.dueAt,
      text: `${compactMoney(i.balance, currency)} ${i.clientName}`,
      title: `Invoice due · ${i.clientName} · ${i.number} · ${compactMoney(i.balance, currency)}`,
      link: i.link,
    })),
    ...comingUp.projectsEnding.map((p) => ({
      key: `p-${p.id}`,
      kind: 'ending' as Kind,
      day: p.endDate,
      text: p.name,
      title: `Project ends · ${p.name} · ${p.clientName} · ${p.ownerName}`,
      link: p.link,
    })),
    ...comingUp.renewals
      .filter((r) => r.renewalDate)
      .map((r) => ({
        key: `r-${r.alertId}`,
        kind: 'renewal' as Kind,
        day: r.renewalDate!,
        text: r.clientName,
        title: `Renewal · ${r.clientName} · ${compactMoney(r.monthlyValue, currency)}/month${r.ownerName ? ` · ${r.ownerName}` : ''}`,
        link: r.link,
      })),
  ];

  const onDay = (day: string) => chips.filter((c) => c.day === day);
  // After Sunday: the rest of the seven days ahead, and renewals further out.
  const later = chips.filter((c) => c.day > lastDay && c.kind !== 'renewal');
  const laterRenewals = comingUp.renewals.filter((r) => !r.renewalDate || r.renewalDate > lastDay).length;

  const dayHead = (d: { day: string; working: boolean }) => {
    const isToday = d.day === today;
    return (
      <span className={cn('text-xs tabular-nums', isToday ? 'font-semibold text-primary' : 'text-secondary')}>
        {weekdayDate(d.day)}
        {isToday && <span className="sr-only"> (today)</span>}
        {!d.working && <span className="sr-only"> (day off)</span>}
      </span>
    );
  };
  const chipsFor = (day: string, wide = false) => {
    const all = onDay(day);
    const open = opened.has(day);
    const shown = open ? all : all.slice(0, PER_DAY);
    return (
      <div className="flex flex-col gap-1">
        {shown.map((c) => (
          <ChipView key={c.key} chip={c} wide={wide} />
        ))}
        {all.length > PER_DAY && (
          <button
            type="button"
            onClick={() => setOpened((s) => new Set(open ? [...s].filter((x) => x !== day) : [...s, day]))}
            className="rounded px-1 text-left text-micro font-medium text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {open ? 'Show fewer' : `+${all.length - PER_DAY} more`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Laptop: seven columns. */}
      <ol className="hidden grid-cols-7 overflow-hidden rounded-card border border-border bg-white sm:grid" aria-label="This week">
        {days.map((d, i) => {
          const isToday = d.day === today;
          const past = d.day < today;
          return (
            <li
              key={d.day}
              className={cn(
                'relative min-h-28 border-border p-2',
                i > 0 && 'border-l',
                !d.working && 'bg-[repeating-linear-gradient(135deg,var(--color-subtle)_0_6px,transparent_6px_12px)]',
                past && 'opacity-50',
              )}
            >
              {isToday && <span className="absolute inset-x-0 top-0 h-[3px] bg-accent" aria-hidden="true" />}
              <div className="mb-2">{dayHead(d)}</div>
              {chipsFor(d.day)}
            </li>
          );
        })}
      </ol>

      {/* Phone: the same week as an agenda. */}
      <ol className="divide-y divide-border rounded-card border border-border bg-white sm:hidden" aria-label="This week">
        {days.map((d) => {
          const isToday = d.day === today;
          const items = onDay(d.day);
          return (
            <li
              key={d.day}
              className={cn(
                'flex gap-3 px-3 py-2.5',
                d.day < today && 'opacity-50',
                !d.working && 'bg-subtle',
                isToday && 'border-l-[3px] border-l-accent',
              )}
            >
              <div className="w-14 shrink-0 pt-1">{dayHead(d)}</div>
              <div className="min-w-0 flex-1">
                {items.length ? chipsFor(d.day, true) : <span className="text-xs text-secondary">—</span>}
              </div>
            </li>
          );
        })}
      </ol>

      {(later.length > 0 || laterRenewals > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
          <span>Later:</span>
          {later.map((c) => (
            <ChipView key={c.key} chip={{ ...c, text: `${shortDay(c.day)} · ${c.text}` }} />
          ))}
          {laterRenewals > 0 && (
            <span>
              {laterRenewals} {laterRenewals === 1 ? 'renewal' : 'renewals'} in the next 45 days
            </span>
          )}
        </div>
      )}
    </div>
  );
}
