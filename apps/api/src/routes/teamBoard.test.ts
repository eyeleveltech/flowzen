import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { inMyWorkOrder, nextUpOf } from '../services/teamBoard.js';

/**
 * Team plan 1: "Working on now", and Team → Board.
 *
 *   · A person says which of their own open tasks they are on. One at a time;
 *     only they can set it; To do moves to In progress; it clears itself when
 *     the task is done, cancelled, sent for approval, put on hold or deleted,
 *     or when they are taken off it. No time goes with it.
 *   · The board: one row per person — Now, Next up (their own My Work order),
 *     plain counts — and "Needs attention". Heads see their departments,
 *     Management sees everybody.
 *
 * Today, throughout: Wednesday 14 October 2026, 11:30 in Chennai. The week is
 * Monday 12 to Sunday 18 October.
 */

const p = prisma as any;
const at = (iso: string) => new Date(iso);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

// ── The studio ──────────────────────────────────────────────────────────────

const PEOPLE = [
  { id: 'usr-boss', name: 'Akmal', preset: RolePreset.MANAGEMENT, departmentId: 'd-mgmt', focusTaskId: null },
  { id: 'usr-headdev', name: 'Dinesh', preset: RolePreset.HEAD, departmentId: 'd-dev', focusTaskId: null },
  { id: 'usr-ravi', name: 'Ravi', preset: RolePreset.EMPLOYEE, departmentId: 'd-dev', focusTaskId: 't-r2' as string | null },
  { id: 'usr-sneha', name: 'Sneha', preset: RolePreset.EMPLOYEE, departmentId: 'd-design', focusTaskId: null },
].map((x) => ({
  ...x,
  organizationId: 'org-1',
  email: `${x.id}@studio.test`,
  designation: null,
  permissions: [] as string[],
  active: true,
  sessionsValidFrom: null,
  department: { name: x.departmentId.slice(2) },
}));
type Who = 'usr-boss' | 'usr-headdev' | 'usr-ravi' | 'usr-sneha';
const person = (id: string) => PEOPLE.find((x) => x.id === id)!;

const as = (id: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: id,
      organizationId: 'org-1',
      email: `${id}@studio.test`,
      preset: person(id).preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[person(id).preset]],
    })}`,
  ] as const;

const DEPARTMENTS = [
  { id: 'd-mgmt', name: 'Management', headId: 'usr-boss', sortOrder: 0 },
  { id: 'd-dev', name: 'Development', headId: 'usr-headdev', sortOrder: 1 },
  { id: 'd-design', name: 'Design', headId: null, sortOrder: 2 },
].map((d) => ({ ...d, organizationId: 'org-1', archivedAt: null }));

const task = (id: string, assigneeIds: string[], over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  organizationId: 'org-1',
  assigneeIds,
  assignees: assigneeIds.map((u) => ({ user: { id: u, name: person(u).name, designation: null, dept: '' } })),
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: day('2026-10-20'),
  createdAt: at('2026-10-01T05:00:00Z'),
  completedAt: null,
  deletedAt: null,
  waitingOn: null,
  waitingSince: null,
  reviews: [] as unknown[],
  repeat: null,
  monthCard: null,
  project: null,
  retainerProject: null,
  internalProject: null,
  company: null,
  assignee: null,
  assignedBy: null,
  creator: null,
  reviewer: null,
  ...over,
});

const TASKS = [
  // Ravi: two late — the later-due one arranged first on his My Work.
  task('t-r1', ['usr-ravi'], { dueDate: day('2026-10-12') }),
  task('t-r0', ['usr-ravi'], { dueDate: day('2026-10-13') }),
  // What he is on now.
  task('t-r2', ['usr-ravi'], { status: 'IN_PROGRESS', dueDate: day('2026-10-14') }),
  task('t-r3', ['usr-ravi'], { dueDate: day('2026-10-16') }),
  // On hold since last Thursday 10:00 — over three working days.
  task('t-r4', ['usr-ravi'], { status: 'ON_HOLD', dueDate: day('2026-10-15'), waitingOn: 'CLIENT', waitingSince: at('2026-10-08T04:30:00Z') }),
  // Sent for approval yesterday 10:00 — well past the two-hour reminder.
  task('t-r5', ['usr-ravi'], {
    status: 'IN_REVIEW',
    dueDate: day('2026-10-12'),
    reviews: [{ round: 1, decision: null, submittedAt: at('2026-10-13T04:30:00Z') }],
  }),
  task('t-r6', ['usr-ravi'], { status: 'DONE', completedAt: at('2026-10-13T10:00:00Z') }),
  // Done last week: not this week's.
  task('t-r8', ['usr-ravi'], { status: 'DONE', completedAt: at('2026-10-10T10:00:00Z') }),
  task('t-r7', ['usr-ravi'], { priority: 'URGENT', dueDate: day('2026-10-25') }),
  task('t-r9', ['usr-ravi'], { status: 'CANCELLED', dueDate: day('2026-10-01') }),
  // Sneha: nothing arranged, so next up is simply the next due.
  task('t-s1', ['usr-sneha'], { status: 'ON_HOLD', dueDate: day('2026-10-14'), waitingSince: at('2026-10-13T04:30:00Z') }),
  task('t-s2', ['usr-sneha'], {
    status: 'IN_REVIEW',
    dueDate: day('2026-10-14'),
    reviews: [{ round: 1, decision: null, submittedAt: at('2026-10-14T05:00:00Z') }],
  }),
  task('t-s3', ['usr-sneha'], { status: 'IN_PROGRESS', priority: 'URGENT', dueDate: day('2026-10-21') }),
  task('t-s4', ['usr-sneha'], { dueDate: day('2026-10-20') }),
  task('t-s5', ['usr-sneha'], { dueDate: day('2026-10-15') }),
];

// Ravi's own arrangement of his late group: t-r0 above t-r1.
const PLACES = [
  { userId: 'usr-ravi', taskId: 't-r0', sortOrder: 0 },
  { userId: 'usr-ravi', taskId: 't-r1', sortOrder: 1 },
];

/**
 * Prisma's where, in memory — the operators these routes use. An operator it
 * does not know is a match, so it never hides a row for some other reason.
 */
function matches(row: any, where: any): boolean {
  for (const [key, want] of Object.entries(where ?? {})) {
    if (want === undefined) continue;
    if (key === 'AND') {
      if (!(want as any[]).every((w) => matches(row, w))) return false;
    } else if (key === 'OR') {
      if (!(want as any[]).some((w) => matches(row, w))) return false;
    } else if (key === 'assignees') {
      const who = (want as any).some?.userId;
      if (who?.in && !row.assigneeIds.some((id: string) => who.in.includes(id))) return false;
    } else if (want === null) {
      if (row[key] != null) return false;
    } else if (typeof want === 'object' && !(want instanceof Date)) {
      const op = want as any;
      if ('in' in op && !op.in.includes(row[key])) return false;
      if ('notIn' in op && op.notIn.includes(row[key])) return false;
      if ('gte' in op && !(row[key] && row[key] >= op.gte)) return false;
    } else if (row[key] !== want) {
      return false;
    }
  }
  return true;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('2026-10-14T06:00:00Z'));
  p.$transaction.mockImplementation(async (fn: any) => fn(p));
  p.user.findUnique.mockImplementation(async ({ where }: any) => PEOPLE.find((x) => x.id === where.id) ?? null);
  p.user.findMany.mockImplementation(async ({ where }: any) => PEOPLE.filter((x) => matches(x, where)));
  p.user.update.mockResolvedValue({});
  p.user.updateMany.mockResolvedValue({ count: 1 });
  p.department.findMany.mockImplementation(async ({ where }: any) => DEPARTMENTS.filter((d) => matches(d, where)));
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', approvalRemindMinutes: 120 });
  p.task.findMany.mockImplementation(async ({ where }: any) => TASKS.filter((t) => matches(t, where)));
  p.taskAssignee.findMany.mockImplementation(async ({ where }: any) => PLACES.filter((x) => matches(x, where)));
  p.activity.create.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

// ── Working on now ──────────────────────────────────────────────────────────

describe('working on now', () => {
  const RAVIS = { id: 't-r3', title: 'Homepage build', status: 'TODO', assignees: [{ userId: 'usr-ravi' }] };

  beforeEach(() => {
    p.task.findFirst.mockResolvedValue(RAVIS);
    p.task.updateMany.mockResolvedValue({ count: 1 });
  });

  it('marks his own task as his "now" and moves it from To do to In progress', async () => {
    const res = await request(app).post('/api/tasks/t-r3/focus').set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    expect(res.body.focus).toEqual({ id: 't-r3', title: 'Homepage build', status: 'IN_PROGRESS' });
    expect(p.user.update).toHaveBeenCalledWith({ where: { id: 'usr-ravi' }, data: { focusTaskId: 't-r3' } });
    expect(p.task.updateMany).toHaveBeenCalledWith({
      where: { id: 't-r3', status: 'TODO' },
      data: { status: 'IN_PROGRESS' },
    });
    // The status change is logged like any other — and nothing else is: no time, no focus record.
    expect(p.activity.create).toHaveBeenCalledTimes(1);
    expect(p.activity.create.mock.calls[0][0].data).toMatchObject({ verb: 'task_status_changed', payload: { from: 'TODO', to: 'IN_PROGRESS' } });
    expect(JSON.stringify(res.body)).not.toMatch(/since|startedAt|minutes/i);
  });

  it('is one per person: choosing another replaces it, and an In progress task stays as it is', async () => {
    p.task.findFirst.mockResolvedValue({ ...RAVIS, id: 't-r2', status: 'IN_PROGRESS' });
    const res = await request(app).post('/api/tasks/t-r2/focus').set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    // One column on the person, overwritten — there is no second "now" to keep.
    expect(p.user.update).toHaveBeenCalledWith({ where: { id: 'usr-ravi' }, data: { focusTaskId: 't-r2' } });
    expect(p.task.updateMany).not.toHaveBeenCalled();
    expect(p.activity.create).not.toHaveBeenCalled();
  });

  it('is only for the people on the task — not their Head, not Management', async () => {
    for (const who of ['usr-headdev', 'usr-boss', 'usr-sneha'] as const) {
      const res = await request(app).post('/api/tasks/t-r3/focus').set(...as(who));
      expect(res.status).toBe(403);
    }
    expect(p.user.update).not.toHaveBeenCalled();
    expect(p.task.updateMany).not.toHaveBeenCalled();
  });

  it('cannot be a task that is on hold, waiting for approval or finished', async () => {
    for (const status of ['ON_HOLD', 'IN_REVIEW', 'DONE', 'CANCELLED']) {
      p.task.findFirst.mockResolvedValue({ ...RAVIS, status });
      const res = await request(app).post('/api/tasks/t-r3/focus').set(...as('usr-ravi'));
      expect(res.status).toBe(400);
    }
    expect(p.user.update).not.toHaveBeenCalled();
  });

  describe('clears itself', () => {
    const cleared = () =>
      p.user.updateMany.mock.calls.some(
        ([arg]: any) => arg.where.focusTaskId === 't-r3' && arg.where.id === undefined && arg.data.focusTaskId === null,
      );

    beforeEach(() => {
      p.task.findFirst.mockResolvedValue({ ...RAVIS, status: 'IN_PROGRESS', organizationId: 'org-1', createdById: 'usr-ravi', assigneeId: 'usr-ravi', completedAt: null, reopenCount: 0, waitingTotalMinutes: 0, deletedAt: null });
      p.task.update.mockResolvedValue({});
    });

    it.each(['DONE', 'CANCELLED'])('when the task goes %s', async (status) => {
      const res = await request(app).patch('/api/tasks/t-r3/status').set(...as('usr-ravi')).send({ status });
      expect(res.status).toBe(200);
      expect(cleared()).toBe(true);
    });

    it('when the task is put on hold', async () => {
      const res = await request(app).post('/api/tasks/t-r3/wait').set(...as('usr-ravi')).send({ waitingOn: 'CLIENT' });
      expect(res.status).toBe(200);
      expect(cleared()).toBe(true);
    });

    it('when the task is deleted', async () => {
      const res = await request(app).delete('/api/tasks/t-r3').set(...as('usr-ravi'));
      expect(res.status).toBe(200);
      expect(cleared()).toBe(true);
    });

    it('but not when the task merely moves back to To do', async () => {
      const res = await request(app).patch('/api/tasks/t-r3/status').set(...as('usr-ravi')).send({ status: 'TODO' });
      expect(res.status).toBe(200);
      expect(cleared()).toBe(false);
    });

    it('for whoever is taken off the task, and only them', async () => {
      p.taskAssignee.findMany.mockResolvedValue([{ userId: 'usr-ravi' }]);
      // Everybody named is on the team; the Head's own scope still reads the studio.
      p.user.findMany.mockImplementation(async ({ where }: any) =>
        where.id?.in ? (where.id.in as string[]).map((id) => ({ id })) : PEOPLE.filter((x) => matches(x, where)),
      );
      const res = await request(app).patch('/api/tasks/t-r3').set(...as('usr-headdev')).send({ assigneeIds: ['usr-sneha'] });
      expect(res.status).toBe(200);
      expect(p.user.updateMany).toHaveBeenCalledWith({
        where: { focusTaskId: 't-r3', id: { notIn: ['usr-sneha'] } },
        data: { focusTaskId: null },
      });
    });

    it('and Clear takes it off', async () => {
      const res = await request(app).delete('/api/me/focus').set(...as('usr-ravi'));
      expect(res.status).toBe(200);
      expect(p.user.update).toHaveBeenCalledWith({ where: { id: 'usr-ravi' }, data: { focusTaskId: null } });
    });
  });

  it('reads back as nothing once the task has stopped being workable, and is cleared then', async () => {
    p.user.findUnique.mockImplementation(async ({ where, select }: any) =>
      select?.focusTask
        ? { focusTask: { id: 't-r4', title: 'Waiting on copy', status: 'ON_HOLD', deletedAt: null, assignees: [{ userId: 'usr-ravi' }] } }
        : person(where.id),
    );
    const res = await request(app).get('/api/me/focus').set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    expect(res.body.focus).toBeNull();
    expect(p.user.updateMany).toHaveBeenCalledWith({ where: { id: 'usr-ravi', focusTaskId: 't-r4' }, data: { focusTaskId: null } });
  });
});

// ── The board ───────────────────────────────────────────────────────────────

describe('Team → Board', () => {
  const ravi = (body: any) => body.people.find((r: any) => r.id === 'usr-ravi');

  it("counts each person's work, plainly", async () => {
    const res = await request(app).get('/api/team/board').set(...as('usr-boss'));
    expect(res.status).toBe(200);
    expect(res.body.week).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    const row = ravi(res.body);
    expect(row.lists).toEqual({
      open: ['t-r1', 't-r0', 't-r2', 't-r3', 't-r4', 't-r7'],
      dueThisWeek: ['t-r2', 't-r3', 't-r4'],
      overdue: ['t-r1', 't-r0'],
      waiting: ['t-r4'],
      inReview: ['t-r5'],
      doneThisWeek: ['t-r6'],
    });
    // Every id a count lists is in the payload, ready to open.
    for (const id of Object.values(row.lists).flat() as string[]) expect(res.body.tasks[id]).toBeTruthy();
  });

  it('shows what he said he is on now, and next up from his own My Work order', async () => {
    const res = await request(app).get('/api/team/board').set(...as('usr-boss'));
    const row = ravi(res.body);
    expect(row.nowTaskId).toBe('t-r2');
    // Overdue comes first on My Work, and he dragged t-r0 above t-r1 — though t-r1 is due earlier.
    expect(row.nextUpTaskId).toBe('t-r0');
    // Sneha has arranged nothing: her next up is the next due she can pick up (not the one on hold).
    expect(res.body.people.find((r: any) => r.id === 'usr-sneha').nextUpTaskId).toBe('t-s5');
    // No timer, no ranking, no labels — on any row.
    for (const r of res.body.people) {
      expect(Object.keys(r).sort()).toEqual(['department', 'departmentId', 'designation', 'id', 'lists', 'name', 'nextUpTaskId', 'nowTaskId']);
    }
  });

  it('shows no "now" once that task is on hold', async () => {
    person('usr-ravi').focusTaskId = 't-r4';
    try {
      const res = await request(app).get('/api/team/board').set(...as('usr-boss'));
      expect(ravi(res.body).nowTaskId).toBeNull();
      // And next up is the top of his list again.
      expect(ravi(res.body).nextUpTaskId).toBe('t-r0');
    } finally {
      person('usr-ravi').focusTaskId = 't-r2';
    }
  });

  it('lists what needs attention: late, long on hold, long in review, urgent and not started', async () => {
    const res = await request(app).get('/api/team/board').set(...as('usr-boss'));
    expect(res.body.attention).toEqual([
      { taskId: 't-r1', reasons: ['OVERDUE'] },
      { taskId: 't-r0', reasons: ['OVERDUE'] },
      { taskId: 't-r4', reasons: ['WAITING_LONG'] },
      { taskId: 't-r5', reasons: ['REVIEW_LONG'] },
      { taskId: 't-r7', reasons: ['URGENT_NOT_STARTED'] },
    ]);
    // Not: Sneha's hold since yesterday, her round sent an hour ago, her urgent task already under way.
  });

  it('keeps the people in the order they were read — departments, then names — whatever the counts', async () => {
    const res = await request(app).get('/api/team/board').set(...as('usr-boss'));
    expect(res.body.people.map((r: any) => r.id)).toEqual(['usr-boss', 'usr-headdev', 'usr-ravi', 'usr-sneha']);
    const { orderBy } = p.user.findMany.mock.calls.at(-1)[0];
    expect(orderBy).toEqual([{ department: { sortOrder: 'asc' } }, { department: { name: 'asc' } }, { name: 'asc' }]);
  });

  it('shows the Head of Development only Development', async () => {
    const res = await request(app).get('/api/team/board').set(...as('usr-headdev'));
    expect(res.status).toBe(200);
    expect(res.body.people.map((r: any) => r.id)).toEqual(['usr-headdev', 'usr-ravi']);
    expect(Object.keys(res.body.tasks).some((id) => id.startsWith('t-s'))).toBe(false);
    expect(res.body.attention.every((a: any) => a.taskId.startsWith('t-r'))).toBe(true);
    // Another department is not theirs to pick.
    const other = await request(app).get('/api/team/board?departmentId=d-design').set(...as('usr-headdev'));
    expect(other.body.people).toEqual([]);
  });

  it('shows Management everybody, or one department when picked', async () => {
    const res = await request(app).get('/api/team/board?departmentId=d-design').set(...as('usr-boss'));
    expect(res.body.people.map((r: any) => r.id)).toEqual(['usr-sneha']);
    expect(res.body.attention).toEqual([]);
  });

  it('is not for somebody without Team work', async () => {
    const res = await request(app).get('/api/team/board').set(...as('usr-ravi'));
    expect(res.status).toBe(403);
  });
});

describe('My Work order', () => {
  const now = at('2026-10-14T06:00:00Z');
  const t = (id: string, due: string, sortOrder: number | null, status = 'TODO', created = '2026-10-01T05:00:00Z') => ({
    id,
    status,
    dueDate: day(due),
    createdAt: at(created),
    sortOrder,
  });

  it('is late, today, this week, later — each as arranged, the unarranged first, otherwise by due date', () => {
    const order = inMyWorkOrder(
      [
        t('later', '2026-11-01', null),
        t('week-arranged', '2026-10-15', 0),
        t('week-new', '2026-10-17', null),
        t('today', '2026-10-14', null),
        t('late', '2026-10-10', null),
        t('in-review', '2026-10-09', null, 'IN_REVIEW'),
        t('done', '2026-10-09', null, 'DONE'),
      ],
      '2026-10-14',
      now,
    );
    expect(order.map((x) => x.id)).toEqual(['late', 'today', 'week-new', 'week-arranged', 'later']);
  });

  it('next up skips the one they are on and anything on hold', () => {
    const list = [t('a', '2026-10-14', 0, 'IN_PROGRESS'), t('b', '2026-10-14', 1, 'ON_HOLD'), t('c', '2026-10-14', 2)];
    expect(nextUpOf(list, 'a', '2026-10-14', now)?.id).toBe('c');
    expect(nextUpOf(list, null, '2026-10-14', now)?.id).toBe('a');
    expect(nextUpOf([t('x', '2026-10-14', 0, 'ON_HOLD')], null, '2026-10-14', now)).toBeNull();
  });
});
