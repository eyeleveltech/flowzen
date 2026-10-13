import { prisma } from '../lib/prisma.js';
import { todayIn } from './workCalendar.js';

/**
 * Money dates, in the organisation's own timezone — the one helper every money
 * screen and job asks (Money Plan 2, decision 8).
 *
 * Two kinds of date meet in money and they were being mixed:
 *
 *   · Calendar days — `raisedAt`, `dueAt`, `incurredAt`, `receivedAt`. Stored
 *     as @db.Date, which Postgres hands back as midnight UTC. A day is compared
 *     as a "YYYY-MM-DD" key, never shifted by a zone (shifting a date by a
 *     timezone is how a Thursday becomes a Wednesday).
 *   · "Today", "this month", "this financial year" — moments, which belong to
 *     the studio's clock, not the server's. The server runs on UTC; half past
 *     midnight in Chennai on the 1st is still the 31st there.
 *
 * So: today and this month come from the org's zone; month and year
 * boundaries are built as UTC-midnight dates, which is exactly how the stored
 * calendar days compare.
 */

export const DEFAULT_TZ = 'Asia/Kolkata';

/** The organisation's timezone, and the month its financial year starts. */
export async function moneyClock(organizationId: string): Promise<{ timezone: string; fyStartMonth: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, financialYearStart: true },
  });
  return { timezone: org?.timezone || DEFAULT_TZ, fyStartMonth: org?.financialYearStart || 4 };
}

/** Today, where the studio is: "2026-10-05". */
export const orgToday = (timezone: string, now: Date = new Date()): string => todayIn(timezone, now);

/** This month, where the studio is: "2026-10". */
export const orgMonth = (timezone: string, now: Date = new Date()): string => orgToday(timezone, now).slice(0, 7);

/** A stored calendar day (@db.Date) as its key: "2026-10-05". */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** The stored-date form of a day key: midnight UTC, which is how @db.Date compares. */
export const asStoredDay = (day: string): Date => new Date(`${day.slice(0, 10)}T00:00:00Z`);

/** "2026-10" → its first day, and the first day of the next month, as stored dates. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: asStoredDay(`${month}-01`), end: asStoredDay(`${next}-01`) };
}

/** The month a stored day falls in: "2026-10". */
export const monthOfDay = (d: Date): string => dayKey(d).slice(0, 7);

/** "2026-10" plus `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * The financial year a day belongs to, as invoices print it: "26-27". It
 * begins in `fyStartMonth` (April in India), so March 2027 is still 26-27.
 */
export function financialYearOf(day: string, fyStartMonth = 4): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const start = m < fyStartMonth ? y - 1 : y;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/** The first and last-plus-one day of the financial year a day is in, as stored dates. */
export function financialYearBounds(day: string, fyStartMonth = 4): { start: Date; end: Date } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const start = m < fyStartMonth ? y - 1 : y;
  const mm = String(fyStartMonth).padStart(2, '0');
  return { start: asStoredDay(`${start}-${mm}-01`), end: asStoredDay(`${start + 1}-${mm}-01`) };
}

/**
 * Past due: due before today where the studio is, and neither paid nor
 * cancelled. One rule, so the OVERDUE filter, the badges on /money, a
 * client's tab and a project's invoices can never disagree (decision 6).
 */
export const isOverdueOn = (inv: { status: string; dueAt: Date }, today: string): boolean =>
  inv.status !== 'PAID' && inv.status !== 'CANCELLED' && dayKey(inv.dueAt) < today;
