import { prisma } from '../lib/prisma.js';
import { calculateWorkingMinutes, type WorkingTimeResult } from './workingHours.js';

/**
 * The organisation's own working calendar, applied wherever a clock is read.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * §14 makes working hours a setting: "Monday to Saturday, 10:00 to 19:00 IST.
 * Sundays and public holidays excluded", "All configurable in Setup". The
 * columns have been on the organisation since the first schema — and every one
 * of the six places that computes elapsed time called
 * `calculateWorkingMinutes` with no calendar at all, taking the function's own
 * defaults instead. So an org that changed its hours in Setup changed nothing,
 * and the holidays §14 asks for had nowhere to be read from even once they
 * existed.
 *
 * Everything that reports elapsed time now reads the same calendar: My Work,
 * the task register, the Team screen's load and average-close, the task-type
 * medians, and the task-aging rule that compares against them. They have to
 * agree — the aging rule fires when a task exceeds twice its type's median, so
 * a median computed on one calendar and an elapsed time computed on another
 * would raise alerts that the screens then contradict.
 *
 * ─── The cache ──────────────────────────────────────────────────────────────
 *
 * Org config changes about never, and a task list computes this per row, so
 * loading it per call would put one query behind every task on the page. Held
 * for a minute, which is short enough that a Setup change shows up while
 * somebody is still looking at the screen they changed it on.
 */

export interface WorkCalendar {
  startHour: number;
  endHour: number;
  workingDays: number[];
  /** ISO "YYYY-MM-DD" days the office is closed. */
  holidays: string[];
}

/** §14's own defaults, for a caller with no organisation to hand. */
export const DEFAULT_WORK_CALENDAR: WorkCalendar = {
  startHour: 10,
  endHour: 19,
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
};

/** "10:00" → 10. A malformed value falls back rather than making the day zero hours long. */
const hourOf = (value: string | null | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? '').split(':')[0], 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? parsed : fallback;
};

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; calendar: WorkCalendar }>();

export async function loadWorkCalendar(organizationId: string): Promise<WorkCalendar> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.calendar;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { workingHoursStart: true, workingHoursEnd: true, workingDays: true, holidays: true },
  });

  const calendar: WorkCalendar = org
    ? {
        startHour: hourOf(org.workingHoursStart, DEFAULT_WORK_CALENDAR.startHour),
        endHour: hourOf(org.workingHoursEnd, DEFAULT_WORK_CALENDAR.endHour),
        workingDays: org.workingDays?.length ? org.workingDays : DEFAULT_WORK_CALENDAR.workingDays,
        holidays: org.holidays ?? [],
      }
    : DEFAULT_WORK_CALENDAR;

  cache.set(organizationId, { at: Date.now(), calendar });
  return calendar;
}

/** Drops a cached calendar so a Setup save takes effect at once. */
export function forgetWorkCalendar(organizationId: string): void {
  cache.delete(organizationId);
}

/** `calculateWorkingMinutes` with a calendar applied — the form every caller should use. */
export function workingMinutesOn(
  calendar: WorkCalendar,
  from: Date | string,
  to: Date | string,
  waitingTotalMinutes = 0,
): WorkingTimeResult {
  return calculateWorkingMinutes(
    from,
    to,
    waitingTotalMinutes,
    calendar.startHour,
    calendar.endHour,
    calendar.workingDays,
    calendar.holidays,
  );
}

// ── Calendar days ───────────────────────────────────────────────────────────
//
// Plain "YYYY-MM-DD" keys, read as calendar days with no time and no zone — the
// shape a due date is stored in (@db.Date) and a holiday is listed in. Kept
// off the clock on purpose: shifting a date by a timezone is how a Thursday
// becomes a Wednesday.

/** The weekday of a calendar day: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** A calendar day `n` days on (or back, for a negative `n`). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today, as a calendar day where the organisation is — not where the server is. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Open for work: one of the working days of the week, and not a holiday. */
export function isWorkingDay(calendar: WorkCalendar, day: string): boolean {
  return calendar.workingDays.includes(weekdayOf(day)) && !calendar.holidays.includes(day);
}

/** The day itself if it is a working day, otherwise the next one that is. */
export function nextWorkingDay(calendar: WorkCalendar, day: string): string {
  let d = day;
  // A year of days off would be a broken calendar, not a long holiday.
  for (let i = 0; i < 366 && !isWorkingDay(calendar, d); i++) d = addDays(d, 1);
  return d;
}
