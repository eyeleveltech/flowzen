import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { sendMail } from '../utils/mailer.js';
import { runEventReminders } from '../workers/eventReminder.cron.js';
import { syncTodayAlertFor } from '../services/calendarEvents.js';
import { eventAlertClauses, RULE_PERMISSION } from './notifications.js';
import { EXTERNAL_RULES } from '../services/alertRules.js';

/**
 * Meetings, shoots and the gear they reserve.
 *
 *   · events: who may book, who may change, what a saved event must be, and
 *     that people and gear are replaced whole;
 *   · telling people: the person booked hears of it, the booker does not, a
 *     notes-only change tells nobody, and no mail server never stops a save;
 *   · clashes: each kind of warning, saving nothing;
 *   · the morning bell: once a day, only to the event's people, resolved when
 *     it is over, and never closed by the hourly scanner.
 */

vi.mock('../utils/mailer.js', () => ({ sendMail: vi.fn() }));

const PEOPLE = {
  priya: { id: 'usr-priya', name: 'Priya', preset: RolePreset.EMPLOYEE },
  ravi: { id: 'usr-ravi', name: 'Ravi', preset: RolePreset.EMPLOYEE },
  head: { id: 'usr-head', name: 'Hari', preset: RolePreset.HEAD },
  akmal: { id: 'usr-akmal', name: 'Akmal', preset: RolePreset.MANAGEMENT },
} as const;
type Who = keyof typeof PEOPLE;

const auth = (who: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[who].id,
      organizationId: 'org-1',
      email: `${who}@eyelevel.local`,
      preset: PEOPLE[who].preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[PEOPLE[who].preset]],
    })}`,
  ] as const;

// Friday 9 October 2026, the studio's clock (IST, UTC+5:30).
const at = (hhmm: string, day = '2026-10-09') => new Date(new Date(`${day}T${hhmm}:00Z`).getTime() - 330 * 60_000);

/** The Acme review Priya booked for Akmal, as the database holds it. */
const review = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  organizationId: 'org-1',
  kind: 'MEETING',
  title: 'Acme review',
  startsAt: at('10:00'),
  endsAt: at('11:00'),
  allDay: false,
  location: 'Board room',
  notes: null,
  companyId: 'co-acme',
  projectId: null,
  retainerId: null,
  createdById: 'usr-priya',
  deletedAt: null,
  createdBy: { id: 'usr-priya', name: 'Priya' },
  attendees: [{ userId: 'usr-akmal' }],
  contacts: [{ personId: 'per-rao' }],
  reservations: [] as { assetId: string }[],
  _count: { attendees: 1 },
  ...over,
});

const meeting = {
  kind: 'MEETING',
  title: 'Acme review',
  startsAt: '2026-10-09T10:00',
  endsAt: '2026-10-09T11:00',
  location: 'Board room',
  attendeeIds: ['usr-akmal'],
  companyId: 'co-acme',
  contactIds: ['per-rao'],
};

beforeEach(() => {
  vi.mocked(sendMail).mockReset();
  vi.mocked(sendMail).mockResolvedValue({ sent: true });
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const p = Object.values(PEOPLE).find((x) => x.id === where.id);
    if (!p) return null;
    return {
      id: p.id,
      organizationId: 'org-1',
      name: p.name,
      email: `${p.name.toLowerCase()}@eyelevel.local`,
      preset: p.preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[p.preset]],
      active: true,
      sessionsValidFrom: null,
    };
  });
  (prisma.user.findMany as any).mockImplementation(async ({ where }: any) =>
    Object.values(PEOPLE)
      .filter((p) => (where?.id?.in ?? []).includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, email: `${p.name.toLowerCase()}@eyelevel.local` })),
  );
  (prisma.organization.findUnique as any).mockResolvedValue({ timezone: 'Asia/Kolkata' });
  (prisma.$transaction as any).mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  (prisma.user.count as any).mockImplementation(async ({ where }: any) => where.id.in.length);
  (prisma.company.findFirst as any).mockResolvedValue({ id: 'co-acme' });
  (prisma.person.count as any).mockImplementation(async ({ where }: any) => where.id.in.length);
  (prisma.asset.findMany as any).mockResolvedValue([]);
  (prisma.assetReservation.findMany as any).mockResolvedValue([]);
  (prisma.calendarEvent.create as any).mockResolvedValue({ id: 'ev-1' });
  (prisma.calendarEvent.findFirst as any).mockResolvedValue(review());
  (prisma.alert.findMany as any).mockResolvedValue([]);
  (prisma.alert.create as any).mockResolvedValue({ id: 'al-new' });
  (prisma.alert.updateMany as any).mockResolvedValue({ count: 0 });
  (prisma.alertRead.createMany as any).mockResolvedValue({ count: 1 });
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
});

const mailsTo = () => vi.mocked(sendMail).mock.calls.map(([, m]) => `${m.to} | ${m.subject}`);

describe('booking', () => {
  it('lets an Employee book for somebody else: Akmal is told, Priya is not', async () => {
    const res = await request(app).post('/api/calendar/events').set(...auth('priya')).send(meeting);

    expect(res.status).toBe(201);
    expect(mailsTo()).toEqual(['akmal@eyelevel.local | Priya booked you: Acme review']);
    expect(vi.mocked(sendMail).mock.calls[0][1].html).toContain('Fri 9 Oct 10:00–11:00, Board room');
    expect(vi.mocked(sendMail).mock.calls[0][1].html).toContain('Booked by Priya');

    // One bell row, for the event's people, already read for the booker.
    const alert = (prisma.alert.create as any).mock.calls.find((c: any) => c[0].data.rule === 'EVENT_UPDATE')[0].data;
    expect(alert).toMatchObject({ entityType: 'CalendarEvent', entityId: 'ev-1' });
    expect(alert.message).toBe('Booked: Acme review, Fri 9 Oct 10:00–11:00, Board room · Booked by Priya');
    expect((prisma.alertRead.createMany as any).mock.calls[0][0].data).toEqual([{ alertId: 'al-new', userId: 'usr-priya' }]);
    expect((prisma.activity.create as any).mock.calls[0][0].data).toMatchObject({ entityType: 'CalendarEvent', verb: 'event_created' });
  });

  it('still saves, and still rings the bell, when there is no mail server', async () => {
    vi.mocked(sendMail).mockRejectedValue(new Error('No mail server is configured for this organisation.'));
    const res = await request(app).post('/api/calendar/events').set(...auth('priya')).send(meeting);
    expect(res.status).toBe(201);
    expect((prisma.alert.create as any).mock.calls.some((c: any) => c[0].data.rule === 'EVENT_UPDATE')).toBe(true);
  });

  it.each([
    ['an end before the start', { startsAt: '2026-10-09T11:00', endsAt: '2026-10-09T10:00' }, /after the start/],
    ['longer than 31 days', { allDay: true, startsAt: '2026-10-01', endsAt: '2026-11-01' }, /31 days/],
    ['gear on a meeting', { assetIds: ['as-a7'] }, /Only a shoot/],
    ['a project without a client', { companyId: null, contactIds: [], projectId: 'prj-1' }, /client first/],
  ])('refuses %s', async (_name, change, why) => {
    const res = await request(app).post('/api/calendar/events').set(...auth('priya')).send({ ...meeting, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(why);
    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('refuses gear that is gone, a project of another client, a contact elsewhere, and somebody not on the team', async () => {
    (prisma.asset.findMany as any).mockResolvedValueOnce([{ id: 'as-old', tag: 'EL/CAM/009', status: 'RETIRED' }]);
    let res = await request(app).post('/api/calendar/events').set(...auth('priya')).send({ ...meeting, kind: 'SHOOT', assetIds: ['as-old'] });
    expect(res.body.error).toMatch(/EL\/CAM\/009 is retired/);

    (prisma.project.findFirst as any).mockResolvedValueOnce(null);
    res = await request(app).post('/api/calendar/events').set(...auth('priya')).send({ ...meeting, projectId: 'prj-other' });
    expect(res.body.error).toMatch(/isn't this client's/);

    (prisma.person.count as any).mockResolvedValueOnce(0);
    res = await request(app).post('/api/calendar/events').set(...auth('priya')).send(meeting);
    expect(res.body.error).toMatch(/contacts isn't at this client/);

    (prisma.user.count as any).mockResolvedValueOnce(0);
    res = await request(app).post('/api/calendar/events').set(...auth('priya')).send(meeting);
    expect(res.body.error).toMatch(/not on the team/);
  });
});

describe('changing and cancelling', () => {
  it("does not let an Employee change somebody else's event — but lets the booker, and a Head", async () => {
    const ravi = await request(app).patch('/api/calendar/events/ev-1').set(...auth('ravi')).send({ notes: 'x' });
    expect(ravi.status).toBe(403);
    expect(await request(app).patch('/api/calendar/events/ev-1').set(...auth('priya')).send({ notes: 'x' }).then((r) => r.status)).toBe(200);
    expect(await request(app).patch('/api/calendar/events/ev-1').set(...auth('head')).send({ notes: 'x' }).then((r) => r.status)).toBe(200);
    expect((await request(app).delete('/api/calendar/events/ev-1').set(...auth('ravi'))).status).toBe(403);
  });

  it('tells nobody when only the notes change', async () => {
    const res = await request(app).patch('/api/calendar/events/ev-1').set(...auth('priya')).send({ notes: 'Bring the deck' });
    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
    expect((prisma.alert.create as any).mock.calls.filter((c: any) => c[0].data.rule === 'EVENT_UPDATE')).toHaveLength(0);
    expect((prisma.activity.create as any).mock.calls.map((c: any) => c[0].data.verb)).toEqual(['event_edited']);
  });

  it('tells the people on it when it moves', async () => {
    (prisma.calendarEvent.findFirst as any)
      .mockResolvedValueOnce(review()) // before
      .mockResolvedValueOnce(review({ startsAt: at('10:00', '2026-10-10'), endsAt: at('11:00', '2026-10-10') })); // after
    await request(app)
      .patch('/api/calendar/events/ev-1')
      .set(...auth('priya'))
      .send({ startsAt: '2026-10-10T10:00', endsAt: '2026-10-10T11:00' });
    expect(mailsTo()).toEqual(['akmal@eyelevel.local | Priya moved Acme review']);
    expect(vi.mocked(sendMail).mock.calls[0][1].html).toContain('Priya moved Acme review to Sat 10 Oct 10:00–11:00, Board room.');
  });

  it('tells the person taken off, and the person put on', async () => {
    (prisma.calendarEvent.findFirst as any)
      .mockResolvedValueOnce(review())
      .mockResolvedValueOnce(review({ attendees: [{ userId: 'usr-ravi' }] }));
    await request(app).patch('/api/calendar/events/ev-1').set(...auth('priya')).send({ attendeeIds: ['usr-ravi'] });
    expect(mailsTo().sort()).toEqual([
      'akmal@eyelevel.local | Priya removed you from Acme review',
      'ravi@eyelevel.local | Priya booked you: Acme review',
    ]);
  });

  it('replaces the gear whole, over the new window', async () => {
    (prisma.calendarEvent.findFirst as any).mockResolvedValue(review({ kind: 'SHOOT', reservations: [{ assetId: 'as-old' }] }));
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 'as-a7', tag: 'EL/CAM/001', status: 'IN_STOCK' },
      { id: 'as-lens', tag: 'EL/LEN/002', status: 'IN_STOCK' },
    ]);
    await request(app)
      .patch('/api/calendar/events/ev-1')
      .set(...auth('priya'))
      .send({ assetIds: ['as-a7', 'as-lens'], startsAt: '2026-10-09T12:00', endsAt: '2026-10-09T16:00' });

    expect(prisma.assetReservation.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'ev-1' } });
    const made = (prisma.assetReservation.createMany as any).mock.calls[0][0].data;
    expect(made.map((r: any) => r.assetId)).toEqual(['as-a7', 'as-lens']);
    expect(made[0]).toMatchObject({ eventId: 'ev-1', startsAt: at('12:00'), endsAt: at('16:00') });
  });

  it('cancels softly, lets the gear go, and tells everybody on it', async () => {
    const res = await request(app).delete('/api/calendar/events/ev-1').set(...auth('priya'));
    expect(res.status).toBe(200);
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith({ where: { id: 'ev-1' }, data: { deletedAt: expect.any(Date) } });
    expect(prisma.assetReservation.deleteMany).toHaveBeenCalledWith({ where: { eventId: 'ev-1' } });
    expect(mailsTo()).toEqual(['akmal@eyelevel.local | Priya cancelled Acme review']);
  });
});

describe('POST /calendar/clashes', () => {
  it('warns about each thing in the way, and saves nothing', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 'as-a7', tag: 'EL/CAM/001', name: 'Sony A7', status: 'IN_STOCK', currentHolder: null, movements: [] },
      { id: 'as-lens', tag: 'EL/LEN/002', name: '24-70', status: 'BOOKED_OUT', currentHolder: null, movements: [{ dueAt: at('18:00', '2026-10-10'), user: { name: 'Ravi' } }] },
      { id: 'as-mic', tag: 'EL/AUD/003', name: 'Rode mic', status: 'BOOKED_OUT', currentHolder: null, movements: [{ dueAt: new Date('2020-01-02T12:00:00Z'), user: { name: 'Akmal' } }] },
      { id: 'as-mac', tag: 'EL/LAP/004', name: 'MacBook', status: 'ASSIGNED', currentHolder: { name: 'Janani' }, movements: [] },
      { id: 'as-light', tag: 'EL/LGT/005', name: 'Aputure', status: 'IN_REPAIR', currentHolder: null, movements: [] },
    ]);
    (prisma.assetReservation.findMany as any).mockResolvedValue([
      { assetId: 'as-a7', event: { title: 'Zeta shoot', startsAt: at('10:00'), endsAt: at('14:00'), allDay: false } },
    ]);
    (prisma.calendarEventAttendee.findMany as any).mockResolvedValue([
      { userId: 'usr-ravi', user: { name: 'Ravi' }, event: { title: 'Acme meeting', startsAt: at('11:00'), endsAt: at('12:00'), allDay: false } },
    ]);

    const res = await request(app)
      .post('/api/calendar/clashes')
      .set(...auth('priya'))
      .send({ startsAt: '2026-10-09T12:00', endsAt: '2026-10-09T16:00', assetIds: ['as-a7', 'as-lens', 'as-mic', 'as-mac', 'as-light'], attendeeIds: ['usr-ravi'] });

    expect(res.status).toBe(200);
    expect(res.body.clashes.map((c: any) => `${c.kind}: ${c.message}`)).toEqual([
      'reserved: Reserved for Zeta shoot, 10:00–14:00',
      'out: Out with Ravi, due back Sat 10 Oct',
      'out: Out with Akmal, was due back Thu 2 Jan',
      'assigned: Held by Janani — check with them',
      'repair: In repair',
      'person: Ravi is on Acme meeting 11:00–12:00',
    ]);
    expect(prisma.calendarEvent.create).not.toHaveBeenCalled();
    expect(prisma.assetReservation.createMany).not.toHaveBeenCalled();
  });

  it('leaves out gear due back before the shoot starts', async () => {
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 'as-lens', tag: 'EL/LEN/002', name: '24-70', status: 'BOOKED_OUT', currentHolder: null, movements: [{ dueAt: at('09:00'), user: { name: 'Ravi' } }] },
    ]);
    // Due back at 09:00 on the shoot's day — not yet overdue, and back before 12:00.
    const res = await request(app)
      .post('/api/calendar/clashes')
      .set(...auth('priya'))
      .send({ startsAt: '2026-10-09T12:00', endsAt: '2026-10-09T16:00', assetIds: ['as-lens'] });
    expect(res.body.clashes).toEqual([]);
  });
});

describe('the morning bell', () => {
  const shoot = {
    id: 'ev-shoot',
    title: 'Acme shoot',
    startsAt: at('10:00'),
    endsAt: at('13:00'),
    allDay: false,
    location: 'Studio B',
    deletedAt: null,
    createdBy: { name: 'Priya' },
    _count: { attendees: 2 },
  };
  const morning = at('07:30');

  /** The alerts the worker reads, by what it asks for. */
  const openAlerts = (today: any[] = [], updates: any[] = []) =>
    (prisma.alert.findMany as any).mockImplementation(async ({ where }: any) => {
      if (where.rule === 'EVENT_UPDATE') return updates;
      if (where.rule === 'EVENT_TODAY' && typeof where.entityId === 'string') return today.filter((a) => a.entityId === where.entityId);
      if (where.rule === 'EVENT_TODAY') return today.filter((a) => !where.entityId.notIn.includes(a.entityId));
      return [];
    });

  beforeEach(() => {
    (prisma.organization.findMany as any).mockResolvedValue([{ id: 'org-1', timezone: 'Asia/Kolkata' }]);
  });

  it("raises one alert for today's shoot — and only once however often it runs", async () => {
    (prisma.calendarEvent.findMany as any).mockResolvedValue([shoot]);
    openAlerts();
    expect(await runEventReminders(morning)).toMatchObject({ created: 1 });
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({
      rule: 'EVENT_TODAY',
      entityType: 'CalendarEvent',
      entityId: 'ev-shoot',
      message: 'Today 10:00–13:00 · Acme shoot · Studio B · Booked by Priya',
    });

    (prisma.alert.create as any).mockClear();
    openAlerts([{ id: 'al-today', entityId: 'ev-shoot', message: 'Today 10:00–13:00 · Acme shoot · Studio B · Booked by Priya', raisedAt: morning }]);
    expect(await runEventReminders(at('08:00'))).toMatchObject({ created: 0 });
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('resolves it once the shoot is over', async () => {
    (prisma.calendarEvent.findMany as any).mockResolvedValue([]);
    openAlerts([{ id: 'al-today', entityId: 'ev-shoot', raisedAt: morning }]);
    await runEventReminders(at('13:30'));
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['al-today'] } }, data: { resolvedAt: expect.any(Date) } });
  });

  it('resolves "booked" when the event ends, and "cancelled" only once its start has passed', async () => {
    (prisma.calendarEvent.findMany as any).mockImplementation(async ({ where }: any) =>
      where.id
        ? [
            { id: 'ev-over', startsAt: at('08:00'), endsAt: at('09:00'), deletedAt: null },
            { id: 'ev-cancelled-later', startsAt: at('17:00'), endsAt: at('18:00'), deletedAt: at('07:00') },
          ]
        : [],
    );
    openAlerts([], [
      { id: 'al-over', entityId: 'ev-over' },
      { id: 'al-cancelled', entityId: 'ev-cancelled-later' },
    ]);
    await runEventReminders(at('10:00'));
    const resolved = (prisma.alert.updateMany as any).mock.calls.flatMap((c: any) => c[0].where.id.in);
    expect(resolved).toEqual(['al-over']);
  });

  it('rings at once for an event booked at 11:00 for 15:00 the same day', async () => {
    (prisma.calendarEvent.findFirst as any).mockResolvedValue({ ...shoot, startsAt: at('15:00'), endsAt: at('16:00') });
    (prisma.alert.findMany as any).mockResolvedValue([]);
    await syncTodayAlertFor('org-1', 'ev-shoot', 'Asia/Kolkata', at('11:00'));
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({ rule: 'EVENT_TODAY', message: 'Today 15:00–16:00 · Acme shoot · Studio B · Booked by Priya' });
  });

  it("reaches the event's people and nobody else — not by permission", async () => {
    (prisma.calendarEventAttendee.findMany as any).mockImplementation(async ({ where }: any) =>
      ['usr-ravi', 'usr-janani'].includes(where.userId) ? [{ eventId: 'ev-shoot' }] : [],
    );
    expect(await eventAlertClauses('org-1', 'usr-ravi')).toEqual([
      { rule: { in: ['EVENT_TODAY', 'EVENT_UPDATE'] }, entityType: 'CalendarEvent', entityId: { in: ['ev-shoot'] } },
    ]);
    expect(await eventAlertClauses('org-1', 'usr-akmal')).toEqual([]);
    expect('EVENT_TODAY' in RULE_PERMISSION).toBe(false);
    expect('EVENT_UPDATE' in RULE_PERMISSION).toBe(false);
  });

  it('is never closed by the hourly scanner', () => {
    expect(EXTERNAL_RULES).toEqual(expect.arrayContaining(['EVENT_TODAY', 'EVENT_UPDATE', 'APPROVAL_REMINDER', 'APPROVAL_ESCALATED']));
    const scanner = fs.readFileSync(path.join(__dirname, '../workers/scanner.cron.ts'), 'utf8');
    expect(scanner).toMatch(/rule: \{ notIn: EXTERNAL_RULES \}/);
  });
});
