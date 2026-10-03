import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { RolePreset } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { forgetWorkCalendar, DEFAULT_WORK_CALENDAR } from '../utils/workCalendar.js';
import { EXTERNAL_RULES } from './alertRules.js';
import {
  pushDueAt,
  pushNewAlerts,
  pushTaskEdited,
  queuePushFor,
  withoutMoney,
  RULE_TITLE,
  BELL_URL,
} from './push.js';
import { plan, runPushWorker, CAP_PER_HOUR } from '../workers/push.cron.js';

/*
 * The bell's own rule, as a stand-in: who may see what is notifications.ts's
 * business and is tested there. Here it only matters that the push asks it,
 * per person, and keeps to the answer.
 */
vi.mock('../routes/notifications.js', () => ({
  alertClausesFor: vi.fn(async (user: { userId: string }) =>
    user.userId === 'usr-nothing' ? [] : [{ rule: { in: ['INVOICE_OVERDUE', 'PROJECT_OVER_ESTIMATE'] } }],
  ),
}));

/**
 * Phone notifications — who is told, when, and what the worker does with it.
 *
 * Fixed decisions this checks: never the person who caused it; each kind
 * behind its own switch ("Everything in my bell" off by default); working
 * hours only, held to the next working morning; one event is one push; more
 * than three held become one summary; twenty an hour at most; a device the
 * push service calls gone is deleted; the bell's audience is the bell's.
 */

const ORG = 'org-1';
const RAVI = 'usr-ravi';
const HEAD = 'usr-head';
const ist = (s: string) => new Date(`${s}+05:30`);

const org = (over: Record<string, unknown> = {}) => ({
  pushEnabled: true,
  timezone: 'Asia/Kolkata',
  workingHoursStart: '10:00',
  workingHoursEnd: '19:00',
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: ['2026-10-20'],
  ...over,
});

const person = (id: string, prefs: Record<string, boolean> | null = null) => ({ id, notificationPreference: prefs });

beforeAll(() => {
  process.env.VAPID_PUBLIC_KEY = 'test-public';
  process.env.VAPID_PRIVATE_KEY = 'test-private';
  process.env.VAPID_SUBJECT = 'mailto:admin@example.com';
});
afterAll(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

beforeEach(() => {
  forgetWorkCalendar(ORG);
  (prisma.organization.findUnique as any).mockResolvedValue(org());
  (prisma.user.findMany as any).mockResolvedValue([person(RAVI)]);
  (prisma.pushOutbox.createMany as any).mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});

const queued = () => (prisma.pushOutbox.createMany as any).mock.calls.flatMap((c: any[]) => c[0].data);

// ── Who ──────────────────────────────────────────────────────────────────────

describe('queuePushFor — who is told', () => {
  const tuesdayNoon = ist('2026-10-06T12:00:00');

  it('queues for the person, due now in working hours', async () => {
    const n = await queuePushFor(ORG, [RAVI], HEAD, 'TASKS', 'task:t1:assigned', 'New task for you', 'Edit reel', '/my-work?task=t1', { now: tuesdayNoon });
    expect(n).toBe(1);
    expect(queued()[0]).toMatchObject({ userId: RAVI, kind: 'TASKS', sourceKey: 'task:t1:assigned', url: '/my-work?task=t1' });
    expect(queued()[0].dueAt).toEqual(tuesdayNoon);
  });

  it('never tells the person who caused it — Ravi assigning himself pushes nothing', async () => {
    const n = await queuePushFor(ORG, [RAVI], RAVI, 'TASKS', 'task:t1:assigned', 'New task for you', 'x', '/my-work', { now: tuesdayNoon });
    expect(n).toBe(0);
    expect(prisma.pushOutbox.createMany).not.toHaveBeenCalled();
  });

  it('respects each kind’s switch — approvals off means no approval push', async () => {
    (prisma.user.findMany as any).mockResolvedValue([person(RAVI, { pushApprovals: false, pushCalendar: true, pushTasks: true, pushBell: false })]);
    expect(await queuePushFor(ORG, [RAVI], HEAD, 'APPROVALS', 'review:r1:submitted', 'Waiting', 'x', '/', { now: tuesdayNoon })).toBe(0);
    expect(await queuePushFor(ORG, [RAVI], HEAD, 'CALENDAR', 'event:e1:1', 'Booked', 'x', '/', { now: tuesdayNoon })).toBe(1);
  });

  it('"Everything in my bell" is off until the person turns it on', async () => {
    expect(await queuePushFor(ORG, [RAVI], null, 'BELL', 'alert:a1', 'Invoice overdue', 'x', '/', { now: tuesdayNoon })).toBe(0);
    (prisma.user.findMany as any).mockResolvedValue([person(RAVI, { pushApprovals: true, pushCalendar: true, pushTasks: true, pushBell: true })]);
    expect(await queuePushFor(ORG, [RAVI], null, 'BELL', 'alert:a1', 'Invoice overdue', 'x', '/', { now: tuesdayNoon })).toBe(1);
  });

  it('asks only for active people with a device', async () => {
    await queuePushFor(ORG, [RAVI], HEAD, 'TASKS', 'k', 't', 'b', '/', { now: tuesdayNoon });
    expect((prisma.user.findMany as any).mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      active: true,
      pushSubscriptions: { some: {} },
    });
  });

  it('sends nothing with the org switch off, or without the server keys', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue(org({ pushEnabled: false }));
    expect(await queuePushFor(ORG, [RAVI], HEAD, 'TASKS', 'k', 't', 'b', '/', { now: tuesdayNoon })).toBe(0);

    (prisma.organization.findUnique as any).mockResolvedValue(org());
    const key = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await queuePushFor(ORG, [RAVI], HEAD, 'TASKS', 'k', 't', 'b', '/', { now: tuesdayNoon })).toBe(0);
    process.env.VAPID_PRIVATE_KEY = key;
    expect(prisma.pushOutbox.createMany).not.toHaveBeenCalled();
  });

  it('one event is one push: the (person, source) key is unique and duplicates are skipped', async () => {
    (prisma.pushOutbox.createMany as any).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await queuePushFor(ORG, [RAVI], null, 'APPROVALS', 'review:r1:reminded', 't', 'b', '/', { now: tuesdayNoon })).toBe(1);
    expect(await queuePushFor(ORG, [RAVI], null, 'APPROVALS', 'review:r1:reminded', 't', 'b', '/', { now: tuesdayNoon })).toBe(0);
    for (const call of (prisma.pushOutbox.createMany as any).mock.calls) expect(call[0].skipDuplicates).toBe(true);
  });

  it('a link outside Flowzen becomes My Work', async () => {
    await queuePushFor(ORG, [RAVI], null, 'TASKS', 'k', 't', 'b', 'https://evil.example/x', { now: tuesdayNoon });
    await queuePushFor(ORG, [RAVI], null, 'TASKS', 'k2', 't', 'b', '//evil.example/x', { now: tuesdayNoon });
    expect(queued().map((r: any) => r.url)).toEqual(['/my-work', '/my-work']);
  });
});

// ── When ─────────────────────────────────────────────────────────────────────

describe('pushDueAt — working hours only', () => {
  const cal = { ...DEFAULT_WORK_CALENDAR, holidays: ['2026-10-20'] };
  const at = (s: string) => pushDueAt(cal, 'Asia/Kolkata', ist(s));

  it('inside working hours: now', () => {
    expect(at('2026-10-06T12:00:00')).toEqual(ist('2026-10-06T12:00:00'));
    expect(at('2026-10-06T18:59:00')).toEqual(ist('2026-10-06T18:59:00'));
  });

  it('21:00 is held to 10:00 the next working day', () => {
    expect(at('2026-10-06T21:00:00')).toEqual(ist('2026-10-07T10:00:00'));
  });

  it('before the start: 10:00 the same day', () => {
    expect(at('2026-10-07T06:30:00')).toEqual(ist('2026-10-07T10:00:00'));
  });

  it('Saturday evening waits past Sunday to Monday', () => {
    expect(at('2026-10-10T20:00:00')).toEqual(ist('2026-10-12T10:00:00'));
  });

  it('a holiday is not a working day', () => {
    expect(at('2026-10-19T19:30:00')).toEqual(ist('2026-10-21T10:00:00'));
    expect(at('2026-10-20T12:00:00')).toEqual(ist('2026-10-21T10:00:00'));
  });

  it('queuePushFor uses it: something at 21:00 is due at 10:00 next working day', async () => {
    await queuePushFor(ORG, [RAVI], HEAD, 'TASKS', 'k', 't', 'b', '/', { now: ist('2026-10-06T21:00:00') });
    expect(queued()[0].dueAt).toEqual(ist('2026-10-07T10:00:00'));
  });

  it('a test the person asked for goes now, whatever the hour', async () => {
    await queuePushFor(ORG, [RAVI], null, 'TEST', 'test:1', 't', 'b', '/profile', { now: ist('2026-10-06T23:00:00'), immediate: true });
    expect(queued()[0].dueAt).toEqual(ist('2026-10-06T23:00:00'));
  });
});

// ── What the lock screen shows ───────────────────────────────────────────────

describe('lock-screen text', () => {
  it('drops a sentence carrying money and keeps the rest', () => {
    expect(withoutMoney('Brigade Reel for Brigade: 60% done with 80% of the quote already spent. At this rate it finishes at ₹1,90,000.')).toBe(
      'Brigade Reel for Brigade: 60% done with 80% of the quote already spent.',
    );
    expect(withoutMoney('Over budget by 1,20,000 this month.')).toBe('Over budget by this month.');
  });

  it('leaves text without figures alone', () => {
    const s = 'Invoice EL/INV/2026-27/014 for Brigade is overdue (due date passed).';
    expect(withoutMoney(s)).toBe(s);
  });

  it('every queued title and line has the money taken out', async () => {
    await queuePushFor(ORG, [RAVI], null, 'TASKS', 'k', 'Cost ₹40,000', 'Spent ₹5,000 so far. Check it.', '/');
    expect(queued()[0].title).not.toMatch(/₹|40,000/);
    expect(queued()[0].body).toBe('Check it.');
  });
});

// ── Tasks ────────────────────────────────────────────────────────────────────

describe('pushTaskEdited', () => {
  const actor = { userId: HEAD, organizationId: ORG, name: 'Charles' };
  const task = { id: 't1', title: 'Edit reel', dueDate: new Date('2026-10-10T00:00:00Z') };

  it('a newcomer hears "new task"; the people already on it hear the due date — once each', async () => {
    (prisma.taskAssignee.findMany as any).mockResolvedValue([{ userId: RAVI }, { userId: 'usr-sneha' }]);
    (prisma.user.findMany as any).mockImplementation(async ({ where }: any) => where.id.in.map((id: string) => person(id)));
    await pushTaskEdited(actor, task, ['usr-sneha'], '2026-10-10');
    const rows = queued();
    expect(rows.filter((r: any) => r.userId === RAVI).map((r: any) => r.title)).toEqual(['New task for you']);
    expect(rows.filter((r: any) => r.userId === 'usr-sneha').map((r: any) => r.title)).toEqual(['Due date moved: Edit reel']);
  });

  it('nothing when neither the people nor the date moved', async () => {
    await pushTaskEdited(actor, task, null, null);
    expect(prisma.taskAssignee.findMany).not.toHaveBeenCalled();
  });
});

// ── The bell ─────────────────────────────────────────────────────────────────

describe('pushNewAlerts — "Everything in my bell"', () => {
  beforeEach(() => {
    (prisma.user.findMany as any).mockImplementation(async ({ where }: any) =>
      where.notificationPreference
        ? [{ id: RAVI, email: 'r@x', name: 'Ravi', preset: RolePreset.MANAGEMENT, permissions: [] }]
        : where.id.in.map((id: string) => person(id, { pushApprovals: true, pushCalendar: true, pushTasks: true, pushBell: true })),
    );
  });

  it('only people who turned it on, and only alerts their bell shows — never the approval or calendar ones', async () => {
    (prisma.alert.findMany as any).mockResolvedValue([
      { id: 'a1', rule: 'PROJECT_OVER_ESTIMATE', message: 'Reel for Brigade: 60% done with 80% of the quote already spent. At this rate it finishes at ₹1,90,000.', entityType: 'Project', entityId: 'p1' },
      { id: 'a2', rule: 'INVOICE_OVERDUE', message: 'Invoice EL/014 for Brigade is overdue (due date passed).', entityType: 'Invoice', entityId: 'i1' },
    ]);
    await pushNewAlerts(ORG, ['a1', 'a2', 'a3']);

    const peopleAsk = (prisma.user.findMany as any).mock.calls[0][0].where;
    expect(peopleAsk.notificationPreference).toEqual({ is: { pushBell: true } });
    const alertAsk = (prisma.alert.findMany as any).mock.calls[0][0].where;
    expect(alertAsk.id).toEqual({ in: ['a1', 'a2', 'a3'] });
    expect(alertAsk.rule).toEqual({ notIn: EXTERNAL_RULES });
    expect(alertAsk.OR).toEqual([{ rule: { in: ['INVOICE_OVERDUE', 'PROJECT_OVER_ESTIMATE'] } }]);

    const rows = queued();
    expect(rows.map((r: any) => r.sourceKey)).toEqual(['alert:a1', 'alert:a2']);
    expect(rows[1]).toMatchObject({ kind: 'BELL', title: RULE_TITLE.INVOICE_OVERDUE });
    expect(rows.map((r: any) => r.body).join(' ')).not.toMatch(/₹|1,90,000/);
  });

  it('somebody whose bell shows nothing is not asked about alerts at all', async () => {
    (prisma.user.findMany as any).mockImplementation(async ({ where }: any) =>
      where.notificationPreference ? [{ id: 'usr-nothing', email: 'n@x', name: 'N', preset: RolePreset.EMPLOYEE, permissions: [] }] : [],
    );
    await pushNewAlerts(ORG, ['a1']);
    expect(prisma.alert.findMany).not.toHaveBeenCalled();
  });

  it('with the org switch off, nobody is looked up', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue(org({ pushEnabled: false }));
    await pushNewAlerts(ORG, ['a1']);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

// ── The worker ───────────────────────────────────────────────────────────────

describe('plan — summary and cap', () => {
  const morning = ist('2026-10-07T10:00:00');
  const heldRow = (i: number) => ({ id: `h${i}`, kind: 'TASKS', attempts: 0, createdAt: ist('2026-10-06T21:00:00'), dueAt: morning });
  const freshRow = (i: number) => ({ id: `f${i}`, kind: 'TASKS', attempts: 0, createdAt: morning, dueAt: morning });

  it('six held become one summary', () => {
    const p = plan([1, 2, 3, 4, 5, 6].map(heldRow), 0);
    expect(p.send).toEqual([]);
    expect(p.fold).toHaveLength(6);
  });

  it('three held go as themselves', () => {
    expect(plan([1, 2, 3].map(heldRow), 0)).toEqual({ send: ['h1', 'h2', 'h3'], fold: [] });
  });

  it('fresh ones still go as themselves beside a summary', () => {
    const p = plan([...[1, 2, 3, 4].map(heldRow), freshRow(1)], 0);
    expect(p.send).toEqual(['f1']);
    expect(p.fold).toHaveLength(4);
  });

  it('over the hourly cap folds into the summary, keeping a slot for it', () => {
    const p = plan([1, 2, 3, 4, 5].map(freshRow), CAP_PER_HOUR - 3);
    expect(p.send).toEqual(['f1', 'f2']);
    expect(p.fold).toEqual(['f3', 'f4', 'f5']);
  });

  it('at the cap, nothing goes until the hour rolls on', () => {
    expect(plan([freshRow(1)], CAP_PER_HOUR)).toEqual({ send: [], fold: [] });
  });
});

describe('runPushWorker', () => {
  const now = ist('2026-10-07T10:00:00');
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    organizationId: ORG,
    userId: RAVI,
    kind: 'TASKS',
    title: 't',
    body: 'b',
    url: '/my-work',
    dueAt: now,
    createdAt: now,
    attempts: 0,
    organization: { pushEnabled: true },
    ...over,
  });
  const devices = [
    { id: 'd-phone', endpoint: 'https://push.example/phone', p256dh: 'k', auth: 'a' },
    { id: 'd-old', endpoint: 'https://push.example/old', p256dh: 'k', auth: 'a' },
  ];

  beforeEach(() => {
    (prisma.pushSubscription.findMany as any).mockResolvedValue(devices.map((d) => ({ ...d })));
    (prisma.pushOutbox.count as any).mockResolvedValue(0);
    (prisma.pushOutbox.create as any).mockImplementation(async ({ data }: any) => ({ id: 'summary-1', attempts: 0, ...data }));
  });

  it('a 410 deletes that device; the push still counts as sent through the other', async () => {
    (prisma.pushOutbox.findMany as any).mockResolvedValue([row('o1')]);
    const deliver = vi.fn(async (d: { id: string }) => {
      if (d.id === 'd-old') throw Object.assign(new Error('Gone'), { statusCode: 410 });
    });
    const tally = await runPushWorker(now, deliver);
    expect(tally.sent).toBe(1);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 'd-old' } });
    expect(prisma.pushOutbox.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { sentAt: now, attempts: 1, lastError: null } });
  });

  it('a 404 from every device: they are deleted and the push is finished with nowhere to go', async () => {
    (prisma.pushOutbox.findMany as any).mockResolvedValue([row('o1')]);
    const deliver = vi.fn(async () => {
      throw Object.assign(new Error('Not found'), { statusCode: 404 });
    });
    await runPushWorker(now, deliver);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.pushOutbox.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { sentAt: now, attempts: 1, lastError: 'No devices' } });
  });

  it('any other failure is tried again later, and given up after three', async () => {
    const deliver = vi.fn(async () => {
      throw Object.assign(new Error('Server error'), { statusCode: 500 });
    });
    (prisma.pushOutbox.findMany as any).mockResolvedValue([row('o1')]);
    const first = await runPushWorker(now, deliver);
    expect(first.retried).toBe(1);
    const retry = (prisma.pushOutbox.update as any).mock.calls[0][0];
    expect(retry.data.attempts).toBe(1);
    expect(retry.data.sentAt).toBeUndefined();
    expect(retry.data.dueAt.getTime()).toBeGreaterThan(now.getTime());

    (prisma.pushOutbox.update as any).mockClear();
    (prisma.pushOutbox.findMany as any).mockResolvedValue([row('o1', { attempts: 2 })]);
    await runPushWorker(now, deliver);
    const last = (prisma.pushOutbox.update as any).mock.calls[0][0];
    expect(last.data.sentAt).toEqual(now);
    expect(last.data.lastError).toMatch(/^Gave up/);
  });

  it('six held overnight arrive as one summary that opens the bell', async () => {
    const held = [1, 2, 3, 4, 5, 6].map((i) => row(`h${i}`, { createdAt: ist('2026-10-06T21:00:00') }));
    (prisma.pushOutbox.findMany as any).mockResolvedValue(held);
    const payloads: string[] = [];
    const deliver = vi.fn(async (_d: unknown, payload: string) => {
      payloads.push(payload);
    });
    (prisma.pushSubscription.findMany as any).mockResolvedValue([{ ...devices[0] }]);
    const tally = await runPushWorker(now, deliver);
    expect(tally).toMatchObject({ sent: 0, summaries: 1, folded: 6 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(JSON.parse(payloads[0])).toMatchObject({ body: 'You have 6 updates in Flowzen', url: BELL_URL });
    expect(prisma.pushOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: { in: held.map((h) => h.id) } },
      data: { sentAt: now, lastError: 'In a summary' },
    });
  });

  it('with the org switch turned off since, nothing is sent', async () => {
    (prisma.pushOutbox.findMany as any).mockResolvedValue([row('o1', { organization: { pushEnabled: false } })]);
    const deliver = vi.fn();
    await runPushWorker(now, deliver);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a removed device is never tried: only the person’s current devices are sent to', async () => {
    (prisma.pushOutbox.findMany as any).mockResolvedValue([row('o1')]);
    (prisma.pushSubscription.findMany as any).mockResolvedValue([{ ...devices[0] }]);
    const deliver = vi.fn(async () => undefined);
    await runPushWorker(now, deliver);
    expect(deliver.mock.calls.map((c: any[]) => c[0].id)).toEqual(['d-phone']);
    expect((prisma.pushSubscription.findMany as any).mock.calls[0][0].where).toEqual({ userId: RAVI });
  });
});
