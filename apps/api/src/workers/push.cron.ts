import webpush from 'web-push';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { BELL_URL, pushConfigured } from '../services/push.js';

/**
 * Sends the phone notifications that are due (services/push.ts queues them).
 *
 * Every minute, per person:
 *
 *   · more than HOLD_SUMMARY_OVER held overnight (or over a weekend) become
 *     one summary — "You have 6 updates in Flowzen" — not six buzzes at ten;
 *   · at most CAP_PER_HOUR pushes an hour; anything over folds into the
 *     summary, and with no room left at all it waits for the hour to roll on;
 *   · each push goes to every device the person turned on. A push service
 *     answering 404 or 410 means that device is gone, so its subscription is
 *     deleted; any other failure is tried again, up to MAX_ATTEMPTS.
 *
 * A row is finished when `sentAt` is set. `lastError` says why it did not go
 * as itself (folded, no devices, switched off, gave up) and is null for a
 * clean send — which is what the hourly cap counts.
 */

export const CAP_PER_HOUR = 20;
export const HOLD_SUMMARY_OVER = 3;
export const MAX_ATTEMPTS = 3;
/** Queued more than this before it was due means it was held for working hours. */
const HELD_MS = 60_000;
const BATCH = 500;

type Row = {
  id: string;
  organizationId: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  dueAt: Date;
  createdAt: Date;
  attempts: number;
  organization: { pushEnabled: boolean };
};

type Device = { id: string; endpoint: string; p256dh: string; auth: string };

/** The one call that leaves the building. A parameter so a test can stand in for it. */
export type Deliver = (device: Device, payload: string) => Promise<unknown>;

let vapidSet = false;
const webPushDeliver: Deliver = (device, payload) => {
  if (!vapidSet) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!.trim(),
      process.env.VAPID_PUBLIC_KEY!.trim(),
      process.env.VAPID_PRIVATE_KEY!.trim(),
    );
    vapidSet = true;
  }
  return webpush.sendNotification(
    { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
    payload,
    // Half a day: a phone that is off overnight still gets it in the morning,
    // and nothing from yesterday arrives the day after.
    { TTL: 12 * 3600 },
  );
};

const finish = (ids: string[], now: Date, lastError: string | null) =>
  ids.length ? prisma.pushOutbox.updateMany({ where: { id: { in: ids } }, data: { sentAt: now, lastError } }) : null;

/**
 * One row to every device. Devices that are gone are deleted and dropped from
 * `devices`, so the person's next row does not try them again.
 */
async function deliverRow(row: Pick<Row, 'id' | 'title' | 'body' | 'url' | 'attempts'>, devices: Device[], now: Date, deliver: Deliver) {
  const payload = JSON.stringify({ title: row.title, body: row.body, url: row.url, tag: row.id });
  let delivered = 0;
  let problem: string | null = null;

  for (const device of [...devices]) {
    try {
      await deliver(device, payload);
      delivered++;
      await prisma.pushSubscription.updateMany({ where: { id: device.id }, data: { lastUsedAt: now, failedCount: 0 } });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.deleteMany({ where: { id: device.id } });
        devices.splice(devices.indexOf(device), 1);
      } else {
        problem = `${status ?? ''} ${e instanceof Error ? e.message : String(e)}`.trim().slice(0, 300);
        await prisma.pushSubscription.updateMany({ where: { id: device.id }, data: { failedCount: { increment: 1 } } });
      }
    }
  }

  const attempts = row.attempts + 1;
  if (delivered > 0) {
    await prisma.pushOutbox.update({ where: { id: row.id }, data: { sentAt: now, attempts, lastError: null } });
    return 'sent' as const;
  }
  if (!problem) {
    await prisma.pushOutbox.update({ where: { id: row.id }, data: { sentAt: now, attempts, lastError: 'No devices' } });
    return 'gone' as const;
  }
  if (attempts >= MAX_ATTEMPTS) {
    await prisma.pushOutbox.update({ where: { id: row.id }, data: { sentAt: now, attempts, lastError: `Gave up: ${problem}` } });
    return 'failed' as const;
  }
  // Again in five minutes, then ten.
  await prisma.pushOutbox.update({
    where: { id: row.id },
    data: { attempts, lastError: problem, dueAt: new Date(now.getTime() + attempts * 5 * 60_000) },
  });
  return 'retry' as const;
}

/**
 * Split one person's due rows into what goes as itself and what folds into a
 * summary. Pure, so the rules can be tested without a database.
 */
export function plan(rows: Pick<Row, 'id' | 'kind' | 'dueAt' | 'createdAt' | 'attempts'>[], sentLastHour: number) {
  const room = Math.max(0, CAP_PER_HOUR - sentLastHour);
  if (room === 0) return { send: [] as string[], fold: [] as string[] };

  const isHeld = (r: (typeof rows)[number]) =>
    r.attempts === 0 && r.kind !== 'TEST' && r.dueAt.getTime() - r.createdAt.getTime() > HELD_MS;
  const held = rows.filter(isHeld);
  const folding = held.length > HOLD_SUMMARY_OVER;
  let fold = folding ? held : [];
  // A test first: it is what the person is holding the phone waiting for.
  let send = (folding ? rows.filter((r) => !isHeld(r)) : rows).slice().sort((a, b) => Number(b.kind === 'TEST') - Number(a.kind === 'TEST'));

  if (send.length + (fold.length ? 1 : 0) > room) {
    const keep = Math.max(0, room - 1);
    fold = [...fold, ...send.slice(keep)];
    send = send.slice(0, keep);
  }
  // A summary of one is just that one.
  if (fold.length === 1) {
    send = [...send, fold[0]];
    fold = [];
  }
  return { send: send.map((r) => r.id), fold: fold.map((r) => r.id) };
}

let running = false;

/** One pass over everything due. Safe to call at any time; overlapping calls skip. */
export async function runPushWorker(
  now: Date = new Date(),
  deliver: Deliver = webPushDeliver,
): Promise<{ sent: number; summaries: number; folded: number; dropped: number; retried: number }> {
  const tally = { sent: 0, summaries: 0, folded: 0, dropped: 0, retried: 0 };
  if (!pushConfigured() || running) return tally;
  running = true;
  try {
    const due: Row[] = await prisma.pushOutbox.findMany({
      where: { sentAt: null, dueAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: {
        id: true,
        organizationId: true,
        userId: true,
        kind: true,
        title: true,
        body: true,
        url: true,
        dueAt: true,
        createdAt: true,
        attempts: true,
        organization: { select: { pushEnabled: true } },
      },
    });

    const byPerson = new Map<string, Row[]>();
    for (const r of due) byPerson.set(r.userId, [...(byPerson.get(r.userId) ?? []), r]);

    for (const [userId, rows] of byPerson) {
      try {
        // Switched off since it was queued: nothing is sent, and nothing piles
        // up to arrive all at once if it is switched back on.
        if (!rows[0].organization.pushEnabled) {
          await finish(rows.map((r) => r.id), now, 'Phone notifications are switched off');
          tally.dropped += rows.length;
          continue;
        }
        const devices: Device[] = await prisma.pushSubscription.findMany({
          where: { userId },
          select: { id: true, endpoint: true, p256dh: true, auth: true },
        });
        if (devices.length === 0) {
          await finish(rows.map((r) => r.id), now, 'No devices');
          tally.dropped += rows.length;
          continue;
        }

        const sentLastHour = await prisma.pushOutbox.count({
          where: { userId, sentAt: { gte: new Date(now.getTime() - 3600_000) }, lastError: null },
        });
        const { send, fold } = plan(rows, sentLastHour);
        const byId = new Map(rows.map((r) => [r.id, r]));

        for (const id of send) {
          if (devices.length === 0) break;
          const outcome = await deliverRow(byId.get(id)!, devices, now, deliver);
          if (outcome === 'sent') tally.sent++;
          else if (outcome === 'retry') tally.retried++;
          else tally.dropped++;
        }

        if (fold.length > 0 && devices.length > 0) {
          await finish(fold, now, 'In a summary');
          tally.folded += fold.length;
          const summary = await prisma.pushOutbox.create({
            data: {
              organizationId: rows[0].organizationId,
              userId,
              kind: 'SUMMARY',
              sourceKey: `summary:${now.getTime()}`,
              title: 'Flowzen',
              body: `You have ${fold.length} updates in Flowzen`,
              url: BELL_URL,
              dueAt: now,
            },
          });
          const outcome = await deliverRow(summary, devices, now, deliver);
          if (outcome === 'sent') tally.summaries++;
        }

        // Every device went while sending: what is left has nowhere to go.
        if (devices.length === 0) {
          await prisma.pushOutbox.updateMany({
            where: { id: { in: rows.map((r) => r.id) }, sentAt: null },
            data: { sentAt: now, lastError: 'No devices' },
          });
        }
      } catch (e) {
        logger.error(`Push sending for ${userId} failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // A month of history is plenty to answer "did it go?".
    if (now.getUTCMinutes() === 0) {
      await prisma.pushOutbox.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
    }
  } finally {
    running = false;
  }
  return tally;
}

/** Every minute. Nothing in tests, and nothing without the keys. */
export function startPushWorker(intervalMs = 60_000) {
  if (process.env.NODE_ENV === 'test' || !pushConfigured()) return;
  setInterval(() => {
    runPushWorker().catch((e) => logger.error(`Push worker error: ${e}`));
  }, intervalMs);
}
