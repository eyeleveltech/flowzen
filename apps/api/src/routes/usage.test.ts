import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { screenFor } from '../services/usageScreens.js';
import { composeUsageSummary, notUsingLastWeek } from '../services/usageSummary.js';
import { recordView } from './usage.js';
import { cleanUpUsage } from '../workers/usageCleanup.cron.js';
import { sendMondayBriefs } from '../workers/brief.cron.js';
import { composeMondayBrief } from './brief.js';
import { sendMail } from '../utils/mailer.js';

// The brief email is checked for who gets which version — nothing is ever sent.
vi.mock('../utils/mailer.js', async (orig) => ({ ...(await orig<object>()), sendMail: vi.fn() }));
vi.mock('./brief.js', async (orig) => ({ ...(await orig<object>()), composeMondayBrief: vi.fn() }));

/**
 * Usage tracking: which screens people open, for Management.
 *
 *   · a path becomes a screen's name, never an address — no ids, no search;
 *   · the same screen within ten minutes is one view, and last-seen moves;
 *   · the summary adds up the way a person counting by hand would;
 *   · nobody but Management can read it;
 *   · the brief names who did not use it last week; rows go after 90 days.
 */

const ORG = {
  timezone: 'Asia/Kolkata',
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [] as string[],
  workingHoursStart: '10:00',
  workingHoursEnd: '19:00',
};

const PEOPLE = {
  boss: { id: 'usr-boss', name: 'Akmal', preset: RolePreset.MANAGEMENT },
  head: { id: 'usr-head', name: 'Janani', preset: RolePreset.HEAD },
  emp: { id: 'usr-emp', name: 'Ravi', preset: RolePreset.EMPLOYEE },
} as const;

const auth = (who: keyof typeof PEOPLE) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[who].id,
      organizationId: 'org-1',
      email: 'x@y',
      preset: PEOPLE[who].preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[PEOPLE[who].preset]],
    })}`,
  ] as const;

/** 10:42 in Chennai on a day, as the moment it is. */
const ist = (day: string, hhmm = '10:42') => new Date(new Date(`${day}T${hhmm}:00Z`).getTime() - 330 * 60_000);

beforeEach(() => {
  (prisma.organization.findUnique as any).mockResolvedValue(ORG);
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const p = Object.values(PEOPLE).find((x) => x.id === where.id);
    return p
      ? { id: p.id, organizationId: 'org-1', name: p.name, email: 'x@y', preset: p.preset, permissions: [], active: true, sessionsValidFrom: null }
      : null;
  });
});

describe('a path is a screen, by name', () => {
  it.each([
    ['/my-work', 'my-work'],
    ['/companies/cmabc123?q=pavilion', 'client-page'],
    ['/companies', 'companies'],
    ['/money', 'money'],
    ['/money?tab=billing', 'money-billing'],
    ['/money?tab=costs&x=1', 'money-costs'],
    ['/retainers/r1/projects/p1', 'retainer-project-page'],
    ['/calendar?event=ev1', 'calendar'],
    ['/members', 'team'],
  ])('%s → %s', (path, key) => {
    expect(screenFor(path)).toBe(key);
  });

  it.each([['/nowhere'], ['/companies/a/b'], [''], ['https://elsewhere.example/my-work'], [42 as unknown as string]])(
    'ignores %s',
    (path) => {
      expect(screenFor(path)).toBeNull();
    },
  );
});

describe('the ten-minute rule', () => {
  const at = ist('2026-10-05', '10:00');

  it('makes the row on the first open of the day', async () => {
    (prisma.usageDay.findUnique as any).mockResolvedValue(null);
    expect(await recordView('org-1', 'usr-emp', 'my-work', at)).toBe('counted');
    expect((prisma.usageDay.create as any).mock.calls[0][0].data).toEqual({
      organizationId: 'org-1',
      userId: 'usr-emp',
      day: new Date('2026-10-05T00:00:00Z'),
      screen: 'my-work',
      views: 1,
      firstAt: at,
      lastAt: at,
    });
  });

  it('within ten minutes only moves last-seen; after that it counts again', async () => {
    (prisma.usageDay.findUnique as any).mockResolvedValueOnce({ id: 'u1', lastAt: new Date(at.getTime() - 5 * 60_000) });
    expect(await recordView('org-1', 'usr-emp', 'my-work', at)).toBe('seen');
    expect((prisma.usageDay.update as any).mock.calls[0][0]).toEqual({ where: { id: 'u1' }, data: { lastAt: at } });

    (prisma.usageDay.findUnique as any).mockResolvedValueOnce({ id: 'u1', lastAt: new Date(at.getTime() - 15 * 60_000) });
    expect(await recordView('org-1', 'usr-emp', 'my-work', at)).toBe('counted');
    expect((prisma.usageDay.update as any).mock.calls[1][0]).toEqual({ where: { id: 'u1' }, data: { views: { increment: 1 }, lastAt: at } });
  });

  it('keeps only the screen name for a client page opened with a search, and nothing for an unknown path', async () => {
    (prisma.usageDay.findUnique as any).mockResolvedValue(null);
    await request(app).post('/api/usage/view').set(...auth('emp')).send({ path: '/companies/cmabc123?q=pavilion%20club' }).expect(204);
    const stored = JSON.stringify((prisma.usageDay.create as any).mock.calls[0][0].data);
    expect(stored).toContain('"screen":"client-page"');
    expect(stored).not.toMatch(/cmabc123|pavilion/);

    (prisma.usageDay.create as any).mockClear();
    await request(app).post('/api/usage/view').set(...auth('emp')).send({ path: '/secret/thing' }).expect(204);
    expect(prisma.usageDay.create).not.toHaveBeenCalled();
    expect(prisma.usageDay.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('composeUsageSummary', () => {
  /*
   * Week of Mon 5 – Sun 11 Oct (Mon–Sat working). Today is Sat 10 Oct.
   *   Ravi:   Mon and Wed — My Work 3+2, Client page 1, Money 1; 4 changes
   *   Janani: last active Fri 2 Oct (before the period) — 7 working days since
   *           (Sat 3, Mon 5 … Sat 10; Sunday is off)
   *   Akmal:  never opened Flowzen
   */
  const now = ist('2026-10-10', '12:00');
  beforeEach(() => {
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'usr-boss', name: 'Akmal', dept: 'Management', createdAt: new Date('2026-01-01') },
      { id: 'usr-head', name: 'Janani', dept: 'Design', createdAt: new Date('2026-01-01') },
      { id: 'usr-emp', name: 'Ravi', dept: 'Video', createdAt: new Date('2026-01-01') },
    ]);
    (prisma.usageDay.findMany as any).mockResolvedValue([
      { userId: 'usr-emp', day: new Date('2026-10-05T00:00:00Z'), screen: 'my-work', views: 3 },
      { userId: 'usr-emp', day: new Date('2026-10-05T00:00:00Z'), screen: 'client-page', views: 1 },
      { userId: 'usr-emp', day: new Date('2026-10-07T00:00:00Z'), screen: 'my-work', views: 2 },
      { userId: 'usr-emp', day: new Date('2026-10-07T00:00:00Z'), screen: 'money', views: 1 },
      { userId: 'usr-head', day: new Date('2026-10-02T00:00:00Z'), screen: 'my-work', views: 4 },
      // A deactivated account's rows are not counted.
      { userId: 'usr-gone', day: new Date('2026-10-07T00:00:00Z'), screen: 'my-work', views: 9 },
    ]);
    (prisma.usageDay.groupBy as any).mockResolvedValue([
      { userId: 'usr-emp', _max: { lastAt: ist('2026-10-07', '16:20') } },
      { userId: 'usr-head', _max: { lastAt: ist('2026-10-02', '11:00') } },
    ]);
    (prisma.activity.groupBy as any).mockResolvedValue([{ actorId: 'usr-emp', _count: { _all: 4 } }]);
  });

  it('adds up the way a hand count does', async () => {
    const s = await composeUsageSummary('org-1', { from: '2026-10-05', to: '2026-10-11', now });
    expect(s.period).toEqual({ from: '2026-10-05', to: '2026-10-11', workingDays: 6 });
    expect(s).toMatchObject({ activeInPeriod: 1, totalPeople: 3, activeToday: 0 });

    const [akmal, janani, ravi] = s.people;
    // Least recently active first: never, then the longest ago.
    expect([akmal.user.name, janani.user.name, ravi.user.name]).toEqual(['Akmal', 'Janani', 'Ravi']);
    expect(akmal).toMatchObject({ lastActiveAt: null, daysActive: 0, changes: 0, inactiveWorkingDays: null, topScreens: [] });
    expect(janani).toMatchObject({ daysActive: 0, inactiveWorkingDays: 7 });
    expect(ravi).toMatchObject({ daysActive: 2, changes: 4, topScreens: ['My Work', 'Client page', 'Money'], inactiveWorkingDays: 3 });

    // Sign-ins and the system's own rows are not changes.
    const where = (prisma.activity.groupBy as any).mock.calls[0][0].where;
    expect(where.actorId).toEqual({ not: null });
    expect(where.verb.notIn).toContain('signed_in');

    // Fourteen working days for the chart, ending with the period.
    expect(s.perDay).toHaveLength(14);
    expect(s.perDay.at(-1)).toEqual({ day: '2026-10-10', activePeople: 0 });
    expect(s.perDay.find((d) => d.day === '2026-10-07')).toEqual({ day: '2026-10-07', activePeople: 1 });
    expect(s.perDay.find((d) => d.day === '2026-10-02')).toEqual({ day: '2026-10-02', activePeople: 1 });
  });

  it("names last week's non-users for the brief, leaving out anybody new this week", async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'usr-boss', name: 'Akmal', dept: 'Management', createdAt: new Date('2026-01-01') },
      { id: 'usr-head', name: 'Janani', dept: 'Design', createdAt: new Date('2026-01-01') },
      { id: 'usr-emp', name: 'Ravi', dept: 'Video', createdAt: new Date('2026-01-01') },
      { id: 'usr-new', name: 'Neha', dept: 'Design', createdAt: ist('2026-10-10', '09:00') },
    ]);
    // Monday 12 Oct: last week is 5–11 Oct.
    const brief = await notUsingLastWeek('org-1', ist('2026-10-12', '07:00'));
    expect([brief.from, brief.to]).toEqual(['2026-10-05', '2026-10-11']);
    expect(brief.line).toBe('Akmal (never), Janani (last active 2 Oct)');
  });

  it('says so when everybody used it', async () => {
    (prisma.user.findMany as any).mockResolvedValue([{ id: 'usr-emp', name: 'Ravi', dept: 'Video', createdAt: new Date('2026-01-01') }]);
    const brief = await notUsingLastWeek('org-1', ist('2026-10-12', '07:00'));
    expect(brief.line).toBe('Everyone used Flowzen last week.');
  });
});

describe('who can see it', () => {
  beforeEach(() => {
    (prisma.user.findMany as any).mockResolvedValue([]);
    (prisma.usageDay.findMany as any).mockResolvedValue([]);
    (prisma.usageDay.groupBy as any).mockResolvedValue([]);
    (prisma.activity.groupBy as any).mockResolvedValue([]);
  });

  it('answers Management, and refuses a Head and an Employee', async () => {
    expect((await request(app).get('/api/usage/summary?days=30').set(...auth('boss'))).status).toBe(200);
    expect((await request(app).get('/api/usage/summary').set(...auth('head'))).status).toBe(403);
    expect((await request(app).get('/api/usage/summary').set(...auth('emp'))).status).toBe(403);
  });
});

describe('the 90-day clean-up', () => {
  it('deletes usage rows older than 90 days, and never touches the Activity log', async () => {
    (prisma.usageDay.deleteMany as any).mockResolvedValue({ count: 12 });
    expect(await cleanUpUsage(new Date('2026-10-02T12:00:00Z'))).toBe(12);
    expect((prisma.usageDay.deleteMany as any).mock.calls[0][0]).toEqual({ where: { day: { lt: new Date('2026-07-04T00:00:00Z') } } });
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
  });
});

describe('the Monday brief email', () => {
  afterEach(() => vi.useRealTimers());

  it('carries "Not using Flowzen" to Management, and not to anybody else granted the brief', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T06:30:00Z')); // a Monday, wherever this runs
    (prisma.organization.findMany as any).mockResolvedValue([{ id: 'org-1', name: 'EyeLevel' }]);
    (prisma.activity.findFirst as any).mockResolvedValue(null);
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'usr-boss', organizationId: 'org-1', email: 'boss@x', name: 'Akmal', preset: 'MANAGEMENT', permissions: [], active: true },
      { id: 'usr-head', organizationId: 'org-1', email: 'head@x', name: 'Janani', preset: 'HEAD', permissions: ['reports.read'], active: true },
    ]);
    // An empty week: the point here is only who gets the usage block.
    const nothing = { last: 0, before: 0 };
    vi.mocked(composeMondayBrief).mockResolvedValue({
      generatedAt: '2026-10-05T01:30:00.000Z',
      currency: 'INR',
      weeks: { last: { from: '2026-09-28', to: '2026-10-04' }, before: { from: '2026-09-21', to: '2026-09-27' } },
      scoreboard: {
        cashCollected: nothing,
        invoiced: { last: { amount: 0, count: 0 }, before: { amount: 0, count: 0 } },
        dealsWon: { last: { count: 0, value: 0 }, before: { count: 0, value: 0 } },
        proposalsSent: nothing,
        tasksDone: { last: { count: 0, onTime: 0 }, before: { count: 0, onTime: 0 } },
        approvals: [],
      },
      needsAction: [],
      risks: [],
      comingUp: { events: [], invoicesDue: [], projectsEnding: [], renewals: [] },
      team: [],
      summary: null,
      notUsingFlowzen: { title: 'Not using Flowzen', from: '2026-09-28', to: '2026-10-04', people: [], line: 'Ravi (never)' },
    } as any);

    await sendMondayBriefs();

    expect(composeMondayBrief).toHaveBeenCalledWith('org-1', expect.objectContaining({ includeUsage: true }));
    const html = Object.fromEntries(vi.mocked(sendMail).mock.calls.map(([, m]: any) => [m.to, m.html as string]));
    expect(html['boss@x']).toMatch(/Not using Flowzen<\/h3><p>Ravi \(never\)<\/p>/);
    expect(html['head@x']).toBeDefined();
    expect(html['head@x']).not.toContain('Not using Flowzen');
    expect(html['head@x']).not.toContain('Ravi');
  });
});
