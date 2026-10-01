import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { encryptSecret } from '../utils/crypto.js';
import {
  busyFrom,
  makeState,
  MAX_PUSH_ATTEMPTS,
  pushLink,
  queueEventForGoogle,
  setGoogleApi,
  stateIsFor,
  syncBusy,
  type GoogleApi,
} from './googleCalendar.js';
import { findClashes } from './calendarEvents.js';

/**
 * Google Calendar, with Google replaced.
 *
 *   · the busy mapping: what counts as busy, and what is skipped;
 *   · the sync: incremental, a full re-read on 410, NEEDS_RECONNECT when the
 *     token is refused;
 *   · privacy: nobody but the owner is ever sent a Google title;
 *   · the push queue: states, retries, FAILED after five;
 *   · the OAuth state, and disconnecting.
 */

const TZ = 'Asia/Kolkata';
const err = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { response: { status } });

/** A Google that does what each test says, and records what it was asked. */
function fakeGoogle(over: Partial<GoogleApi> = {}): GoogleApi & { calls: string[] } {
  const calls: string[] = [];
  const rec = <T>(name: string, v: T) => {
    calls.push(name);
    return v;
  };
  return {
    calls,
    exchangeCode: async () => rec('exchangeCode', { refreshToken: 'rt', email: 'akmal@eyelevelstudio.in' }),
    listEvents: async () => rec('listEvents', { items: [], nextSyncToken: 'sync-2' }),
    createCalendar: async () => rec('createCalendar', 'cal-flowzen'),
    deleteCalendar: async () => rec('deleteCalendar', undefined),
    insertEvent: async () => rec('insertEvent', 'g-ev-1'),
    updateEvent: async () => rec('updateEvent', undefined),
    deleteEvent: async () => rec('deleteEvent', undefined),
    revoke: async () => rec('revoke', undefined),
    ...over,
  };
}

const conn = (over: Record<string, unknown> = {}) => ({
  id: 'gc-1',
  organizationId: 'org-1',
  userId: 'usr-akmal',
  googleEmail: 'akmal@eyelevelstudio.in',
  refreshTokenEncrypted: encryptSecret('rt'),
  flowzenCalendarId: 'cal-flowzen',
  syncToken: 'sync-1' as string | null,
  status: 'ACTIVE',
  lastSyncedAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const NOW = new Date('2026-10-05T04:30:00Z');
const meeting = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  status: 'confirmed',
  summary: 'Board review',
  start: { dateTime: '2026-10-09T10:00:00+05:30' },
  end: { dateTime: '2026-10-09T11:00:00+05:30' },
  ...over,
});

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/google/callback';
  (prisma.externalBusyBlock.upsert as any).mockResolvedValue({});
  (prisma.externalBusyBlock.deleteMany as any).mockResolvedValue({ count: 0 });
  (prisma.googleCalendarConnection.update as any).mockResolvedValue({});
});
afterEach(() => setGoogleApi(null));

describe('what counts as busy', () => {
  it('keeps a timed meeting, and an all-day one as whole days on the studio clock', () => {
    expect(busyFrom(meeting(), TZ)).toMatchObject({ title: 'Board review', allDay: false, startsAt: new Date('2026-10-09T04:30:00Z') });
    const offsite = busyFrom({ id: 'g2', summary: 'Offsite', start: { date: '2026-10-12' }, end: { date: '2026-10-14' } }, TZ)!;
    expect(offsite.allDay).toBe(true);
    expect(offsite.startsAt).toEqual(new Date('2026-10-11T18:30:00Z'));
    expect(offsite.endsAt).toEqual(new Date('2026-10-13T18:30:00Z'));
  });

  it('skips declined, "free" and cancelled events', () => {
    expect(busyFrom(meeting({ attendees: [{ self: true, responseStatus: 'declined' }] }), TZ)).toBeNull();
    expect(busyFrom(meeting({ transparency: 'transparent' }), TZ)).toBeNull();
    expect(busyFrom(meeting({ status: 'cancelled' }), TZ)).toBeNull();
    // Somebody ELSE declining does not make it free for this person.
    expect(busyFrom(meeting({ attendees: [{ self: false, responseStatus: 'declined' }] }), TZ)).not.toBeNull();
  });
});

describe('syncBusy', () => {
  it('reads incrementally, keeps busy time, and removes what Google cancelled', async () => {
    const g = fakeGoogle({
      listEvents: async (_c, q) => {
        expect(q).toMatchObject({ syncToken: 'sync-1' });
        return { items: [meeting(), meeting({ id: 'g-gone', status: 'cancelled' }), meeting({ id: 'g-free', transparency: 'transparent' })], nextSyncToken: 'sync-2' };
      },
    });
    setGoogleApi(g);
    const r = await syncBusy(conn() as any, TZ, NOW);

    expect(r).toMatchObject({ kept: 1, full: false });
    expect((prisma.externalBusyBlock.upsert as any).mock.calls[0][0].create).toMatchObject({ userId: 'usr-akmal', googleEventId: 'g1', title: 'Board review' });
    const removedIds = (prisma.externalBusyBlock.deleteMany as any).mock.calls.map((c: any) => c[0].where.googleEventId).filter(Boolean);
    expect(removedIds).toEqual(['g-gone', 'g-free']);
    expect((prisma.googleCalendarConnection.update as any).mock.calls.at(-1)[0].data).toMatchObject({ syncToken: 'sync-2', status: 'ACTIVE', lastError: null });
  });

  it('starts again from the window when Google says the token expired (410)', async () => {
    const asked: any[] = [];
    setGoogleApi(
      fakeGoogle({
        listEvents: async (_c, q) => {
          asked.push(q);
          if (q.syncToken) throw err(410, 'Sync token is no longer valid');
          return { items: [meeting()], nextSyncToken: 'sync-fresh' };
        },
      }),
    );
    const r = await syncBusy(conn() as any, TZ, NOW);
    expect(r).toMatchObject({ full: true, kept: 1 });
    expect(asked[1]).toMatchObject({ timeMin: '2026-09-28T04:30:00.000Z', timeMax: '2026-12-04T04:30:00.000Z' });
    // A full read is the whole truth: anything not in it goes.
    const prune = (prisma.externalBusyBlock.deleteMany as any).mock.calls.at(-1)[0].where;
    expect(prune.OR).toContainEqual({ googleEventId: { notIn: ['g1'] } });
  });

  it('marks the connection NEEDS_RECONNECT when Google refuses the token', async () => {
    setGoogleApi(fakeGoogle({ listEvents: async () => Promise.reject(new Error('invalid_grant: Token has been expired or revoked.')) }));
    expect(await syncBusy(conn() as any, TZ, NOW)).toBe('needs_reconnect');
    expect((prisma.googleCalendarConnection.update as any).mock.calls[0][0].data).toMatchObject({ status: 'NEEDS_RECONNECT' });
    expect(prisma.externalBusyBlock.upsert).not.toHaveBeenCalled();
  });
});

describe('privacy: only the owner sees a Google title', () => {
  const auth = (id: string, preset: RolePreset) =>
    ['Authorization', `Bearer ${signJwt({ userId: id, organizationId: 'org-1', email: 'x@y', preset, permissions: [...ROLE_PRESET_PERMISSIONS[preset]] })}`] as const;

  beforeEach(() => {
    (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => ({
      id: where.id,
      organizationId: 'org-1',
      name: where.id === 'usr-akmal' ? 'Akmal' : 'Ramya',
      email: 'x@y',
      preset: where.id === 'usr-akmal' ? RolePreset.MANAGEMENT : RolePreset.EMPLOYEE,
      permissions: [],
      active: true,
      sessionsValidFrom: null,
    }));
    (prisma.organization.findUnique as any).mockResolvedValue({ timezone: TZ, holidays: [], workingDays: [1, 2, 3, 4, 5, 6], googleCalendarEnabled: true });
    (prisma.externalBusyBlock.findMany as any).mockResolvedValue([
      { id: 'b1', userId: 'usr-akmal', title: 'Board review — salary talks', startsAt: new Date('2026-10-09T04:30:00Z'), endsAt: new Date('2026-10-09T05:30:00Z'), allDay: false, user: { name: 'Akmal' } },
    ]);
    (prisma.googleCalendarConnection.findUnique as any).mockResolvedValue(null);
  });

  it('sends Akmal his own title, and Ramya "Busy" with no title anywhere in the response', async () => {
    const own = await request(app).get('/api/calendar?from=2026-10-09&to=2026-10-09&layers=google').set(...auth('usr-akmal', RolePreset.MANAGEMENT));
    expect(own.body.items[0]).toMatchObject({ title: 'Board review — salary talks', layer: 'google', time: '10:00', endTime: '11:00' });

    const other = await request(app).get('/api/calendar?from=2026-10-09&to=2026-10-09&layers=google').set(...auth('usr-ramya', RolePreset.EMPLOYEE));
    expect(other.body.items[0]).toMatchObject({ title: 'Busy · Akmal', time: '10:00', endTime: '11:00' });
    expect(JSON.stringify(other.body)).not.toMatch(/Board review|salary/);
  });

  it('warns "busy (Google Calendar)" in a clash, with the title only for its owner', async () => {
    const opts = { organizationId: 'org-1', start: new Date('2026-10-09T05:00:00Z'), end: new Date('2026-10-09T06:00:00Z'), assetIds: [], attendeeIds: ['usr-akmal'], timezone: TZ };
    const forRamya = await findClashes({ ...opts, viewerId: 'usr-ramya' });
    expect(forRamya.map((c) => c.message)).toEqual(['Akmal is busy (Google Calendar) 10:00–11:00']);
    const forAkmal = await findClashes({ ...opts, viewerId: 'usr-akmal' });
    expect(forAkmal.map((c) => c.message)).toEqual(['Akmal is busy (Google Calendar) 10:00–11:00 — Board review — salary talks']);
  });

  it('leaves busy time out entirely while the organisation has it switched off', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue({ timezone: TZ, holidays: [], workingDays: [1, 2, 3, 4, 5, 6], googleCalendarEnabled: false });
    const res = await request(app).get('/api/calendar?from=2026-10-09&to=2026-10-09&layers=google').set(...auth('usr-ramya', RolePreset.EMPLOYEE));
    expect(res.body.available).not.toContain('google');
    expect(res.body.items).toEqual([]);
  });
});

describe('the push queue', () => {
  const event = {
    id: 'ev-1',
    title: 'Acme review',
    startsAt: new Date('2026-10-09T04:30:00Z'),
    endsAt: new Date('2026-10-09T05:30:00Z'),
    allDay: false,
    location: 'Board room',
    deletedAt: null,
    createdBy: { name: 'Priya' },
  };
  const link = (over: Record<string, unknown> = {}) => ({ id: 'lk-1', eventId: 'ev-1', userId: 'usr-akmal', googleEventId: null, state: 'PENDING_UPSERT', attempts: 0, lastError: null, event, ...over });

  beforeEach(() => {
    (prisma.googleCalendarConnection.findUnique as any).mockResolvedValue(conn());
    (prisma.googleEventLink.update as any).mockResolvedValue({});
    (prisma.googleEventLink.delete as any).mockResolvedValue({});
  });

  it('writes a new event into the "Flowzen" calendar, with the link back, and marks it SYNCED', async () => {
    const g = fakeGoogle();
    let sent: any;
    g.insertEvent = async (_c, calendarId, body) => {
      sent = { calendarId, body };
      return 'g-ev-1';
    };
    setGoogleApi(g);
    (prisma.googleEventLink.findUnique as any).mockResolvedValue(link());

    expect(await pushLink('lk-1', TZ)).toBe('synced');
    expect(sent.calendarId).toBe('cal-flowzen');
    expect(sent.body).toMatchObject({ summary: 'Acme review', location: 'Board room', start: { dateTime: '2026-10-09T04:30:00.000Z', timeZone: TZ } });
    expect(sent.body.description).toContain('/calendar?event=ev-1');
    expect((prisma.googleEventLink.update as any).mock.calls[0][0].data).toMatchObject({ googleEventId: 'g-ev-1', state: 'SYNCED', attempts: 0 });
  });

  it('moves an event already there, and takes it out again when the person is removed', async () => {
    const g = fakeGoogle();
    setGoogleApi(g);
    (prisma.googleEventLink.findUnique as any).mockResolvedValueOnce(link({ googleEventId: 'g-ev-1' }));
    await pushLink('lk-1', TZ);
    expect(g.calls).toEqual(['updateEvent']);

    (prisma.googleEventLink.findUnique as any).mockResolvedValueOnce(link({ googleEventId: 'g-ev-1', state: 'PENDING_DELETE' }));
    expect(await pushLink('lk-1', TZ)).toBe('deleted');
    expect(g.calls).toEqual(['updateEvent', 'deleteEvent']);
    expect(prisma.googleEventLink.delete).toHaveBeenCalledWith({ where: { id: 'lk-1' } });
  });

  it('counts a failure, keeps the error, and gives up as FAILED on the fifth', async () => {
    setGoogleApi(fakeGoogle({ insertEvent: async () => Promise.reject(err(503, 'Backend Error')) }));
    (prisma.googleEventLink.findUnique as any).mockResolvedValueOnce(link({ attempts: 0 }));
    expect(await pushLink('lk-1', TZ)).toBe('retry');
    expect((prisma.googleEventLink.update as any).mock.calls[0][0].data).toEqual({ attempts: 1, lastError: 'Backend Error' });

    (prisma.googleEventLink.findUnique as any).mockResolvedValueOnce(link({ attempts: MAX_PUSH_ATTEMPTS - 1 }));
    expect(await pushLink('lk-1', TZ)).toBe('failed');
    expect((prisma.googleEventLink.update as any).mock.calls[1][0].data).toEqual({ attempts: 5, lastError: 'Backend Error', state: 'FAILED' });
  });

  it('waits, uncounted, when the token is refused — and asks the person to reconnect', async () => {
    setGoogleApi(fakeGoogle({ insertEvent: async () => Promise.reject(err(401, 'Invalid Credentials')) }));
    (prisma.googleEventLink.findUnique as any).mockResolvedValue(link());
    expect(await pushLink('lk-1', TZ)).toBe('waiting');
    expect((prisma.googleCalendarConnection.update as any).mock.calls[0][0].data).toMatchObject({ status: 'NEEDS_RECONNECT' });
    expect(prisma.googleEventLink.update).not.toHaveBeenCalled();
  });

  it('queues upserts for the connected people on it and a delete for the one taken off', async () => {
    setGoogleApi(fakeGoogle());
    (prisma.organization.findUnique as any).mockResolvedValue({ googleCalendarEnabled: true });
    (prisma.googleCalendarConnection.findMany as any).mockResolvedValue([{ userId: 'usr-akmal' }, { userId: 'usr-janani' }]);
    (prisma.googleEventLink.upsert as any).mockResolvedValue({ id: 'lk-akmal' });
    (prisma.googleEventLink.findUnique as any).mockImplementation(async ({ where }: any) =>
      where.eventId_userId ? { id: 'lk-janani', googleEventId: 'g-j' } : null,
    );

    await queueEventForGoogle({ organizationId: 'org-1', eventId: 'ev-1', attendeeIds: ['usr-akmal', 'usr-ravi'], removedIds: ['usr-janani'], timezone: TZ });

    // Ravi has not connected Google: nothing queued for him.
    expect((prisma.googleEventLink.upsert as any).mock.calls.map((c: any) => c[0].create.userId)).toEqual(['usr-akmal']);
    expect((prisma.googleEventLink.update as any).mock.calls[0][0]).toEqual({
      where: { id: 'lk-janani' },
      data: { state: 'PENDING_DELETE', attempts: 0, lastError: null },
    });
  });

  it('never throws out of a save, even when the database or Google does', async () => {
    (prisma.organization.findUnique as any).mockRejectedValue(new Error('db down'));
    await expect(queueEventForGoogle({ organizationId: 'org-1', eventId: 'ev-1', attendeeIds: ['usr-akmal'], removedIds: [], timezone: TZ })).resolves.toBeUndefined();
  });
});

describe('the OAuth state, and disconnecting', () => {
  it('accepts the state only from the person who started, unaltered and in time', () => {
    const s = makeState('usr-akmal', 1_000_000);
    expect(stateIsFor(s, 'usr-akmal', 1_000_000 + 60_000)).toBe(true);
    expect(stateIsFor(s, 'usr-ramya', 1_000_000 + 60_000)).toBe(false);
    expect(stateIsFor(s, 'usr-akmal', 1_000_000 + 11 * 60_000)).toBe(false);
    const [body] = s.split('.');
    expect(stateIsFor(`${body}.forged`, 'usr-akmal', 1_000_000)).toBe(false);
  });

  it('deletes the "Flowzen" calendar, revokes the token, and removes everything stored', async () => {
    const g = fakeGoogle();
    setGoogleApi(g);
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'usr-akmal', organizationId: 'org-1', name: 'Akmal', email: 'x@y', preset: 'MANAGEMENT', permissions: [], active: true, sessionsValidFrom: null });
    (prisma.googleCalendarConnection.findUnique as any).mockResolvedValue(conn());
    (prisma.$transaction as any).mockResolvedValue([]);
    const token = signJwt({ userId: 'usr-akmal', organizationId: 'org-1', email: 'x@y', preset: 'MANAGEMENT', permissions: [] });

    const res = await request(app).post('/api/google/disconnect').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(g.calls).toEqual(['deleteCalendar', 'revoke']);
    expect(prisma.externalBusyBlock.deleteMany).toHaveBeenCalledWith({ where: { userId: 'usr-akmal' } });
    expect(prisma.googleEventLink.deleteMany).toHaveBeenCalledWith({ where: { userId: 'usr-akmal' } });
    expect(prisma.googleCalendarConnection.delete).toHaveBeenCalledWith({ where: { userId: 'usr-akmal' } });
  });

  it('sends a callback with somebody else\'s state back to Profile with an error, storing nothing', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: 'usr-ramya', organizationId: 'org-1', name: 'Ramya', email: 'x@y', preset: 'EMPLOYEE', permissions: [], active: true, sessionsValidFrom: null });
    (prisma.organization.findUnique as any).mockResolvedValue({ googleCalendarEnabled: true });
    const token = signJwt({ userId: 'usr-ramya', organizationId: 'org-1', email: 'x@y', preset: 'EMPLOYEE', permissions: [] });
    const res = await request(app)
      .get(`/api/google/callback?code=abc&state=${encodeURIComponent(makeState('usr-akmal'))}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/profile\?google=error$/);
    expect(prisma.googleCalendarConnection.upsert).not.toHaveBeenCalled();
  });
});
