'use client';

/**
 * The little month in the calendar's sidebar, as Google Calendar has it.
 *
 * Paging it does not move the big calendar — you look ahead here, then click a
 * day to go there. Today is the filled circle; the days the big calendar is
 * showing are lightly marked, so you can see where you are.
 *
 * Every date is a "YYYY-MM-DD" on the studio's calendar, worked out in UTC so
 * the browser's own timezone never shifts a day.
 */

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAY = 86_400_000;
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const parse = (day: string) => new Date(`${day}T00:00:00Z`);
const monthKey = (day: string) => day.slice(0, 7);
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function MiniMonth({
  anchor,
  today,
  from,
  to,
  onPick,
}: {
  /** A day in the month the big calendar is on. */
  anchor: string;
  today: string;
  /** What the big calendar is showing, to mark it. */
  from?: string;
  to?: string;
  onPick: (day: string) => void;
}) {
  const [month, setMonth] = useState(monthKey(anchor));
  // Follow the big calendar when it moves to another month.
  useEffect(() => setMonth(monthKey(anchor)), [anchor]);

  const first = parse(`${month}-01`);
  // Weeks start on Monday, as the big calendar's do.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * DAY);
  const days = Array.from({ length: 42 }, (_, i) => isoOf(new Date(start.getTime() + i * DAY)));
  const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const step = (n: number) => {
    const d = parse(`${month}-01`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(isoOf(d).slice(0, 7));
  };

  return (
    <div className="select-none px-1">
      <div className="mb-1 flex items-center justify-between pl-2">
        <p className="text-sm font-medium text-primary">{title}</p>
        <div className="flex">
          <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="gc-icon-btn h-7 w-7">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button type="button" aria-label="Next month" onClick={() => step(1)} className="gc-icon-btn h-7 w-7">
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="gc-mini-wd py-1 text-micro font-medium">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = monthKey(d) === month;
          const isToday = d === today;
          const shown = Boolean(from && to && d >= from && d <= to);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-label={parse(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
              aria-current={isToday ? 'date' : undefined}
              className={cn('gc-mini-day mx-auto my-0.5 grid h-7 w-7 place-items-center rounded-full text-micro', {
                'gc-mini-out': !inMonth,
                'gc-mini-shown': shown && !isToday,
                'gc-mini-today': isToday,
              })}
            >
              {parse(d).getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
