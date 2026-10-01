/**
 * Moments and the studio's clock.
 *
 * A calendar event is a moment (`startsAt` is a timestamp), but people type and
 * read it as a day and a time on the studio's wall clock. These turn one into
 * the other through the organisation's timezone with nothing but Intl, so a
 * server running in UTC — which every server here does — still puts 10:00 at
 * ten in the morning in Chennai.
 */

const partsIn = (d: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
};

/** A moment, as the day and time it is in the organisation's timezone. */
export function localDayAndTime(d: Date, timezone: string): { date: string; time: string } {
  const p = partsIn(d, timezone);
  return { date: `${p.y}-${p.mo}-${p.d}`, time: `${p.h}:${p.mi}` };
}

/** How far ahead of UTC the zone's clock is at that moment, in ms. */
function offsetAt(d: Date, timezone: string): number {
  const p = partsIn(d, timezone);
  const asUtc = Date.UTC(Number(p.y), Number(p.mo) - 1, Number(p.d), Number(p.h), Number(p.mi), Number(p.s));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * The moment a wall-clock day and time happen in a timezone.
 *
 * Two passes, so a time near a daylight-saving change lands on the offset in
 * force at that time rather than the one either side of it. India has none;
 * the second pass costs nothing there.
 */
export function zonedToUtc(day: string, time: string, timezone: string): Date {
  const wall = new Date(`${day}T${time}:00Z`);
  const first = new Date(wall.getTime() - offsetAt(wall, timezone));
  const second = offsetAt(first, timezone);
  return new Date(wall.getTime() - second);
}

/** The studio's midnight starting that day. */
export const dayStartUtc = (day: string, timezone: string): Date => zonedToUtc(day, '00:00', timezone);

/** "Fri 3 Oct" on the studio's calendar. */
export function dayLabel(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/**
 * When an event happens, in words: "Fri 3 Oct 10:00–11:00", "Fri 3 Oct, all
 * day", "Fri 3 – Sun 5 Oct", or across midnight "Fri 3 Oct 22:00 – Sat 4 Oct
 * 02:00". All-day ends are exclusive (the midnight after), so the last day
 * shown is the one before.
 */
export function whenLabel(startsAt: Date, endsAt: Date, allDay: boolean, timezone: string): string {
  const start = localDayAndTime(startsAt, timezone);
  if (allDay) {
    const lastDay = new Date(endsAt.getTime() - 1);
    const last = localDayAndTime(lastDay, timezone);
    return last.date === start.date
      ? `${dayLabel(startsAt, timezone)}, all day`
      : `${dayLabel(startsAt, timezone)} – ${dayLabel(lastDay, timezone)}`;
  }
  const end = localDayAndTime(endsAt, timezone);
  return end.date === start.date
    ? `${dayLabel(startsAt, timezone)} ${start.time}–${end.time}`
    : `${dayLabel(startsAt, timezone)} ${start.time} – ${dayLabel(endsAt, timezone)} ${end.time}`;
}

/** Just the hours, for a line already about one day: "10:00–13:00". */
export function hoursLabel(startsAt: Date, endsAt: Date, timezone: string): string {
  return `${localDayAndTime(startsAt, timezone).time}–${localDayAndTime(endsAt, timezone).time}`;
}
