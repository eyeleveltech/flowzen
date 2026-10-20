'use client';

/**
 * How a calendar is drawn — shared by the Calendar page and My Department's
 * Calendar tab, so both read the same: Google's day headings, "10 AM" hours,
 * solid colour per layer, a zone in the corner, days off shaded.
 *
 * FullCalendar runs in UTC everywhere here, so its dates ARE the
 * organisation's wall-clock values: the server sends "2026-10-19" and "17:30"
 * and they are drawn exactly as sent, never shifted into the browser's zone.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import type {
  DatesSetArg,
  DayCellContentArg,
  DayHeaderContentArg,
  EventClickArg,
  EventContentArg,
  EventInput,
  EventMountArg,
  SlotLabelContentArg,
} from '@fullcalendar/core';
import type { CalendarItem } from '@/lib/api-v2';
import { cn } from '@/lib/utils';

/* ── Dates ──────────────────────────────────────────────────────────────── */

export const dayOfUtc = (d: Date) => d.toISOString().slice(0, 10);
export const timeOfUtc = (d: Date) => d.toISOString().slice(11, 16);
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOfUtc(d);
};
export const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Now, as the organisation's wall clock — what "today" and the now-line mean. */
export function orgNow(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`;
}

/** "GMT+05:30" — Google puts the zone in the corner above the hours. */
export function zoneLabel(timezone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return (name ?? '').replace(/GMT([+-])(\d)(?=:|$)/, 'GMT$10$2');
  } catch {
    return '';
  }
}

/* ── Items into FullCalendar's events ───────────────────────────────────── */

/** Each item as an event: its layer's colour, done and busy styles, outlined when not mine. */
export function toCalendarEvents(items: CalendarItem[]): EventInput[] {
  return items.map((it) => ({
    id: it.id,
    // Booked for somebody else: said on the event itself, not only on hover.
    title: it.bookedByYou ? `${it.title} · Booked by you` : it.title,
    start: it.time ? `${it.date}T${it.time}:00` : it.date,
    // Meetings, shoots and busy time have an end; everything else is a moment.
    ...(it.endDate ? { end: it.endTime ? `${it.endDate}T${it.endTime}:00` : it.endDate } : {}),
    allDay: it.allDay,
    editable: it.draggable,
    durationEditable: false,
    classNames: [
      'gc-ev',
      `gc-c-${it.overdue ? 'overdue' : it.layer}`,
      it.done ? 'gc-done' : '',
      it.layer === 'google' ? 'gc-busy' : '',
      // A meeting I am not on: outlined, as Google draws one not yet mine.
      it.layer === 'events' && !it.isMine ? 'gc-outline' : '',
      it.draggable ? 'gc-drag' : '',
    ].filter(Boolean),
    extendedProps: { item: it },
  }));
}

/** The browser's own hover text: the whole title, when, where — and who booked it. */
export function hoverTitle(arg: EventMountArg) {
  const item = arg.event.extendedProps.item as CalendarItem | undefined;
  if (!item) return;
  arg.el.title = item.eventId
    ? [item.title, item.time ? `${item.time}–${item.endTime}` : 'All day', item.location, item.bookedByYou ? 'Booked by you' : `Booked by ${item.bookedBy}`]
        .filter(Boolean)
        .join(' · ')
    : item.title;
}

/* ── Google's drawing ───────────────────────────────────────────────────── */

/** The week's day heading — "MON" over a big 5, today's circled; the month's just "MON". */
export const dayHeader = (arg: DayHeaderContentArg) => {
  // Schedule's day rows say the whole date ("Thursday 1 October").
  if (arg.view.type === 'agenda') return arg.text;
  const wd = WEEKDAY[arg.date.getUTCDay()];
  if (arg.view.type !== 'timeGridWeek') return <span className="gc-dh-wd">{wd}</span>;
  return (
    <div className={cn('gc-dh', arg.isToday && 'gc-dh-today')}>
      <span className="gc-dh-wd">{wd}</span>
      <span className="gc-dh-num">{arg.date.getUTCDate()}</span>
    </div>
  );
};

/** A month cell's number, small and centred; "1 Oct" on the first. */
export const dayCell = (arg: DayCellContentArg) => {
  if (arg.view.type !== 'dayGridMonth') return undefined;
  const d = arg.date.getUTCDate();
  return (
    <span className={cn('gc-daynum', arg.isToday && 'gc-daynum-today')}>
      {d === 1 ? `${d} ${MONTH[arg.date.getUTCMonth()]}` : d}
    </span>
  );
};

/** "10 AM" at the top of each hour; nothing at midnight, as Google leaves it. */
export const slotLabel = (arg: SlotLabelContentArg) => {
  const h = arg.date.getUTCHours();
  return h === 0 ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
};

export const eventContent = (arg: EventContentArg) => {
  const item = arg.event.extendedProps.item as CalendarItem | undefined;
  const timed = !arg.event.allDay;
  if (arg.view.type === 'timeGridWeek' && timed) {
    return (
      <div className="gc-ev-body">
        <div className="gc-ev-title">{arg.event.title}</div>
        <div className="gc-ev-time">
          {arg.timeText}
          {item?.location ? `, ${item.location}` : ''}
        </div>
      </div>
    );
  }
  if (arg.view.type === 'dayGridMonth' && timed) {
    return (
      <div className="gc-ev-dotrow">
        <span className="gc-ev-dot" aria-hidden="true" />
        <span className="gc-ev-time">{arg.timeText}</span>
        <span className="gc-ev-title">{arg.event.title}</span>
      </div>
    );
  }
  return <div className="gc-ev-title">{arg.event.title}</div>;
};

/** Weekdays nobody works and the holidays among the items, as a class on the whole day. */
export function offDayClass(workingDays: number[], items: CalendarItem[]) {
  return (arg: { date: Date }) => {
    const day = dayOfUtc(arg.date);
    const off = !workingDays.includes(arg.date.getUTCDay()) || items.some((i) => i.kind === 'holiday' && i.date === day);
    return off ? ['gc-off-day'] : [];
  };
}

/* ── A read-only week ───────────────────────────────────────────────────── */

/**
 * One week, drawn as the Calendar page draws its week — for a screen that
 * shows a calendar but does not edit one (My Department). Nothing drags and an
 * empty slot does nothing; clicking an item hands it back with where it is.
 */
export function CalendarWeekView({
  items,
  timezone,
  workingDays,
  anchor,
  onRange,
  onItemClick,
  height = 640,
}: {
  items: CalendarItem[];
  timezone: string;
  workingDays: number[];
  /** A day in the week to open on. */
  anchor?: string;
  /** The week shown: Monday and Sunday, as calendar days. */
  onRange: (range: { from: string; to: string; title: string }) => void;
  onItemClick?: (item: CalendarItem, rect: DOMRect) => void;
  height?: number | string;
}) {
  const ref = useRef<FullCalendar>(null);
  const events = useMemo(() => toCalendarEvents(items.map((i) => ({ ...i, draggable: false }))), [items]);
  const dayClasses = useCallback((arg: { date: Date }) => offDayClass(workingDays, items)(arg), [workingDays, items]);

  // Move when the anchor does (the page's own Previous / Next / Today).
  useEffect(() => {
    if (anchor) ref.current?.getApi().gotoDate(anchor);
  }, [anchor]);

  /*
   * FullCalendar measures itself on window resizes only, so the sidebar
   * collapsing or Zen docking left the grid at its old width. Watch its own
   * box instead, as the Calendar page does — once a frame at most.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => ref.current?.getApi().updateSize());
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  const onDatesSet = (arg: DatesSetArg) =>
    onRange({ from: dayOfUtc(arg.start), to: addDays(dayOfUtc(arg.end), -1), title: arg.view.title });

  const onClick = (arg: EventClickArg) => {
    const item = arg.event.extendedProps.item as CalendarItem | undefined;
    if (!item || !onItemClick) return;
    arg.jsEvent.preventDefault();
    onItemClick(item, arg.el.getBoundingClientRect());
  };

  return (
    <div ref={boxRef} className="gc gc-surface min-w-0">
      <FullCalendar
        ref={ref}
        plugins={[timeGridPlugin]}
        initialView="timeGridWeek"
        initialDate={anchor}
        headerToolbar={false}
        views={{ timeGridWeek: { eventDisplay: 'block' } }}
        height={height}
        scrollTime="08:30:00"
        timeZone="UTC"
        now={() => orgNow(timezone)}
        firstDay={1}
        nowIndicator
        allDayContent={() => zoneLabel(timezone)}
        slotLabelContent={slotLabel}
        dayHeaderContent={dayHeader}
        eventContent={eventContent}
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', omitZeroMinute: true, meridiem: 'short' }}
        displayEventEnd
        events={events}
        dayCellClassNames={dayClasses}
        editable={false}
        noEventsContent="Nothing this week."
        datesSet={onDatesSet}
        eventClick={onClick}
        eventDidMount={hoverTitle}
      />
    </div>
  );
}
