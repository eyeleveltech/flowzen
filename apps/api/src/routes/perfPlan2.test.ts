import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { ttlCache } from '../utils/ttlCache.js';
import { cachedTaskTypeMedians } from '../utils/taskTypeMedian.js';
import { planAlertWrites, runScannerTick } from '../workers/scanner.cron.js';

/**
 * Perf Plan 2 — the slow screens. Each change gives the same answers as
 * before, and each cache keeps and forgets what it should.
 */

const p = prisma as any;

const PEOPLE = {
  designer: { id: 'usr-des', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  boss: { id: 'usr-boss', preset: RolePreset.MANAGEMENT, permissions: ['work.own', 'work.team', 'work.all'] },
} as const;
type Who = keyof typeof PEOPLE;

const auth = (w: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[w].id,
      organizationId: 'org-1',
      email: `${w}@eyelevel.local`,
      preset: PEOPLE[w].preset,
      permissions: [...PEOPLE[w].permissions],
    })}`,
  ] as const;

beforeEach(() => {
  p.user.findUnique.mockImplementation(async ({ where }: any) => {
    const who = Object.values(PEOPLE).find((v) => v.id === where.id);
    if (!who) return null;
    return {
      id: who.id, organizationId: 'org-1', name: 'Somebody', email: 'x@eyelevel.local',
      preset: who.preset, permissions: [...who.permissions], active: true, sessionsValidFrom: null,
    };
  });
  p.organization.findUnique.mockResolvedValue({ id: 'org-1', timezone: 'Asia/Kolkata', financialYearStart: 4 });
  p.taskAssignee.findMany.mockResolvedValue([]);
  p.taskRepeat.findMany.mockResolvedValue([]);
});

// ─── The cache itself ──────────────────────────────────────────────────────

describe('ttlCache', () => {
  it('answers from the cache until the time is up, then works it out again', async () => {
    const cache = ttlCache<number>(1000);
    const load = vi.fn(async () => 42);
    expect(await cache.get('k', load, 0)).toBe(42);
    expect(await cache.get('k', load, 999)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get('k', load, 1000)).toBe(42);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between callers who ask at the same moment', async () => {
    const cache = ttlCache<number>(1000);
    let finish!: (n: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => (finish = r)));
    const both = Promise.all([cache.get('k', load), cache.get('k', load)]);
    finish(7);
    expect(await both).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never keeps a failure', async () => {
    const cache = ttlCache<number>(60_000);
    await expect(cache.get('k', async () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
    expect(await cache.get('k', async () => 5)).toBe(5);
  });

  it('forgets one organisation without touching another', async () => {
    const cache = ttlCache<string>(60_000);
    await cache.get('org-1|a', async () => 'one');
    await cache.get('org-2|a', async () => 'two');
    cache.forgetPrefix('org-1|');
    expect(await cache.get('org-1|a', async () => 'fresh')).toBe('fresh');
    expect(await cache.get('org-2|a', async () => 'fresh')).toBe('two');
  });

  it('holds no more than it is allowed, oldest out first', async () => {
    const cache = ttlCache<number>(60_000, 2);
    await cache.get('a', async () => 1);
    await cache.get('b', async () => 2);
    await cache.get('c', async () => 3);
    expect(cache.size).toBe(2);
    expect(await cache.get('a', async () => 9)).toBe(9);
  });
});

// ─── My Work ──────────────────────────────────────────────────────────────

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);
const taskRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organizationId: 'org-1',
  title: `Task ${id}`,
  workType: 'INTERNAL',
  workId: null,
  monthCardId: null,
  projectId: null,
  companyId: null,
  internalProjectId: null,
  retainerProjectId: null,
  taskType: 'DESIGN',
  dueDate: new Date(daysAgo(3).toISOString().slice(0, 10)),
  dueTime: null,
  assignedAt: daysAgo(10),
  completedAt: null,
  status: 'TODO',
  priority: 'MEDIUM',
  waitingOn: null,
  waitingSince: null,
  waitingTotalMinutes: 0,
  reopenCount: 0,
  notes: null,
  repeat: null,
  monthCard: null,
  project: null,
  internalProject: null,
  company: null,
  assignee: { id: 'usr-des', name: 'Sneha', designation: null, dept: null },
  assignees: [{ user: { id: 'usr-des', name: 'Sneha', designation: null, dept: null } }],
  assignedBy: null,
  creator: null,
  reviewer: null,
  ...over,
});

describe('My Work: finished work is the last 14 days', () => {
  const myListCall = () =>
    p.task.findMany.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.where?.assignees && a.include);

  beforeEach(() => {
    p.task.findMany.mockImplementation(async (args: any) => {
      // The medians read every finished task in the studio.
      if (args.select?.title && args.where?.status === 'DONE') return [];
      return [
        taskRow('open'),
        taskRow('done-old', { status: 'DONE', completedAt: daysAgo(9) }),
        taskRow('done-new', { status: 'DONE', completedAt: daysAgo(1) }),
      ];
    });
    p.task.findFirst.mockResolvedValue({ id: 'older-one' });
  });

  it('asks only for open work and work finished in the last 14 days', async () => {
    const res = await request(app).get('/api/tasks/my').set(...auth('designer'));
    expect(res.status).toBe(200);
    const where = myListCall().where;
    expect(where.status).toEqual({ not: 'CANCELLED' });
    expect(where.OR[0]).toEqual({ status: { not: 'DONE' } });
    const since: Date = where.OR[1].completedAt.gte;
    // The studio's midnight 13 days back: a little under or over 13–14 days ago.
    const days = (NOW - since.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThanOrEqual(14);
  });

  it('lists the finished work newest first, and says when there is older', async () => {
    const res = await request(app).get('/api/tasks/my').set(...auth('designer'));
    expect(res.body.tasks.completed.map((t: any) => t.id)).toEqual(['done-new', 'done-old']);
    expect(res.body.counts.completed).toBe(2);
    expect(res.body.tasks.overdue.map((t: any) => t.id)).toEqual(['open']);
    expect(res.body.hasOlderDone).toBe(true);
    expect(res.body.doneDays).toBe(14);
  });

  it('says there is nothing older when there is not', async () => {
    p.task.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/tasks/my').set(...auth('designer'));
    expect(res.body.hasOlderDone).toBe(false);
  });

  it('reads names, not whole client rows', async () => {
    await request(app).get('/api/tasks/my').set(...auth('designer'));
    const include = myListCall().include;
    expect(include.project).toEqual({ select: { name: true, company: { select: { name: true } } } });
    expect(include.monthCard.select.retainer).toEqual({ select: { company: { select: { name: true } } } });
  });

  it('still names the client from the lean rows', async () => {
    p.task.findMany.mockImplementation(async (args: any) =>
      args.select?.title
        ? []
        : [
            taskRow('p', { projectId: 'pr-1', project: { name: 'Brand film', company: { name: 'Delta' } } }),
            taskRow('m', { monthCardId: 'mc-1', monthCard: { month: '2026-11', retainerId: 'r-1', retainer: { company: { name: 'Carlton' } } } }),
          ],
    );
    const res = await request(app).get('/api/tasks/my').set(...auth('designer'));
    const rows = res.body.tasks.overdue;
    expect(rows.find((t: any) => t.id === 'p')).toMatchObject({ clientName: 'Delta', projectName: 'Brand film' });
    expect(rows.find((t: any) => t.id === 'm')).toMatchObject({ clientName: 'Carlton', monthCardMonth: '2026-11', retainerId: 'r-1' });
  });
});

describe('My Work: Show older', () => {
  it('pages back through older finished work, 50 at a time, newest first', async () => {
    p.task.findMany.mockImplementation(async (args: any) =>
      args.select?.title ? [] : Array.from({ length: 51 }, (_, i) => taskRow(`d${i}`, { status: 'DONE', completedAt: daysAgo(20 + i) })),
    );
    const res = await request(app).get('/api/tasks/my/done?skip=50').set(...auth('designer'));
    expect(res.status).toBe(200);
    const call = p.task.findMany.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.take);
    expect(call).toMatchObject({ skip: 50, take: 51, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }] });
    expect(call.where).toMatchObject({ status: 'DONE', assignees: { some: { userId: 'usr-des' } }, deletedAt: null });
    expect(call.where.completedAt.lt).toBeInstanceOf(Date);
    expect(res.body.tasks).toHaveLength(50);
    expect(res.body).toMatchObject({ hasMore: true, nextSkip: 100 });
    expect(res.body.tasks[0]).toMatchObject({ id: 'd0', isDone: true });
  });

  it('only ever this person’s own', async () => {
    p.task.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/tasks/my/done').set(...auth('boss'));
    const call = p.task.findMany.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.take);
    expect(call.where.assignees).toEqual({ some: { userId: 'usr-boss' } });
    expect(call.skip).toBe(0);
    expect(res.body).toMatchObject({ tasks: [], hasMore: false });
  });
});

describe('task-type medians', () => {
  it('are worked out once per studio in ten minutes, the same as fresh', async () => {
    const done = [10, 20, 30].map((h) => ({
      title: 'Reel edit',
      assignedAt: new Date('2026-11-02T04:30:00Z'),
      completedAt: new Date(new Date('2026-11-02T04:30:00Z').getTime() + h * 60_000),
      waitingTotalMinutes: 0,
    }));
    p.task.findMany.mockResolvedValue(done);
    const first = await cachedTaskTypeMedians('org-1');
    const again = await cachedTaskTypeMedians('org-1');
    expect(again).toBe(first);
    expect(p.task.findMany).toHaveBeenCalledTimes(1);
    expect(first.get('title:reel edit')).toBe(20);
    await cachedTaskTypeMedians('org-2');
    expect(p.task.findMany).toHaveBeenCalledTimes(2);
  });
});

// ─── All tasks ────────────────────────────────────────────────────────────

describe('All tasks: the filter lists', () => {
  beforeEach(() => {
    p.task.findMany.mockResolvedValue([
      taskRow('a', {
        monthCardId: 'mc-1',
        monthCard: { month: '2026-11', retainerId: 'r-1', retainer: { companyId: 'c-1', company: { name: 'Carlton' } } },
      }),
    ]);
    p.project.findMany.mockResolvedValue([
      { id: 'pr-1', name: 'Brand film', isSample: false, company: { id: 'c-2', name: 'Delta' }, _count: { tasks: 2 } },
    ]);
    p.monthCard.findMany.mockResolvedValue([{ retainer: { company: { id: 'c-1', name: 'Carlton' } } }]);
    p.company.findMany.mockResolvedValue([]);
    p.task.count.mockResolvedValue(0);
    p.retainerProject.findMany.mockResolvedValue([]);
    p.internalProject.findMany.mockResolvedValue([]);
  });

  it('are worked out once in five minutes, and say the same thing', async () => {
    const first = await request(app).get('/api/tasks/all').set(...auth('boss'));
    const second = await request(app).get('/api/tasks/all?status=DONE').set(...auth('boss'));
    expect(first.status).toBe(200);
    expect(p.project.findMany).toHaveBeenCalledTimes(1);
    for (const res of [first, second]) {
      expect(res.body.clients).toEqual([
        { id: 'c-1', name: 'Carlton' },
        { id: 'c-2', name: 'Delta' },
      ]);
      expect(res.body.projects).toEqual([{ value: 'P:pr-1', name: 'Brand film', client: 'Delta', companyId: 'c-2' }]);
    }
  });

  it('still says whose work a row is, from the lean includes', async () => {
    const res = await request(app).get('/api/tasks/all').set(...auth('boss'));
    expect(res.body.tasks[0]).toMatchObject({ clientName: 'Carlton', companyId: 'c-1', monthCardMonth: '2026-11', retainerId: 'r-1' });
    const include = p.task.findMany.mock.calls.at(-1)[0].include;
    expect(include.project.select).toEqual({ name: true, companyId: true, company: { select: { name: true } } });
  });
});

// ─── The scanner ──────────────────────────────────────────────────────────

describe('the scanner, one read of the open alerts', () => {
  const a = (entityId: string, severity: 'HIGH' | 'MED' | 'LOW', message: string) => ({
    rule: 'TASK_OVERDUE',
    entityType: 'Task',
    entityId,
    severity,
    message,
  });

  it('updates what changed, leaves what did not, creates what is new', () => {
    const plan = planAlertWrites(
      [a('t1', 'HIGH', 'worse'), a('t2', 'MED', 'same'), a('t3', 'MED', 'new')],
      [
        { id: 'al-1', ...a('t1', 'MED', 'was'), },
        { id: 'al-2', ...a('t2', 'MED', 'same') },
      ],
    );
    expect(plan.updates).toEqual([{ id: 'al-1', severity: 'HIGH', message: 'worse' }]);
    expect(plan.creates).toEqual([a('t3', 'MED', 'new')]);
  });

  it('creates an alert evaluated twice once, ending with its last words — as the one-at-a-time loop did', () => {
    const plan = planAlertWrites([a('t9', 'MED', 'first'), a('t9', 'HIGH', 'second')], []);
    expect(plan.creates).toEqual([a('t9', 'HIGH', 'second')]);
    expect(plan.updates).toEqual([]);
  });

  it('updates an open alert evaluated twice to the last words, once', () => {
    const plan = planAlertWrites([a('t1', 'MED', 'one'), a('t1', 'HIGH', 'two')], [{ id: 'al-1', ...a('t1', 'MED', 'was') }]);
    expect(plan.updates).toEqual([{ id: 'al-1', severity: 'HIGH', message: 'two' }]);
  });

  it('uses the first open alert when there are two, as findFirst did', () => {
    const plan = planAlertWrites([a('t1', 'HIGH', 'now')], [
      { id: 'al-a', ...a('t1', 'MED', 'x') },
      { id: 'al-b', ...a('t1', 'MED', 'x') },
    ]);
    expect(plan.updates).toEqual([{ id: 'al-a', severity: 'HIGH', message: 'now' }]);
  });

  it('never runs two scans at once', async () => {
    let release!: (v: unknown[]) => void;
    p.organization.findMany.mockImplementation(() => new Promise((r) => (release = r)));
    const first = runScannerTick('Test');
    expect(await runScannerTick('Test')).toBe('skipped');
    release([]);
    expect(await first).toBe('ran');
    // And once it has finished, the next tick runs.
    p.organization.findMany.mockResolvedValue([]);
    expect(await runScannerTick('Test')).toBe('ran');
  });
});
