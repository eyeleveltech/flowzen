import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { calendar as calendarApi, type calendar_v3 } from '@googleapis/calendar';
import { GoogleConnectionStatus, GooglePushState, type GoogleCalendarConnection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decryptSecret } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { dayStartUtc, localDayAndTime } from '../utils/zonedTime.js';

/**
 * Google Calendar, optional and per person.
 *
 * Two directions, never crossing:
 *
 *   · Google → Flowzen: the person's PRIMARY calendar is read as busy time
 *     (ExternalBusyBlock). Titles are kept for the owner's eyes only; the
 *     routes strip them for everybody else.
 *   · Flowzen → Google: meetings and shoots the person is on are written to a
 *     "Flowzen" calendar Flowzen made in their account — and only there. That
 *     calendar is never read back, so nothing loops and nothing doubles.
 *
 * Google failing never stops Flowzen: pushes wait in GoogleEventLink (the
 * queue) and are retried; a token Google no longer accepts marks the
 * connection NEEDS_RECONNECT and the person is asked to connect again.
 *
 * Every call to Google goes through `GoogleApi` below, so the sync and the
 * queue can be tested with Google replaced.
 */

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];

/** The keys are in the server's environment. Without them, nothing here runs. */
export const googleConfigured = (): boolean =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);

export const oauthClient = () =>
  new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

/** How far busy time is read: a week back, two months ahead. */
const BACK_DAYS = 7;
const AHEAD_DAYS = 60;
/** Pushes give up after this many tries, keeping the last error. */
export const MAX_PUSH_ATTEMPTS = 5;

// ── The OAuth state ──────────────────────────────────────────────────────────

const signState = (body: string) =>
  createHmac('sha256', process.env.JWT_SECRET ?? '').update(`google-state:${body}`).digest('base64url');

/**
 * The `state` sent to Google: who started this, signed, good for ten minutes.
 * The callback only accepts it from the same signed-in person — so a code
 * from somebody else's consent cannot be planted on this session (CSRF).
 */
export function makeState(userId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, n: randomBytes(8).toString('hex'), e: now + 10 * 60_000 })).toString('base64url');
  return `${body}.${signState(body)}`;
}

export function stateIsFor(state: string | undefined, userId: string, now = Date.now()): boolean {
  if (!state) return false;
  const [body, sig] = state.split('.');
  if (!body || !sig) return false;
  const expected = Buffer.from(signState(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { u, e } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u: string; e: number };
    return u === userId && e > now;
  } catch {
    return false;
  }
}

// ── Talking to Google ────────────────────────────────────────────────────────

export type GoogleEvent = calendar_v3.Schema$Event;
type Conn = Pick<GoogleCalendarConnection, 'refreshTokenEncrypted'>;

/** Every call this feature makes to Google, in one place. */
export type GoogleApi = {
  exchangeCode(code: string): Promise<{ refreshToken: string | null; email: string | null }>;
  listEvents(
    conn: Conn,
    q: { syncToken?: string; timeMin?: string; timeMax?: string; pageToken?: string },
  ): Promise<{ items: GoogleEvent[]; nextPageToken?: string | null; nextSyncToken?: string | null }>;
  createCalendar(conn: Conn, timezone: string): Promise<string>;
  deleteCalendar(conn: Conn, calendarId: string): Promise<void>;
  insertEvent(conn: Conn, calendarId: string, body: GoogleEvent): Promise<string>;
  updateEvent(conn: Conn, calendarId: string, eventId: string, body: GoogleEvent): Promise<void>;
  deleteEvent(conn: Conn, calendarId: string, eventId: string): Promise<void>;
  revoke(conn: Conn): Promise<void>;
};

const clientFor = (conn: Conn) => {
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: decryptSecret(conn.refreshTokenEncrypted) });
  return { auth, cal: calendarApi({ version: 'v3', auth, timeout: 15_000 }) };
};

const realGoogle: GoogleApi = {
  async exchangeCode(code) {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    let email: string | null = null;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
      email = ticket.getPayload()?.email ?? null;
    }
    return { refreshToken: tokens.refresh_token ?? null, email };
  },
  async listEvents(conn, q) {
    const { cal } = clientFor(conn);
    const res = await cal.events.list({
      calendarId: 'primary',
      singleEvents: true,
      maxResults: 250,
      ...(q.syncToken ? { syncToken: q.syncToken } : { timeMin: q.timeMin, timeMax: q.timeMax }),
      ...(q.pageToken ? { pageToken: q.pageToken } : {}),
    });
    return { items: res.data.items ?? [], nextPageToken: res.data.nextPageToken, nextSyncToken: res.data.nextSyncToken };
  },
  async createCalendar(conn, timezone) {
    const { cal } = clientFor(conn);
    const res = await cal.calendars.insert({
      requestBody: { summary: 'Flowzen', description: 'Meetings and shoots from Flowzen. Edit them in Flowzen.', timeZone: timezone },
    });
    return res.data.id!;
  },
  async deleteCalendar(conn, calendarId) {
    const { cal } = clientFor(conn);
    await cal.calendars.delete({ calendarId });
  },
  async insertEvent(conn, calendarId, body) {
    const { cal } = clientFor(conn);
    const res = await cal.events.insert({ calendarId, requestBody: body });
    return res.data.id!;
  },
  async updateEvent(conn, calendarId, eventId, body) {
    const { cal } = clientFor(conn);
    await cal.events.update({ calendarId, eventId, requestBody: body });
  },
  async deleteEvent(conn, calendarId, eventId) {
    const { cal } = clientFor(conn);
    await cal.events.delete({ calendarId, eventId });
  },
  async revoke(conn) {
    const client = oauthClient();
    await client.revokeToken(decryptSecret(conn.refreshTokenEncrypted));
  },
};

let api: GoogleApi = realGoogle;
/** The tests' way in. */
export const setGoogleApi = (next: GoogleApi | null) => {
  api = next ?? realGoogle;
};
export const google = () => api;

/** The HTTP status of a failed Google call, when it has one. */
export function statusOf(e: unknown): number | undefined {
  const err = e as { code?: unknown; status?: unknown; response?: { status?: number } };
  const n = Number(err?.response?.status ?? err?.status ?? err?.code);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Google no longer accepts this person's token — revoked from their Google
 * account, or the Workspace took the app away. They have to connect again.
 */
export function isAuthFailure(e: unknown): boolean {
  if (statusOf(e) === 401) return true;
  const text = `${(e as { message?: string })?.message ?? ''} ${JSON.stringify((e as { response?: { data?: unknown } })?.response?.data ?? '')}`;
  return /invalid_grant|unauthorized_client|Token has been expired or revoked/i.test(text);
}

/** Something gone that we meant to remove anyway — a 404 or 410 on a delete. */
const isGone = (e: unknown) => [404, 410].includes(statusOf(e) ?? 0);

const shortError = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

async function needsReconnect(connId: string, e: unknown) {
  await prisma.googleCalendarConnection.update({
    where: { id: connId },
    data: { status: GoogleConnectionStatus.NEEDS_RECONNECT, lastError: shortError(e) },
  });
}

// ── Google → Flowzen: busy time ──────────────────────────────────────────────

/**
 * What a Google event means for busy time: a block to keep, or nothing (and
 * any block it left should go). Declined, "free" and cancelled events are not
 * busy time.
 */
export function busyFrom(
  ev: GoogleEvent,
  timezone: string,
): { title: string | null; startsAt: Date; endsAt: Date; allDay: boolean } | null {
  if (ev.status === 'cancelled') return null;
  if (ev.transparency === 'transparent') return null;
  if (ev.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  if (ev.start?.date && ev.end?.date) {
    // All day: Google's dates are calendar days, the end exclusive.
    return { title: ev.summary ?? null, startsAt: dayStartUtc(ev.start.date, timezone), endsAt: dayStartUtc(ev.end.date, timezone), allDay: true };
  }
  if (ev.start?.dateTime && ev.end?.dateTime) {
    return { title: ev.summary ?? null, startsAt: new Date(ev.start.dateTime), endsAt: new Date(ev.end.dateTime), allDay: false };
  }
  return null;
}

/**
 * Read the person's primary calendar into busy blocks.
 *
 * Incremental with Google's syncToken; a full read of the window the first
 * time, and again when Google says the token has expired (410). Throws only
 * for a reason worth recording; a refused token marks the connection
 * NEEDS_RECONNECT.
 */
export async function syncBusy(
  conn: GoogleCalendarConnection,
  timezone: string,
  now = new Date(),
): Promise<{ kept: number; removed: number; full: boolean } | 'needs_reconnect'> {
  const from = new Date(now.getTime() - BACK_DAYS * 86_400_000);
  const to = new Date(now.getTime() + AHEAD_DAYS * 86_400_000);

  const readAll = async (syncToken?: string) => {
    const items: GoogleEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null | undefined;
    do {
      const page = await google().listEvents(conn, syncToken ? { syncToken, pageToken } : { timeMin: from.toISOString(), timeMax: to.toISOString(), pageToken });
      items.push(...page.items);
      pageToken = page.nextPageToken ?? undefined;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { items, nextSyncToken };
  };

  let full = !conn.syncToken;
  let result: Awaited<ReturnType<typeof readAll>>;
  try {
    try {
      result = await readAll(conn.syncToken ?? undefined);
    } catch (e) {
      if (statusOf(e) !== 410) throw e;
      // The token has expired at Google's end: start again from the window.
      full = true;
      result = await readAll();
    }
  } catch (e) {
    if (isAuthFailure(e)) {
      await needsReconnect(conn.id, e);
      return 'needs_reconnect';
    }
    await prisma.googleCalendarConnection.update({ where: { id: conn.id }, data: { lastError: shortError(e) } });
    throw e;
  }

  let kept = 0;
  let removed = 0;
  const seen: string[] = [];
  for (const ev of result.items) {
    if (!ev.id) continue;
    const busy = busyFrom(ev, timezone);
    const inWindow = busy && busy.endsAt > from && busy.startsAt < to;
    if (!busy || !inWindow) {
      const gone = await prisma.externalBusyBlock.deleteMany({ where: { userId: conn.userId, googleEventId: ev.id } });
      removed += gone.count;
      continue;
    }
    seen.push(ev.id);
    await prisma.externalBusyBlock.upsert({
      where: { userId_googleEventId: { userId: conn.userId, googleEventId: ev.id } },
      create: { organizationId: conn.organizationId, userId: conn.userId, googleEventId: ev.id, ...busy },
      update: busy,
    });
    kept++;
  }
  // A full read is the whole truth: anything not in it is gone. And busy time
  // that has slid out of the window is let go either way.
  const stale = await prisma.externalBusyBlock.deleteMany({
    where: {
      userId: conn.userId,
      OR: [{ endsAt: { lt: from } }, ...(full ? [{ googleEventId: { notIn: seen } }] : [])],
    },
  });
  removed += stale.count;

  await prisma.googleCalendarConnection.update({
    where: { id: conn.id },
    data: { syncToken: result.nextSyncToken ?? null, lastSyncedAt: now, lastError: null, status: GoogleConnectionStatus.ACTIVE },
  });
  return { kept, removed, full };
}

// ── Flowzen → Google: the "Flowzen" calendar ─────────────────────────────────

/** A Flowzen event as Google should show it. */
export function googleBodyFor(
  ev: { id: string; title: string; startsAt: Date; endsAt: Date; allDay: boolean; location: string | null; createdBy: { name: string } },
  timezone: string,
): GoogleEvent {
  const link = `${appUrl()}/calendar?event=${ev.id}`;
  const description = `Booked by ${ev.createdBy.name} in Flowzen.\nChange it there: ${link}`;
  if (ev.allDay) {
    return {
      summary: ev.title,
      location: ev.location ?? undefined,
      description,
      start: { date: localDayAndTime(ev.startsAt, timezone).date },
      // Exclusive, as Google wants it — the midnight after the last day.
      end: { date: localDayAndTime(ev.endsAt, timezone).date },
    };
  }
  return {
    summary: ev.title,
    location: ev.location ?? undefined,
    description,
    start: { dateTime: ev.startsAt.toISOString(), timeZone: timezone },
    end: { dateTime: ev.endsAt.toISOString(), timeZone: timezone },
  };
}

/** The person's "Flowzen" calendar, made if it is missing. */
async function flowzenCalendarOf(conn: GoogleCalendarConnection, timezone: string): Promise<string> {
  if (conn.flowzenCalendarId) return conn.flowzenCalendarId;
  const id = await google().createCalendar(conn, timezone);
  await prisma.googleCalendarConnection.update({ where: { id: conn.id }, data: { flowzenCalendarId: id } });
  conn.flowzenCalendarId = id;
  return id;
}

/**
 * Push one queued change to one person's Google, once.
 *
 * Success: SYNCED (or the row goes, for a delete). A refused token: the
 * connection needs reconnecting and the row waits, uncounted. Anything else:
 * one more attempt counted with its error, and FAILED after five.
 */
export async function pushLink(linkId: string, timezone: string): Promise<'synced' | 'deleted' | 'retry' | 'failed' | 'waiting'> {
  const link = await prisma.googleEventLink.findUnique({
    where: { id: linkId },
    include: {
      event: {
        select: { id: true, title: true, startsAt: true, endsAt: true, allDay: true, location: true, deletedAt: true, createdBy: { select: { name: true } } },
      },
    },
  });
  if (!link || (link.state !== GooglePushState.PENDING_UPSERT && link.state !== GooglePushState.PENDING_DELETE)) return 'waiting';
  const conn = await prisma.googleCalendarConnection.findUnique({ where: { userId: link.userId } });
  if (!conn) {
    // Disconnected since: there is nobody's Google to write to.
    await prisma.googleEventLink.delete({ where: { id: link.id } });
    return 'deleted';
  }
  if (conn.status !== GoogleConnectionStatus.ACTIVE) return 'waiting';

  try {
    const calendarId = await flowzenCalendarOf(conn, timezone);
    if (link.state === GooglePushState.PENDING_DELETE || link.event.deletedAt) {
      if (link.googleEventId) {
        try {
          await google().deleteEvent(conn, calendarId, link.googleEventId);
        } catch (e) {
          if (!isGone(e)) throw e;
        }
      }
      await prisma.googleEventLink.delete({ where: { id: link.id } });
      return 'deleted';
    }

    const body = googleBodyFor(link.event, timezone);
    let googleEventId = link.googleEventId;
    if (googleEventId) {
      try {
        await google().updateEvent(conn, calendarId, googleEventId, body);
      } catch (e) {
        // Deleted by hand in Google: write it again.
        if (!isGone(e)) throw e;
        googleEventId = await google().insertEvent(conn, calendarId, body);
      }
    } else {
      googleEventId = await google().insertEvent(conn, calendarId, body);
    }
    await prisma.googleEventLink.update({
      where: { id: link.id },
      data: { googleEventId, state: GooglePushState.SYNCED, attempts: 0, lastError: null },
    });
    return 'synced';
  } catch (e) {
    if (isAuthFailure(e)) {
      await needsReconnect(conn.id, e);
      return 'waiting';
    }
    // Our "Flowzen" calendar is gone (deleted by hand): make a new one next time.
    if (isGone(e) && conn.flowzenCalendarId) {
      await prisma.googleCalendarConnection.update({ where: { id: conn.id }, data: { flowzenCalendarId: null } });
    }
    const attempts = link.attempts + 1;
    const failed = attempts >= MAX_PUSH_ATTEMPTS;
    await prisma.googleEventLink.update({
      where: { id: link.id },
      data: { attempts, lastError: shortError(e), ...(failed ? { state: GooglePushState.FAILED } : {}) },
    });
    logger.warn(`Google push for event ${link.eventId} to ${link.userId} failed (${attempts}/${MAX_PUSH_ATTEMPTS}): ${shortError(e)}`);
    return failed ? 'failed' : 'retry';
  }
}

/**
 * After a Flowzen event is saved or deleted: queue its change for each
 * connected person it concerns, and try each once now. Never throws — the
 * save has happened, and the queue will retry what this could not do.
 */
export async function queueEventForGoogle(opts: {
  organizationId: string;
  eventId: string;
  /** Who is on it now (none when it was deleted). */
  attendeeIds: string[];
  /** Who was taken off it, or everyone, when it was deleted. */
  removedIds: string[];
  timezone: string;
}): Promise<void> {
  const { organizationId, eventId, attendeeIds, removedIds, timezone } = opts;
  try {
    if (!googleConfigured()) return;
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarEnabled: true } });
    if (!org?.googleCalendarEnabled) return;
    const conns = await prisma.googleCalendarConnection.findMany({
      where: { organizationId, userId: { in: [...attendeeIds, ...removedIds] } },
      select: { userId: true },
    });
    const connected = new Set(conns.map((c) => c.userId));
    const touched: string[] = [];

    for (const userId of attendeeIds.filter((id) => connected.has(id))) {
      const link = await prisma.googleEventLink.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: { eventId, userId, state: GooglePushState.PENDING_UPSERT },
        update: { state: GooglePushState.PENDING_UPSERT, attempts: 0, lastError: null },
      });
      touched.push(link.id);
    }
    for (const userId of removedIds.filter((id) => connected.has(id) && !attendeeIds.includes(id))) {
      const link = await prisma.googleEventLink.findUnique({ where: { eventId_userId: { eventId, userId } } });
      if (!link) continue;
      if (!link.googleEventId) {
        // Never reached their Google: nothing to take back out.
        await prisma.googleEventLink.delete({ where: { id: link.id } });
        continue;
      }
      await prisma.googleEventLink.update({ where: { id: link.id }, data: { state: GooglePushState.PENDING_DELETE, attempts: 0, lastError: null } });
      touched.push(link.id);
    }

    for (const id of touched) {
      await pushLink(id, timezone).catch((e) => logger.warn(`Google push ${id} deferred: ${shortError(e)}`));
    }
  } catch (e) {
    logger.error(`Queueing event ${eventId} for Google failed: ${shortError(e)}`);
  }
}

/** Everything still waiting, tried once — the worker's five-minute pass. */
export async function processPushQueue(): Promise<{ synced: number; failed: number; waiting: number }> {
  const tally = { synced: 0, failed: 0, waiting: 0 };
  const pending = await prisma.googleEventLink.findMany({
    where: {
      state: { in: [GooglePushState.PENDING_UPSERT, GooglePushState.PENDING_DELETE] },
      attempts: { lt: MAX_PUSH_ATTEMPTS },
      user: { googleCalendarConnection: { status: GoogleConnectionStatus.ACTIVE, organization: { googleCalendarEnabled: true } } },
    },
    select: { id: true, user: { select: { organization: { select: { timezone: true } } } } },
    take: 200,
  });
  for (const link of pending) {
    const result = await pushLink(link.id, link.user.organization.timezone || 'Asia/Kolkata');
    if (result === 'synced' || result === 'deleted') tally.synced++;
    else if (result === 'failed') tally.failed++;
    else tally.waiting++;
  }
  return tally;
}

/** Every connected person's busy time — the worker's fifteen-minute pass. */
export async function syncAllBusy(now = new Date()): Promise<{ synced: number; failed: number }> {
  const tally = { synced: 0, failed: 0 };
  const conns = await prisma.googleCalendarConnection.findMany({
    where: { status: GoogleConnectionStatus.ACTIVE, organization: { googleCalendarEnabled: true } },
    include: { organization: { select: { timezone: true } } },
  });
  for (const conn of conns) {
    try {
      const r = await syncBusy(conn, conn.organization.timezone || 'Asia/Kolkata', now);
      if (r === 'needs_reconnect') tally.failed++;
      else tally.synced++;
    } catch (e) {
      tally.failed++;
      logger.warn(`Google busy sync for ${conn.userId} failed: ${shortError(e)}`);
    }
  }
  return tally;
}

/**
 * A freshly connected person: the meetings and shoots they are already on,
 * from now on, go into their new "Flowzen" calendar.
 */
export async function queueUpcomingFor(organizationId: string, userId: string, timezone: string, now = new Date()) {
  const events = await prisma.calendarEvent.findMany({
    where: { organizationId, deletedAt: null, endsAt: { gt: now }, attendees: { some: { userId } } },
    select: { id: true },
  });
  for (const ev of events) {
    await queueEventForGoogle({ organizationId, eventId: ev.id, attendeeIds: [userId], removedIds: [], timezone });
  }
}
