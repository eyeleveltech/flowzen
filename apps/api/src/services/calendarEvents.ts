import { AlertSeverity, AssetStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../utils/mailer.js';
import { logger } from '../utils/logger.js';
import { addDays } from '../utils/workCalendar.js';
import { dayStartUtc, hoursLabel, localDayAndTime, whenLabel, zonedToUtc } from '../utils/zonedTime.js';
import { googleConfigured } from './googleCalendar.js';
import { pushCalendarChange } from './push.js';

/**
 * Meetings, shoots and the gear they reserve — the parts the route, the
 * morning worker and the asset screens share.
 *
 * Four things live here:
 *
 *   1. Turning what a form sends (the studio's wall clock) into the moments an
 *      event is stored as, and back.
 *   2. Clashes. They warn and never block: a shoot can go ahead with a camera
 *      somebody else has booked, it just should not happen by accident.
 *   3. Telling the people an event is about — email at once, and one bell row
 *      per event that always carries the latest change. Never the person who
 *      made the change; they know.
 *   4. The morning-of bell, EVENT_TODAY, kept in step with the event.
 */

export const MAX_EVENT_DAYS = 31;

/** Gear that cannot go on a shoot: it is gone, one way or another. */
export const UNPICKABLE: AssetStatus[] = [AssetStatus.RETIRED, AssetStatus.SOLD, AssetStatus.LOST];

// ── Times ────────────────────────────────────────────────────────────────────

const LOCAL = /^(\d{4}-\d{2}-\d{2})(?:T(([01]\d|2[0-3]):[0-5]\d))?$/;

/**
 * The window a form describes, as moments.
 *
 * `startsAt` / `endsAt` arrive as the studio's wall clock — "2026-10-09T10:00"
 * — and for an all-day event as days, the end being the LAST day, inclusive.
 * Stored, an all-day event runs from the studio's midnight on its first day to
 * the midnight after its last. Returns the reason when it is not a window.
 */
export function windowFrom(
  startsAt: string,
  endsAt: string,
  allDay: boolean,
  timezone: string,
): { start: Date; end: Date } | { error: string } {
  const s = LOCAL.exec(startsAt);
  const e = LOCAL.exec(endsAt);
  if (!s || !e) return { error: 'Give the start and end as a date, and a time unless it is all day.' };
  let start: Date;
  let end: Date;
  if (allDay) {
    start = dayStartUtc(s[1], timezone);
    end = dayStartUtc(addDays(e[1], 1), timezone);
  } else {
    if (!s[2] || !e[2]) return { error: 'Give a start and end time, or make it all day.' };
    start = zonedToUtc(s[1], s[2], timezone);
    end = zonedToUtc(e[1], e[2], timezone);
  }
  if (end <= start) return { error: 'The end has to be after the start.' };
  if (end.getTime() - start.getTime() > MAX_EVENT_DAYS * 86_400_000) {
    return { error: `An event can be at most ${MAX_EVENT_DAYS} days long.` };
  }
  return { start, end };
}

/** An event's window as the form shows it — the inverse of windowFrom. */
export function localWindow(ev: { startsAt: Date; endsAt: Date; allDay: boolean }, timezone: string) {
  const s = localDayAndTime(ev.startsAt, timezone);
  if (ev.allDay) {
    const last = localDayAndTime(new Date(ev.endsAt.getTime() - 1), timezone);
    return { startsAt: s.date, endsAt: last.date };
  }
  const e = localDayAndTime(ev.endsAt, timezone);
  return { startsAt: `${s.date}T${s.time}`, endsAt: `${e.date}T${e.time}` };
}

// ── Clashes ──────────────────────────────────────────────────────────────────

export type Clash = {
  kind: 'reserved' | 'out' | 'assigned' | 'repair' | 'person';
  /** What it is about: "EL/CAM/001 Sony A7 IV", or a person's name. */
  subject: string;
  message: string;
  assetId?: string;
  userId?: string;
};

/**
 * Everything that might get in the way of a window, for the gear and people
 * named. Nothing is saved, and nothing here refuses — these are warnings.
 *
 *   · the gear is reserved for another event that overlaps;
 *   · it is out on a booking and due back after this starts, or overdue;
 *   · it is with somebody long-term;
 *   · it is in repair;
 *   · a person is on another event that overlaps;
 *   · a person is busy in their Google Calendar — the title only for the
 *     person whose calendar it is (`viewerId`), never for anybody else.
 */
export async function findClashes(opts: {
  organizationId: string;
  start: Date;
  end: Date;
  assetIds: string[];
  attendeeIds: string[];
  excludeEventId?: string | null;
  timezone: string;
  now?: Date;
  /** Who is looking: their own Google titles are shown to them, nobody else's. */
  viewerId?: string;
}): Promise<Clash[]> {
  const { organizationId, start, end, assetIds, attendeeIds, excludeEventId, timezone, viewerId } = opts;
  const now = opts.now ?? new Date();
  const notThis = excludeEventId ? { not: excludeEventId } : undefined;

  const [assets, reservations, busy] = await Promise.all([
    assetIds.length
      ? prisma.asset.findMany({
          where: { id: { in: assetIds }, organizationId },
          select: {
            id: true,
            tag: true,
            name: true,
            status: true,
            currentHolder: { select: { name: true } },
            movements: {
              where: { returnedAt: null },
              orderBy: { outAt: 'desc' },
              take: 1,
              select: { dueAt: true, user: { select: { name: true } } },
            },
          },
        })
      : [],
    assetIds.length
      ? prisma.assetReservation.findMany({
          where: {
            organizationId,
            assetId: { in: assetIds },
            startsAt: { lt: end },
            endsAt: { gt: start },
            ...(notThis ? { eventId: notThis } : {}),
            event: { deletedAt: null },
          },
          select: { assetId: true, event: { select: { title: true, startsAt: true, endsAt: true, allDay: true } } },
        })
      : [],
    attendeeIds.length
      ? prisma.calendarEventAttendee.findMany({
          where: {
            userId: { in: attendeeIds },
            event: {
              organizationId,
              deletedAt: null,
              startsAt: { lt: end },
              endsAt: { gt: start },
              ...(notThis ? { id: notThis } : {}),
            },
          },
          select: {
            userId: true,
            user: { select: { name: true } },
            event: { select: { title: true, startsAt: true, endsAt: true, allDay: true } },
          },
        })
      : [],
  ]);

  // Google busy time, when the organisation has switched the connection on.
  const googleOn =
    attendeeIds.length > 0 &&
    googleConfigured() &&
    Boolean((await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarEnabled: true } }))?.googleCalendarEnabled);
  const googleBusy = googleOn
    ? await prisma.externalBusyBlock.findMany({
        where: { organizationId, userId: { in: attendeeIds }, startsAt: { lt: end }, endsAt: { gt: start } },
        orderBy: { startsAt: 'asc' },
        select: { userId: true, title: true, startsAt: true, endsAt: true, allDay: true, user: { select: { name: true } } },
      })
    : [];

  const startDay = localDayAndTime(start, timezone).date;
  /** "11:00–12:00" on the same day, the day too when it is another. */
  const when = (ev: { startsAt: Date; endsAt: Date; allDay: boolean }) =>
    !ev.allDay && localDayAndTime(ev.startsAt, timezone).date === startDay
      ? hoursLabel(ev.startsAt, ev.endsAt, timezone)
      : whenLabel(ev.startsAt, ev.endsAt, ev.allDay, timezone);
  const label = new Map(assets.map((a) => [a.id, `${a.tag} ${a.name}`]));
  const out: Clash[] = [];

  for (const r of reservations) {
    out.push({
      kind: 'reserved',
      assetId: r.assetId,
      subject: label.get(r.assetId) ?? 'That item',
      message: `Reserved for ${r.event.title}, ${when(r.event)}`,
    });
  }
  for (const a of assets) {
    const subject = `${a.tag} ${a.name}`;
    if (a.status === AssetStatus.BOOKED_OUT) {
      const m = a.movements[0];
      const who = m?.user.name ?? a.currentHolder?.name ?? 'somebody';
      if (!m?.dueAt) out.push({ kind: 'out', assetId: a.id, subject, message: `Out with ${who}` });
      else if (m.dueAt < now) {
        out.push({ kind: 'out', assetId: a.id, subject, message: `Out with ${who}, was due back ${whenDay(m.dueAt, timezone)}` });
      } else if (m.dueAt > start) {
        out.push({ kind: 'out', assetId: a.id, subject, message: `Out with ${who}, due back ${whenDay(m.dueAt, timezone)}` });
      }
    } else if (a.status === AssetStatus.ASSIGNED) {
      out.push({
        kind: 'assigned',
        assetId: a.id,
        subject,
        message: `Held by ${a.currentHolder?.name ?? 'somebody'} — check with them`,
      });
    } else if (a.status === AssetStatus.IN_REPAIR) {
      out.push({ kind: 'repair', assetId: a.id, subject, message: 'In repair' });
    }
  }
  for (const b of busy) {
    out.push({
      kind: 'person',
      userId: b.userId,
      subject: b.user.name,
      message: `${b.user.name} is on ${b.event.title} ${when(b.event)}`,
    });
  }
  for (const g of googleBusy) {
    const own = viewerId === g.userId && g.title;
    out.push({
      kind: 'person',
      userId: g.userId,
      subject: g.user.name,
      message: `${g.user.name} is busy (Google Calendar) ${when(g)}${own ? ` — ${g.title}` : ''}`,
    });
  }
  return out;
}

/** "Sat 10 Oct" — a due-back day, which is all anybody needs of it. */
const whenDay = (d: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(d);

// ── Telling people ───────────────────────────────────────────────────────────

/** What an event looked like, enough to say what changed about it. */
export type EventSnapshot = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  createdBy: { id: string; name: string };
  attendeeIds: string[];
};

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
export const eventLink = (id: string) => `/calendar?event=${id}`;
const placeOf = (s: EventSnapshot) => (s.location ? `, ${s.location}` : '');
const bookedBy = (s: EventSnapshot) => `Booked by ${s.createdBy.name}`;

/** Best effort: mail that cannot go is logged, and the save stands. */
async function mailPeople(
  organizationId: string,
  userIds: string[],
  subject: string,
  sentence: string,
  snapshot: EventSnapshot,
): Promise<void> {
  if (userIds.length === 0) return;
  await pushCalendarChange(organizationId, userIds, snapshot.id, subject, sentence, eventLink(snapshot.id));
  const people = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId, active: true },
    select: { id: true, name: true, email: true },
  });
  const link = `${appUrl()}${eventLink(snapshot.id)}`;
  for (const p of people) {
    try {
      await sendMail(organizationId, {
        to: p.email,
        subject,
        html: `<p>Hello ${p.name.split(' ')[0]},</p><p>${sentence}</p><p style="color:#6d7f79">${bookedBy(snapshot)}</p><p><a href="${link}">Open it in Flowzen</a></p>`,
        text: `${sentence}\n${bookedBy(snapshot)}\n${link}`,
      });
    } catch (e) {
      logger.warn(`Calendar mail to ${p.email} not sent: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/**
 * The bell row for an event: one per event, always the latest change.
 *
 * The previous one is resolved and a new one raised, so a change shows as
 * unread again. Whoever made the change has it marked read for them, and so
 * does anybody it is not news to (`alreadyKnow`).
 */
async function replaceUpdateAlert(
  organizationId: string,
  eventId: string,
  message: string,
  alreadyKnow: string[],
): Promise<void> {
  await prisma.alert.updateMany({
    where: { organizationId, rule: 'EVENT_UPDATE', entityType: 'CalendarEvent', entityId: eventId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  const alert = await prisma.alert.create({
    // MED, not LOW: the bell shows the worst fifty first, and being booked is
    // something a person has to see.
    data: { organizationId, rule: 'EVENT_UPDATE', severity: AlertSeverity.MED, entityType: 'CalendarEvent', entityId: eventId, message },
  });
  const readers = [...new Set(alreadyKnow)];
  if (readers.length) {
    await prisma.alertRead.createMany({ data: readers.map((userId) => ({ alertId: alert.id, userId })), skipDuplicates: true });
  }
}

/**
 * After a save has committed: who to tell, what to say, and the record of it.
 *
 * `before` is null for a new event; `after` is null when it was deleted. Only
 * the people a change is ABOUT hear of it, never the person who made it —
 * booking a meeting for somebody else is normal, and the booker knows.
 *
 * Changing only the title, notes, gear or client tells nobody.
 */
export async function afterEventSaved(opts: {
  organizationId: string;
  actor: { id: string; name: string };
  before: EventSnapshot | null;
  after: EventSnapshot | null;
  timezone: string;
  /** For the Activity row: which plain fields changed. */
  changedFields?: Record<string, { from: unknown; to: unknown }>;
}): Promise<void> {
  const { organizationId, actor, before, after, timezone } = opts;
  const notMe = (ids: string[]) => ids.filter((id) => id !== actor.id);
  const when = (s: EventSnapshot) => whenLabel(s.startsAt, s.endsAt, s.allDay, timezone);
  const log = (verb: string, payload: Record<string, unknown>) =>
    prisma.activity.create({
      data: { organizationId, entityType: 'CalendarEvent', entityId: (after ?? before)!.id, actorId: actor.id, verb, payload: payload as Prisma.InputJsonValue },
    });

  try {
    // ── Booked ──
    if (!before && after) {
      const told = notMe(after.attendeeIds);
      await mailPeople(organizationId, told, `${actor.name} booked you: ${after.title}`, `${actor.name} booked you: ${after.title}, ${when(after)}${placeOf(after)}.`, after);
      if (after.attendeeIds.length) {
        await replaceUpdateAlert(organizationId, after.id, `Booked: ${after.title}, ${when(after)}${placeOf(after)} · ${bookedBy(after)}`, [actor.id]);
      }
      await log('event_created', { title: after.title, when: when(after), attendeeIds: after.attendeeIds });
      return;
    }

    // ── Cancelled ──
    if (before && !after) {
      const told = notMe(before.attendeeIds);
      await mailPeople(
        organizationId,
        told,
        `${actor.name} cancelled ${before.title}`,
        `${actor.name} cancelled ${before.title} (${when(before)}).`,
        before,
      );
      if (before.attendeeIds.length) {
        await replaceUpdateAlert(organizationId, before.id, `Cancelled: ${before.title}, ${when(before)} · ${bookedBy(before)}`, [actor.id]);
      }
      await log('event_deleted', { title: before.title, when: when(before) });
      return;
    }

    if (!before || !after) return;

    // ── Changed ──
    const added = after.attendeeIds.filter((id) => !before.attendeeIds.includes(id));
    const removed = before.attendeeIds.filter((id) => !after.attendeeIds.includes(id));
    const stayed = after.attendeeIds.filter((id) => before.attendeeIds.includes(id));
    const moved =
      before.startsAt.getTime() !== after.startsAt.getTime() ||
      before.endsAt.getTime() !== after.endsAt.getTime() ||
      before.allDay !== after.allDay;
    const placeChanged = (before.location ?? '') !== (after.location ?? '');

    await mailPeople(organizationId, notMe(added), `${actor.name} booked you: ${after.title}`, `${actor.name} booked you: ${after.title}, ${when(after)}${placeOf(after)}.`, after);
    await mailPeople(organizationId, notMe(removed), `${actor.name} removed you from ${after.title}`, `${actor.name} removed you from ${after.title} (${when(before)}).`, after);
    if (moved || placeChanged) {
      const sentence = moved
        ? `${actor.name} moved ${after.title} to ${when(after)}${placeOf(after)}.`
        : `${actor.name} changed the place of ${after.title} to ${after.location || 'nowhere in particular'} (${when(after)}).`;
      await mailPeople(organizationId, notMe(stayed), `${actor.name} ${moved ? 'moved' : 'changed'} ${after.title}`, sentence, after);
    }

    if (moved || placeChanged) {
      await replaceUpdateAlert(
        organizationId,
        after.id,
        `${moved ? 'Moved to' : 'Now at'} ${moved ? when(after) : after.location || 'no set place'}${moved ? placeOf(after) : ''} · ${after.title} · ${bookedBy(after)}`,
        [actor.id],
      );
    } else if (added.length) {
      // Only the newcomers need to see it again; the rest already knew.
      await replaceUpdateAlert(organizationId, after.id, `Booked: ${after.title}, ${when(after)}${placeOf(after)} · ${bookedBy(after)}`, [
        actor.id,
        ...stayed,
      ]);
    }

    if (moved) await log('event_moved', { title: after.title, from: when(before), to: when(after) });
    if (added.length || removed.length) await log('event_people_changed', { title: after.title, added, removed });
    const plain = opts.changedFields ?? {};
    if (Object.keys(plain).length) await log('event_edited', { title: after.title, changed: plain });
  } catch (e) {
    // The event is saved; telling people about it must never undo that.
    logger.error(`Calendar follow-up for ${(after ?? before)?.id} failed: ${e instanceof Error ? e.message : e}`);
  }
}

// ── The morning-of bell ──────────────────────────────────────────────────────

type TodayEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  deletedAt: Date | null;
  createdBy: { name: string };
  _count?: { attendees: number };
};

/** "Today 10:00–13:00 · Acme shoot · Studio B · Booked by Priya". */
export function todayMessage(ev: TodayEvent, today: string, timezone: string): string {
  const t0 = dayStartUtc(today, timezone);
  const t1 = dayStartUtc(addDays(today, 1), timezone);
  let hours = '';
  if (!ev.allDay) {
    const startsToday = ev.startsAt >= t0;
    const endsToday = ev.endsAt <= t1;
    const s = localDayAndTime(ev.startsAt, timezone).time;
    const e = localDayAndTime(ev.endsAt, timezone).time;
    hours = startsToday && endsToday ? ` ${s}–${e}` : startsToday ? ` from ${s}` : endsToday ? ` until ${e}` : '';
  }
  return [`Today${hours}`, ev.title, ev.location, `Booked by ${ev.createdBy.name}`].filter(Boolean).join(' · ');
}

/** Is it on today and not over yet? */
export const happeningToday = (ev: TodayEvent, today: string, timezone: string, now: Date) =>
  !ev.deletedAt &&
  ev.startsAt < dayStartUtc(addDays(today, 1), timezone) &&
  ev.endsAt > dayStartUtc(today, timezone) &&
  ev.endsAt > now;

/**
 * Bring one event's EVENT_TODAY alert into line with the event: raised if it
 * is on today, its words updated if it moved within today, resolved if it is
 * over, gone or moved off today. One alert per event per day — yesterday's is
 * resolved, not reused, so a two-day shoot rings each morning.
 */
export async function syncTodayAlert(
  organizationId: string,
  ev: TodayEvent & { attendeeCount: number },
  timezone: string,
  now: Date = new Date(),
): Promise<'created' | 'updated' | 'resolved' | 'unchanged'> {
  const today = localDayAndTime(now, timezone).date;
  const t0 = dayStartUtc(today, timezone);
  const open = await prisma.alert.findMany({
    where: { organizationId, rule: 'EVENT_TODAY', entityType: 'CalendarEvent', entityId: ev.id, resolvedAt: null },
    select: { id: true, message: true, raisedAt: true },
  });
  const on = happeningToday(ev, today, timezone, now) && ev.attendeeCount > 0;
  const current = on ? open.find((a) => a.raisedAt >= t0) : undefined;
  const stale = open.filter((a) => a !== current);
  if (stale.length) {
    await prisma.alert.updateMany({ where: { id: { in: stale.map((a) => a.id) } }, data: { resolvedAt: now } });
  }
  if (!on) return stale.length ? 'resolved' : 'unchanged';

  const message = todayMessage(ev, today, timezone);
  if (current) {
    if (current.message === message) return 'unchanged';
    await prisma.alert.update({ where: { id: current.id }, data: { message } });
    return 'updated';
  }
  await prisma.alert.create({
    data: { organizationId, rule: 'EVENT_TODAY', severity: AlertSeverity.MED, entityType: 'CalendarEvent', entityId: ev.id, message, raisedAt: now },
  });
  return 'created';
}

/** The fields syncTodayAlert reads, as a Prisma select. */
export const TODAY_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  location: true,
  deletedAt: true,
  createdBy: { select: { name: true } },
  _count: { select: { attendees: true } },
} satisfies Prisma.CalendarEventSelect;

/** After a save: the event's morning bell, straight away if it is today. */
export async function syncTodayAlertFor(organizationId: string, eventId: string, timezone: string, now = new Date()) {
  const ev = await prisma.calendarEvent.findFirst({
    // A deleted event is still read, so its bell can be resolved.
    where: { id: eventId, organizationId, deletedAt: undefined },
    select: TODAY_SELECT,
  });
  if (!ev) return;
  await syncTodayAlert(organizationId, { ...ev, attendeeCount: ev._count.attendees }, timezone, now);
}
