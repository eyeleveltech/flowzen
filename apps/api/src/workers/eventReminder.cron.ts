import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { addDays } from '../utils/workCalendar.js';
import { dayStartUtc, localDayAndTime } from '../utils/zonedTime.js';
import { eventLink, happeningToday, syncTodayAlert, todayMessage, TODAY_SELECT } from '../services/calendarEvents.js';
import { pushEventToday } from '../services/push.js';

/**
 * The morning-of bell for meetings and shoots, and the tidying of event alerts.
 *
 * Every 30 minutes, per organisation, on the studio's own calendar day:
 *
 *   · each event on today and not yet over gets one EVENT_TODAY alert — the
 *     first tick after midnight raises it, every later tick finds it there, so
 *     it is once a day however often this runs; the 08:00 digest then mails it
 *     to the people on the event, because they are its audience;
 *   · an EVENT_TODAY alert whose event has ended, been deleted or moved off
 *     today is resolved;
 *   · an EVENT_UPDATE alert ("Booked", "Moved to …") resolves when its event
 *     ends — or, for a cancelled one, once its original start has passed, so
 *     the cancellation is still there to read on the morning it would have been.
 *
 * Both rules are in EXTERNAL_RULES, so the hourly scanner leaves them alone.
 * A save that puts an event onto today does not wait for this: the route calls
 * syncTodayAlert itself.
 */
export async function runEventReminders(
  now: Date = new Date(),
): Promise<{ created: number; updated: number; resolved: number }> {
  const tally = { created: 0, updated: 0, resolved: 0 };
  const orgs = await prisma.organization.findMany({ select: { id: true, timezone: true } });

  for (const org of orgs) {
    const timezone = org.timezone || 'Asia/Kolkata';
    const today = localDayAndTime(now, timezone).date;
    const tomorrow = dayStartUtc(addDays(today, 1), timezone);

    // ── Today's ──
    const events = await prisma.calendarEvent.findMany({
      where: { organizationId: org.id, deletedAt: null, startsAt: { lt: tomorrow }, endsAt: { gt: now } },
      select: TODAY_SELECT,
    });
    const live = new Set<string>();
    for (const ev of events) {
      if (happeningToday(ev, today, timezone, now)) live.add(ev.id);
      const result = await syncTodayAlert(org.id, { ...ev, attendeeCount: ev._count.attendees }, timezone, now);
      if (result === 'created') tally.created++;
      if (result === 'created') await pushEventToday(org.id, ev, today, todayMessage(ev, today, timezone), eventLink(ev.id));
      if (result === 'updated') tally.updated++;
      if (result === 'resolved') tally.resolved++;
    }

    // Anything still open for an event that is no longer on today.
    const leftover = await prisma.alert.findMany({
      where: { organizationId: org.id, rule: 'EVENT_TODAY', resolvedAt: null, entityId: { notIn: [...live] } },
      select: { id: true },
    });
    if (leftover.length) {
      await prisma.alert.updateMany({ where: { id: { in: leftover.map((a) => a.id) } }, data: { resolvedAt: now } });
      tally.resolved += leftover.length;
    }

    // ── "Booked / moved / cancelled" ──
    const updates = await prisma.alert.findMany({
      where: { organizationId: org.id, rule: 'EVENT_UPDATE', resolvedAt: null },
      select: { id: true, entityId: true },
    });
    if (updates.length) {
      const about = await prisma.calendarEvent.findMany({
        // Cancelled ones too: they decide when their alert goes.
        where: { id: { in: updates.map((a) => a.entityId) }, deletedAt: undefined },
        select: { id: true, startsAt: true, endsAt: true, deletedAt: true },
      });
      const byId = new Map(about.map((e) => [e.id, e]));
      const done = updates.filter((a) => {
        const ev = byId.get(a.entityId);
        if (!ev) return true;
        return ev.deletedAt ? ev.startsAt <= now : ev.endsAt <= now;
      });
      if (done.length) {
        await prisma.alert.updateMany({ where: { id: { in: done.map((a) => a.id) } }, data: { resolvedAt: now } });
        tally.resolved += done.length;
      }
    }
  }
  return tally;
}

/** Every 30 minutes, and once at start. Nothing in tests. */
export function startEventReminders(intervalMs = 30 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test') return;
  runEventReminders().catch((e) => logger.error(`Initial event reminder error: ${e}`));
  setInterval(() => {
    runEventReminders().catch((e) => logger.error(`Periodic event reminder error: ${e}`));
  }, intervalMs);
}
