/**
 * Repeating tasks — the rule and its dates.
 *
 * A repeat is one setting on a real task: "Every working day", "Every week on
 * Thursday", "Every month on the 2nd". The day comes from the due date when the
 * repeat is set, and is stored (see `TaskRepeat`). The hourly job
 * (workers/taskRepeat.cron.ts) makes each next copy from the latest one; the
 * task payloads show when that will be. Both read `nextDueFor`, so the drawer's
 * "Next copy: 30 Oct" is the day the job will actually use.
 *
 * All of it is calendar days ("YYYY-MM-DD") in the organisation's calendar:
 * its working days of the week and its holidays from Settings.
 */

import { RepeatFrequency } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  addDays,
  loadWorkCalendar,
  nextWorkingDay,
  todayIn,
  weekdayOf,
  type WorkCalendar,
} from '../utils/workCalendar.js';

export type RepeatRule = {
  frequency: RepeatFrequency;
  weekday: number | null;
  dayOfMonth: number | null;
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 1 → "1st", 2 → "2nd", 23 → "23rd", 11 → "11th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "Every working day", "Every week on Thursday", "Every month on the 2nd". */
export function repeatLabel(rule: RepeatRule): string {
  if (rule.frequency === RepeatFrequency.WEEKLY && rule.weekday != null) return `Every week on ${WEEKDAY_NAMES[rule.weekday]}`;
  if (rule.frequency === RepeatFrequency.MONTHLY && rule.dayOfMonth != null) return `Every month on the ${ordinal(rule.dayOfMonth)}`;
  return 'Every working day';
}

/** The day a weekly or monthly rule keeps, taken from a due date. */
export function ruleFromDueDate(frequency: RepeatFrequency, dueDay: string): RepeatRule {
  return {
    frequency,
    weekday: frequency === RepeatFrequency.WEEKLY ? weekdayOf(dueDay) : null,
    dayOfMonth: frequency === RepeatFrequency.MONTHLY ? Number(dueDay.slice(8, 10)) : null,
  };
}

/** A due date as a calendar day. Due dates are stored as UTC midnight. */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/**
 * The rule's own dates from `from` on, before any day-off shifting: every day,
 * every matching weekday, or the day of every month — the 31st becoming the
 * last day of a shorter month.
 */
function* ruleDates(rule: RepeatRule, from: string): Generator<string> {
  if (rule.frequency === RepeatFrequency.DAILY) {
    for (let d = from; ; d = addDays(d, 1)) yield d;
  }
  if (rule.frequency === RepeatFrequency.WEEKLY) {
    const target = rule.weekday ?? 0;
    let d = addDays(from, (target - weekdayOf(from) + 7) % 7);
    for (;;) {
      yield d;
      d = addDays(d, 7);
    }
  }
  // MONTHLY
  const want = rule.dayOfMonth ?? 1;
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (;;) {
    const day = Math.min(want, daysInMonth(y, m));
    const d = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (d >= from) yield d;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

/**
 * The next copy's due date: the first date of the rule after `lastDay` that is
 * not before `today`, moved off a day off to the next working day.
 *
 * Walked from the day after the last copy rather than from today, so a date the
 * rule placed yesterday but a holiday pushed to today is still today's copy —
 * and never a date in the past. Null only for a calendar with no working days.
 */
export function nextDueFor(rule: RepeatRule, calendar: WorkCalendar, lastDay: string, today: string): string | null {
  const gen = ruleDates(rule, addDays(lastDay, 1));
  for (let i = 0; i < 800; i++) {
    const base = gen.next().value as string;
    const due = nextWorkingDay(calendar, base);
    if (due > lastDay && due >= today) return due;
  }
  return null;
}

/**
 * When the copy for `nextDue` is made: on the day for a daily task, three days
 * ahead for a weekly or monthly one, so it is on somebody's list before it is
 * due.
 */
export function createFrom(rule: RepeatRule, nextDue: string): string {
  return rule.frequency === RepeatFrequency.DAILY ? nextDue : addDays(nextDue, -3);
}

type RepeatOnTask = {
  id: string;
  frequency: RepeatFrequency;
  weekday: number | null;
  dayOfMonth: number | null;
  stoppedAt: Date | null;
  stoppedReason: string | null;
};

/**
 * Adds `nextDue` to each task's repeat — the date the next copy will be due,
 * by the job's own rule. One query for the whole list, and the latest date in
 * each series counts deleted copies, exactly as the job does, so a deleted copy
 * is not shown as coming back.
 */
export async function withRepeatNext<T extends { repeat?: RepeatOnTask | null }>(
  orgId: string,
  rows: T[],
): Promise<(T & { repeat: (RepeatOnTask & { nextDue: string | null }) | null })[]> {
  const live = [...new Set(rows.filter((r) => r.repeat && !r.repeat.stoppedAt).map((r) => r.repeat!.id))];
  let lastByRepeat = new Map<string, string>();
  let calendar: WorkCalendar | null = null;
  let today = '';
  if (live.length > 0) {
    const [latest, cal, org] = await Promise.all([
      prisma.task.groupBy({
        by: ['repeatId'],
        // `deletedAt: undefined` opts out of the soft-delete filter: deleted
        // copies count, so they are not recreated.
        where: { repeatId: { in: live }, deletedAt: undefined },
        _max: { dueDate: true },
      }),
      loadWorkCalendar(orgId),
      prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
    ]);
    lastByRepeat = new Map(latest.filter((l) => l.repeatId && l._max.dueDate).map((l) => [l.repeatId!, dayOf(l._max.dueDate!)]));
    calendar = cal;
    today = todayIn(org?.timezone ?? 'Asia/Kolkata');
  }
  return rows.map((r) => {
    if (!r.repeat) return { ...r, repeat: null };
    const last = lastByRepeat.get(r.repeat.id);
    const nextDue = !r.repeat.stoppedAt && calendar && last ? nextDueFor(r.repeat, calendar, last, today) : null;
    return { ...r, repeat: { ...r.repeat, nextDue } };
  });
}
