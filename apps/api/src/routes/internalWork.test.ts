import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { evaluateAgencyHealthRules } from '../workers/scanner.cron.js';
import { alertClausesFor } from './notifications.js';
import { projectProgress } from '../services/internalWork.js';
import { draftTask } from '../services/zenDraft.js';

/**
 * Internal work plan: tasks with no project, better internal projects, and
 * the owner's one reminder.
 *
 * Today, throughout: Wednesday 14 October 2026, in Chennai.
 */

const p = prisma as any;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const PEOPLE = {
  head: { id: 'usr-head', preset: RolePreset.HEAD, permissions: ['work.own', 'work.team', 'work.all'] },
  designer: { id: 'usr-des', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  boss: { id: 'usr-boss', preset: RolePreset.MANAGEMENT, permissions: [] as string[] },
} as const;
type Who = keyof typeof PEOPLE;
const auth = (w: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({ userId: PEOPLE[w].id, organizationId: 'org-1', email: `${w}@x`, preset: PEOPLE[w].preset, permissions: [...PEOPLE[w].permissions] } as never)}`,
  ] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T06:00:00Z'));
  p.$transaction.mockImplementation(async (fn: any) => fn(p));
  p.user.findUnique.mockImplementation(async ({ where }: any) => {
    const who = Object.values(PEOPLE).find((x) => x.id === where.id);
    return who ? { ...who, organizationId: 'org-1', name: who.id, email: 'x@x', active: true, sessionsValidFrom: null } : null;
  });
  // Everybody named is on the team.
  p.user.findMany.mockImplementation(async ({ where }: any) => (where?.id?.in ?? []).map((id: string) => ({ id })));
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', fyStartMonth: 4 });
  p.activity.create.mockResolvedValue({});
  p.task.create.mockImplementation(async ({ data }: any) => ({
    ...data,
    id: 'task-new',
    assignees: (data.assignees?.create ?? []).map((a: any) => ({ user: { id: a.userId, name: a.userId, designation: null } })),
    reviews: [],
  }));
});
afterEach(() => vi.useRealTimers());

// ── 1. A task with no project ───────────────────────────────────────────────

describe('an internal task with no project', () => {
  it('is created, filed under nothing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Renew domain', dueDate: '2026-10-20', workType: 'INTERNAL' });
    expect(res.status).toBe(201);
    const { data } = p.task.create.mock.calls.at(-1)[0];
    expect(data).toMatchObject({ workType: 'INTERNAL', internalProjectId: null, projectId: null, monthCardId: null, companyId: null });
    expect(data.assignees.create).toEqual([{ userId: 'usr-des' }]);
  });

  it('still files under an internal project when one is chosen', async () => {
    p.internalProject.findFirst.mockResolvedValue({ id: 'ip-hiring' });
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Shortlist', dueDate: '2026-10-20', workType: 'INTERNAL', internalProjectId: 'ip-hiring' });
    expect(res.status).toBe(201);
    expect(p.task.create.mock.calls.at(-1)[0].data.internalProjectId).toBe('ip-hiring');
  });
});

describe('the client rule is unchanged', () => {
  it('a task on a retainer month still lands in a retainer project — the default when none is named', async () => {
    p.monthCard.findFirst.mockResolvedValue({ retainer: { id: 'ret-1', ownerId: 'usr-head' } });
    p.retainerProject.findFirst.mockResolvedValue({ id: 'rp-default' });
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('head'))
      .send({ title: 'October reels', dueDate: '2026-10-20', workType: 'MONTH_CARD', monthCardId: 'mc-oct' });
    expect(res.status).toBe(201);
    expect(p.task.create.mock.calls.at(-1)[0].data).toMatchObject({ monthCardId: 'mc-oct', retainerProjectId: 'rp-default' });
  });

  it('client work cannot be filed under an internal project', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('head'))
      .send({ title: 'Site build', dueDate: '2026-10-20', workType: 'PROJECT', projectId: 'pr-1', internalProjectId: 'ip-hiring' });
    expect(res.status).toBe(400);
    expect(p.task.create).not.toHaveBeenCalled();
  });
});

// ── 2. "Internal — no project" on All work ─────────────────────────────────

describe('All work: noProject=1', () => {
  beforeEach(() => {
    p.task.findMany.mockResolvedValue([]);
    p.task.count.mockResolvedValue(0);
    for (const m of ['project', 'monthCard', 'company', 'retainerProject']) p[m].findMany.mockResolvedValue([]);
  });
  const clientClause = () => {
    const { where } = p.task.findMany.mock.calls[0][0];
    return where.AND.find((c: any) => c.OR);
  };

  it('is internal work filed under no project of any kind', async () => {
    const res = await request(app).get('/api/tasks/all?noProject=1').set(...auth('boss'));
    expect(res.status).toBe(200);
    expect(clientClause()).toEqual({
      OR: [{ projectId: null, monthCardId: null, companyId: null, internalProjectId: null }],
    });
  });

  it('sits in the same OR as the clients, so "no project and Carlton" is both, not neither', async () => {
    await request(app).get('/api/tasks/all?noProject=1&companyId=co-carlton').set(...auth('boss'));
    const or = clientClause().OR;
    expect(or).toContainEqual({ companyId: { in: ['co-carlton'] } });
    expect(or).toContainEqual({ projectId: null, monthCardId: null, companyId: null, internalProjectId: null });
  });

  it('a Head still sees only their scope', async () => {
    p.department.findMany.mockResolvedValue([{ id: 'd-video', name: 'Video' }]);
    p.user.findMany.mockResolvedValue([{ id: 'usr-vid', departmentId: 'd-video' }]);
    await request(app).get('/api/tasks/all?noProject=1').set(...auth('head'));
    const { where } = p.task.findMany.mock.calls[0][0];
    // taskInScope wraps the filters: the no-project clause AND the Head's people.
    expect(JSON.stringify(where)).toContain('"internalProjectId":null');
    expect(JSON.stringify(where)).toContain('usr-vid');
  });
});

// ── 3. Internal projects: progress, days left ──────────────────────────────

const t = (id: string, status: string, due: string, who: string[] = ['usr-des']) => ({
  id,
  title: id,
  status,
  dueDate: day(due),
  assignees: who.map((u) => ({ user: { id: u, name: u === 'usr-des' ? 'Sneha' : 'Ravi' } })),
});

describe('internal project progress', () => {
  it('% done, open, overdue, next due, people and days left — cancelled counts for nothing', () => {
    const progress = projectProgress(
      { status: 'ACTIVE', targetDate: day('2026-10-19') },
      [
        t('done', 'DONE', '2026-10-01'),
        t('late', 'TODO', '2026-10-10', ['usr-des', 'usr-ravi']),
        t('soon', 'IN_PROGRESS', '2026-10-16'),
        t('review', 'IN_REVIEW', '2026-10-09'),
        t('dropped', 'CANCELLED', '2026-10-02'),
      ],
      '2026-10-14',
    );
    expect(progress).toMatchObject({ percentDone: 25, total: 4, done: 1, open: 3, overdue: 1, daysLeft: 5, pastTarget: false });
    // In review is not its people's overdue; the next due is the earliest open task.
    expect(progress.nextDue).toEqual({ id: 'review', title: 'review', dueDate: '2026-10-09' });
    expect(progress.people).toEqual([
      { id: 'usr-ravi', name: 'Ravi', open: 1 },
      { id: 'usr-des', name: 'Sneha', open: 3 },
    ]);
  });

  it('past its target with work open is overdue; with nothing open, or closed, it is not', () => {
    const open = [t('a', 'TODO', '2026-10-10')];
    expect(projectProgress({ status: 'ACTIVE', targetDate: day('2026-10-11') }, open, '2026-10-14')).toMatchObject({ daysLeft: -3, pastTarget: true });
    expect(projectProgress({ status: 'ACTIVE', targetDate: day('2026-10-11') }, [t('a', 'DONE', '2026-10-10')], '2026-10-14').pastTarget).toBe(false);
    expect(projectProgress({ status: 'DONE', targetDate: day('2026-10-11') }, open, '2026-10-14').pastTarget).toBe(false);
    // No tasks: no percentage, rather than a 0% that reads as stuck.
    expect(projectProgress({ status: 'ACTIVE', targetDate: null }, [], '2026-10-14')).toMatchObject({ percentDone: null, daysLeft: null });
  });

  it('GET /internal-projects carries it, with department and dates, and the "General — no project" counts', async () => {
    p.internalProject.findMany.mockResolvedValue([
      {
        id: 'ip-site',
        name: 'Website revamp',
        status: 'ACTIVE',
        startDate: day('2026-10-01'),
        targetDate: day('2026-10-19'),
        department: { id: 'd-dev', name: 'Development' },
        owner: { id: 'usr-head', name: 'Dinesh' },
        tasks: [t('done', 'DONE', '2026-10-01'), t('soon', 'TODO', '2026-10-16')],
      },
    ]);
    p.task.findMany.mockResolvedValue([
      { status: 'TODO', dueDate: day('2026-10-10') },
      { status: 'IN_REVIEW', dueDate: day('2026-10-10') },
      { status: 'ON_HOLD', dueDate: day('2026-10-20') },
    ]);
    const res = await request(app).get('/api/internal-projects').set(...auth('boss'));
    expect(res.status).toBe(200);
    const [ip] = res.body.projects;
    expect(ip).toMatchObject({
      department: { id: 'd-dev', name: 'Development' },
      targetDate: '2026-10-19T00:00:00.000Z',
      progress: { percentDone: 50, open: 1, overdue: 0, daysLeft: 5 },
      taskCounts: { total: 2, done: 1, open: 1, late: 0 },
    });
    expect(res.body.general).toEqual({ open: 3, overdue: 1 });
    // General is internal work filed under no project, still owed.
    const { where } = p.task.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ projectId: null, monthCardId: null, companyId: null, internalProjectId: null });
  });
});

describe('editing an internal project', () => {
  beforeEach(() => {
    p.internalProject.findFirst.mockResolvedValue({ id: 'ip-site', name: 'Website revamp', status: 'ACTIVE', startDate: day('2026-10-01'), targetDate: null });
    p.internalProject.update.mockImplementation(async ({ data }: any) => ({ id: 'ip-site', name: 'Website revamp', status: 'ACTIVE', targetDate: data.targetDate ?? null, tasks: [], ...data }));
  });

  it('takes a target date and a department', async () => {
    p.department.findFirst.mockResolvedValue({ id: 'd-dev' });
    const res = await request(app)
      .patch('/api/internal-projects/ip-site')
      .set(...auth('head'))
      .send({ targetDate: '2026-10-19', departmentId: 'd-dev' });
    expect(res.status).toBe(200);
    expect(p.internalProject.update.mock.calls[0][0].data).toMatchObject({ targetDate: day('2026-10-19'), departmentId: 'd-dev' });
    expect(res.body.project.progress.daysLeft).toBe(5);
  });

  it('refuses a target before the start, and somebody else’s department', async () => {
    const early = await request(app).patch('/api/internal-projects/ip-site').set(...auth('head')).send({ targetDate: '2026-09-30' });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/can't be before the start/);
    p.department.findFirst.mockResolvedValue(null);
    const theirs = await request(app).patch('/api/internal-projects/ip-site').set(...auth('head')).send({ departmentId: 'd-elsewhere' });
    expect(theirs.status).toBe(400);
    expect(p.internalProject.update).not.toHaveBeenCalled();
  });
});

// ── 4. The owner's one reminder ─────────────────────────────────────────────

describe('an internal project past its target date', () => {
  beforeEach(() => {
    p.proposal.findMany.mockResolvedValue([]);
    for (const m of ['proforma', 'retainer', 'invoice', 'project', 'user', 'company', 'monthCard', 'asset', 'assetMovement', 'assetMaintenance']) {
      p[m].findMany.mockResolvedValue([]);
    }
    p.task.findMany.mockResolvedValue([]);
    p.task.groupBy.mockResolvedValue([]);
    p.peopleAllocation.groupBy.mockResolvedValue([]);
    p.peopleAllocation.count.mockResolvedValue(0);
  });

  it('raises one LOW alert for it, about the project, only while work is open', async () => {
    p.internalProject.findMany.mockResolvedValue([
      { id: 'ip-site', name: 'Website revamp', targetDate: day('2026-10-11'), _count: { tasks: 2 } },
      { id: 'ip-done-work', name: 'Hiring', targetDate: day('2026-10-01'), _count: { tasks: 0 } },
    ]);
    const alerts = (await evaluateAgencyHealthRules('org-1')).filter((a) => a.rule === 'INTERNAL_PROJECT_OVERDUE');
    expect(alerts).toEqual([
      {
        rule: 'INTERNAL_PROJECT_OVERDUE',
        severity: 'LOW',
        entityType: 'InternalProject',
        entityId: 'ip-site',
        message: 'Website revamp passed its target date (11 Oct) with 2 tasks still open.',
      },
    ]);
    // Only running projects with an owner, past the studio's today.
    const { where } = p.internalProject.findMany.mock.calls.at(-1)[0];
    expect(where).toMatchObject({ status: 'ACTIVE', ownerId: { not: null }, targetDate: { lt: day('2026-10-14') } });
  });

  it('reaches the owner, and nobody else', async () => {
    const session = (id: string, preset: RolePreset, permissions: string[]) =>
      ({ userId: id, organizationId: 'org-1', email: 'x', name: id, preset, permissions, active: true }) as any;
    p.internalProject.findMany.mockImplementation(async ({ where }: any) => (where.ownerId === 'usr-head' ? [{ id: 'ip-site' }] : []));
    p.taskApprover.findMany.mockResolvedValue([]);
    p.approvalEscalationContact.findMany.mockResolvedValue([]);
    p.alert.findMany.mockResolvedValue([]);

    const owner = await alertClausesFor(session('usr-head', RolePreset.HEAD, ['work.own', 'work.team', 'work.all']));
    expect(owner).toContainEqual({ rule: { in: ['INTERNAL_PROJECT_OVERDUE'] }, entityType: 'InternalProject', entityId: { in: ['ip-site'] } });

    // Management sees every rule its permissions open — this one is not among them.
    const boss = await alertClausesFor(session('usr-boss', RolePreset.MANAGEMENT, ['setup.admin']));
    expect(JSON.stringify(boss)).not.toContain('INTERNAL_PROJECT_OVERDUE');
  });
});

// ── 5. Zen ──────────────────────────────────────────────────────────────────

describe("Zen's draftTask", () => {
  beforeEach(() => {
    p.user.findMany.mockResolvedValue([{ id: 'usr-des', name: 'Sneha', dept: 'Design' }]);
    p.task.findFirst.mockResolvedValue(null);
    p.task.findMany.mockResolvedValue([]);
  });

  it('drafts an internal task with no project, and says so', async () => {
    const out = (await draftTask({ title: 'Renew domain', dueDate: '2026-10-20' }, 'org-1', 'usr-des')) as any;
    expect(out.draft.body).toMatchObject({ workType: 'INTERNAL', title: 'Renew domain' });
    expect(out.draft.body.internalProjectId).toBeUndefined();
    expect(out.draft.shows.belongsTo).toBe('Internal — no project (general internal task)');
  });

  it('files it under a named internal project, or asks which', async () => {
    p.internalProject.findMany.mockResolvedValue([
      { id: 'ip-hiring', name: 'Hiring' },
      { id: 'ip-site', name: 'Website revamp' },
    ]);
    const out = (await draftTask({ title: 'Shortlist', dueDate: '2026-10-20', internalProject: 'hiring' }, 'org-1', 'usr-des')) as any;
    expect(out.draft.body.internalProjectId).toBe('ip-hiring');
    expect(out.draft.shows.belongsTo).toBe('Internal — Hiring');

    const unknown = (await draftTask({ title: 'Shortlist', dueDate: '2026-10-20', internalProject: 'payroll' }, 'org-1', 'usr-des')) as any;
    expect(unknown.needs).toEqual(['internalProject']);
    expect(unknown.candidates.internalProjects).toEqual(['Hiring', 'Website revamp']);
  });
});
