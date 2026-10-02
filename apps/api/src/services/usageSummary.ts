import { prisma } from '../lib/prisma.js';
import { addDays, isWorkingDay, loadWorkCalendar, todayIn, weekdayOf } from '../utils/workCalendar.js';
import { dayStartUtc, localDayAndTime } from '../utils/zonedTime.js';
import { SIGN_IN_VERBS } from './activityLog.js';
import { screenLabel } from './usageScreens.js';

/**
 * Who is using Flowzen — the one compute behind Settings → Usage and the
 * Monday brief's "Not using Flowzen", so the two can never disagree.
 *
 * Built from two things: the screens each person opened each day (UsageDay,
 * a per-day summary — never clicks or time on screen) and the changes they
 * made (the Activity log, less sign-ins and anything the system did itself).
 * Active accounts only. Management only — see routes/usage.ts.
 */

export type UsagePerson = {
  /** `dept` is the department's name, from the record; `departmentId` is what filters use. */
  user: { id: string; name: string; dept: string; departmentId: string | null; createdAt: Date };
  /** The last time they had a screen open; null when they never have. */
  lastActiveAt: Date | null;
  /** Days in the period with any screen opened. */
  daysActive: number;
  /** Changes made in the period — the Activity log, without sign-ins. */
  changes: number;
  /** The three screens they opened most in the period, by name. */
  topScreens: string[];
  /** Working days since they were last active; null for never. */
  inactiveWorkingDays: number | null;
};

export type UsageSummary = {
  period: { from: string; to: string; workingDays: number };
  today: string;
  activeToday: number;
  activeInPeriod: number;
  totalPeople: number;
  /** The last 14 working days up to the end of the period, for the bar chart. */
  perDay: { day: string; activePeople: number }[];
  /** Least recently active first; never-active people first of all. */
  people: UsagePerson[];
};

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Every calendar day from `from` to `to`, both included. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function composeUsageSummary(
  organizationId: string,
  opts: { from: string; to: string; now?: Date },
): Promise<UsageSummary> {
  const { from, to } = opts;
  const now = opts.now ?? new Date();
  const [calendar, org] = await Promise.all([
    loadWorkCalendar(organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);
  const timezone = org?.timezone || 'Asia/Kolkata';
  const today = todayIn(timezone, now);
  const working = (day: string) => isWorkingDay(calendar, day);

  // The chart's fourteen working days, counting back from the end of the period.
  const chartDays: string[] = [];
  for (let d = to; chartDays.length < 14 && d > addDays(to, -120); d = addDays(d, -1)) {
    if (working(d)) chartDays.unshift(d);
  }
  const earliest = chartDays.length && chartDays[0] < from ? chartDays[0] : from;

  const [users, rows, lastSeen, changeCounts] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, active: true },
      select: { id: true, name: true, createdAt: true, departmentId: true, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.usageDay.findMany({
      where: { organizationId, day: { gte: asDate(earliest), lte: asDate(to) } },
      select: { userId: true, day: true, screen: true, views: true },
    }),
    prisma.usageDay.groupBy({ by: ['userId'], where: { organizationId }, _max: { lastAt: true } }),
    prisma.activity.groupBy({
      by: ['actorId'],
      where: {
        organizationId,
        // A person's own changes: not the system's rows, not signing in.
        actorId: { not: null },
        verb: { notIn: SIGN_IN_VERBS },
        at: { gte: dayStartUtc(from, timezone), lt: dayStartUtc(addDays(to, 1), timezone) },
      },
      _count: { _all: true },
    }),
  ]);

  const active = new Set(users.map((u) => u.id));
  const inPeriod = (day: string) => day >= from && day <= to;
  const lastAtOf = new Map(lastSeen.map((r) => [r.userId, r._max.lastAt ?? null]));
  const changesOf = new Map(changeCounts.map((r) => [r.actorId, r._count._all]));

  const daysOf = new Map<string, Set<string>>();
  const screensOf = new Map<string, Map<string, number>>();
  const peopleOnDay = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!active.has(r.userId)) continue;
    const day = dayOf(r.day);
    if (!peopleOnDay.has(day)) peopleOnDay.set(day, new Set());
    peopleOnDay.get(day)!.add(r.userId);
    if (!inPeriod(day)) continue;
    if (!daysOf.has(r.userId)) daysOf.set(r.userId, new Set());
    daysOf.get(r.userId)!.add(day);
    const screens = screensOf.get(r.userId) ?? new Map<string, number>();
    screens.set(r.screen, (screens.get(r.screen) ?? 0) + r.views);
    screensOf.set(r.userId, screens);
  }

  /** Working days after `lastDay`, up to and including today. */
  const workingDaysSince = (lastDay: string) => {
    let n = 0;
    for (let d = addDays(lastDay, 1); d <= today; d = addDays(d, 1)) if (working(d)) n++;
    return n;
  };

  const people: UsagePerson[] = users.map((u) => {
    const lastActiveAt = lastAtOf.get(u.id) ?? null;
    const screens = [...(screensOf.get(u.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      user: { id: u.id, name: u.name, createdAt: u.createdAt, departmentId: u.departmentId, dept: u.department?.name ?? 'No department' },
      lastActiveAt,
      daysActive: daysOf.get(u.id)?.size ?? 0,
      changes: changesOf.get(u.id) ?? 0,
      topScreens: screens.slice(0, 3).map(([key]) => screenLabel(key)),
      inactiveWorkingDays: lastActiveAt ? workingDaysSince(localDayAndTime(lastActiveAt, timezone).date) : null,
    };
  });
  // Least recently active first: never, then the longest ago.
  people.sort((a, b) => {
    if (!a.lastActiveAt || !b.lastActiveAt) return a.lastActiveAt ? 1 : b.lastActiveAt ? -1 : a.user.name.localeCompare(b.user.name);
    return a.lastActiveAt.getTime() - b.lastActiveAt.getTime();
  });

  return {
    period: { from, to, workingDays: daysBetween(from, to).filter(working).length },
    today,
    activeToday: peopleOnDay.get(today)?.size ?? 0,
    activeInPeriod: people.filter((p) => p.daysActive > 0).length,
    totalPeople: users.length,
    perDay: chartDays.map((day) => ({ day, activePeople: peopleOnDay.get(day)?.size ?? 0 })),
    people,
  };
}

/** The last `days` days, today included, on the organisation's calendar. */
export async function usageForLastDays(organizationId: string, days: number, now = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const today = todayIn(org?.timezone || 'Asia/Kolkata', now);
  return composeUsageSummary(organizationId, { from: addDays(today, -(days - 1)), to: today, now });
}

/**
 * The Monday brief's "Not using Flowzen": active people with no active day in
 * the last complete week, Monday to Sunday on the organisation's calendar.
 * Anybody whose account is under a week old is left out — they have not had a
 * week to use it.
 */
export async function notUsingLastWeek(organizationId: string, now = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const timezone = org?.timezone || 'Asia/Kolkata';
  const today = todayIn(timezone, now);
  const thisMonday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const from = addDays(thisMonday, -7);
  const to = addDays(thisMonday, -1);
  const summary = await composeUsageSummary(organizationId, { from, to, now });
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const people = summary.people
    .filter((p) => p.daysActive === 0 && p.user.createdAt <= weekAgo)
    .map((p) => ({
      id: p.user.id,
      name: p.user.name,
      lastActiveAt: p.lastActiveAt,
      lastActive: p.lastActiveAt
        ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' }).format(p.lastActiveAt)
        : null,
    }));
  return {
    from,
    to,
    people,
    /** "Ravi (last active 22 Sep), Priya (never)" — or that everybody did. */
    line: people.length
      ? people.map((p) => `${p.name} (${p.lastActive ? `last active ${p.lastActive}` : 'never'})`).join(', ')
      : 'Everyone used Flowzen last week.',
  };
}
