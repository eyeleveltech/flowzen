import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Security fixes plan, H1 and H2 — replaying the 2–3 Oct security check.
 *
 * H2: Ramya (Employee, Design) could rename, close, hold, take over and then
 * delete a task assigned only to Shyam and created by Harish, by id.
 * H1: the activity feed gave her every task's history in the studio,
 * approvers' feedback and actors' emails included.
 *
 * The database stand-in below answers task queries by actually evaluating the
 * `where` the routes build, so these tests prove the filter, not a mock.
 */

const PEOPLE = {
  ramya: { id: 'usr-ramya', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  shyam: { id: 'usr-shyam', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  boss: { id: 'usr-boss', preset: RolePreset.MANAGEMENT, permissions: ['work.own', 'work.team', 'work.all', 'setup.admin'] },
} as const;
type Who = keyof typeof PEOPLE;
const p = prisma as any;

const as = (w: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({ userId: PEOPLE[w].id, organizationId: 'org-1', email: `${w}@x`, preset: PEOPLE[w].preset, permissions: [...PEOPLE[w].permissions] } as never)}`,
  ] as const;

/** Shyam's task, created by Harish — the one from the report. */
const SHYAMS = {
  id: 'task-shyam',
  organizationId: 'org-1',
  title: 'Reel cut',
  status: 'TODO',
  taskType: 'VIDEO',
  deletedAt: null,
  createdById: 'usr-harish',
  assignedById: 'usr-harish',
  assigneeId: 'usr-shyam',
  assignees: [{ userId: 'usr-shyam' }],
};
/** Ramya's own task. */
const RAMYAS = { ...SHYAMS, id: 'task-ramya', title: 'Carousel', taskType: 'DESIGN', assigneeId: 'usr-ramya', assignees: [{ userId: 'usr-ramya' }] };
const TASKS = [SHYAMS, RAMYAS];

/** Enough of Prisma's where to answer the access filters truthfully. */
function matches(t: any, w: any): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]: [string, any]) => {
    if (k === 'AND') return (v as any[]).every((x) => matches(t, x));
    if (k === 'OR') return (v as any[]).some((x) => matches(t, x));
    if (k === 'assignees') return t.assignees.some((a: any) => (v.some.userId?.in ? v.some.userId.in.includes(a.userId) : a.userId === v.some.userId));
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(t[k]);
    return t[k] === v;
  });
}

beforeEach(() => {
  p.user.findUnique.mockImplementation(async ({ where }: any) => {
    const who = Object.values(PEOPLE).find((x) => x.id === where.id);
    return who ? { ...who, organizationId: 'org-1', name: who.id, email: `${who.id}@x`, active: true, sessionsValidFrom: null } : null;
  });
  p.task.findFirst.mockImplementation(async ({ where }: any) => TASKS.find((t) => matches(t, where)) ?? null);
  p.task.count.mockImplementation(async ({ where }: any) => TASKS.filter((t) => matches(t, where)).length);
  p.task.findMany.mockImplementation(async ({ where }: any) => TASKS.filter((t) => matches(t, where)).map((t) => ({ id: t.id })));
  p.taskApprover.findMany.mockResolvedValue([]);
  p.approvalEscalationContact.findMany.mockResolvedValue([]);
  p.activity.findMany.mockResolvedValue([]);
  p.activity.count.mockResolvedValue(0);
});

describe('H2: changing somebody else’s task', () => {
  const attempts: [string, string, Record<string, unknown>?][] = [
    ['patch', '/api/tasks/task-shyam', { title: 'renamed by Ramya', dueDate: '2026-12-31', notes: 'overwritten' }],
    ['patch', '/api/tasks/task-shyam', { assigneeIds: ['usr-ramya'] }],
    ['patch', '/api/tasks/task-shyam/status', { status: 'CANCELLED' }],
    ['post', '/api/tasks/task-shyam/wait', { waitingOn: 'CLIENT' }],
    ['post', '/api/tasks/task-shyam/resume', {}],
    ['post', '/api/tasks/task-shyam/focus', {}],
    ['delete', '/api/tasks/task-shyam', undefined],
  ];

  it.each(attempts)('%s %s is "not found" to an Employee who is not on it', async (method, url, body) => {
    const call = (request(app) as any)[method](url).set(...as('ramya'));
    const res = await (body ? call.send(body) : call);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
    expect(p.task.update).not.toHaveBeenCalled();
    expect(p.task.updateMany).not.toHaveBeenCalled();
  });

  it('still reaches the person on the task', async () => {
    const { taskChangeableWhere } = await import('../services/taskAccess.js');
    const shyam = { userId: 'usr-shyam', organizationId: 'org-1', preset: RolePreset.EMPLOYEE, permissions: ['work.own'], active: true } as any;
    const where = await taskChangeableWhere(shyam, { id: 'task-shyam', organizationId: 'org-1', deletedAt: null });
    expect(matches(SHYAMS, where)).toBe(true);
    // And whoever created or assigned it.
    const harish = { ...shyam, userId: 'usr-harish' };
    expect(matches(SHYAMS, await taskChangeableWhere(harish, { id: 'task-shyam' }))).toBe(true);
  });

  it('leaves Management’s reach unchanged', async () => {
    const { taskChangeableWhere } = await import('../services/taskAccess.js');
    const boss = { userId: 'usr-boss', organizationId: 'org-1', preset: RolePreset.MANAGEMENT, permissions: [], active: true } as any;
    expect(matches(SHYAMS, await taskChangeableWhere(boss, { id: 'task-shyam' }))).toBe(true);
  });
});

describe('H1: the activity feed', () => {
  it('answers "not found" for the history of a task the reader cannot reach', async () => {
    const res = await request(app).get('/api/activities?entityType=Task&entityId=task-shyam').set(...as('ramya'));
    expect(res.status).toBe(404);
    expect(p.activity.findMany).not.toHaveBeenCalled();
  });

  it('gives the history of your own task', async () => {
    const res = await request(app).get('/api/activities?entityType=Task&entityId=task-ramya').set(...as('ramya'));
    expect(res.status).toBe(200);
  });

  it('narrows the task feed to the tasks you may read', async () => {
    await request(app).get('/api/activities?entityType=Task&limit=100').set(...as('ramya'));
    expect(p.activity.findMany.mock.calls[0][0].where.entityId).toEqual({ in: ['task-ramya'] });
  });

  it('narrows the unfiltered feed the same way', async () => {
    await request(app).get('/api/activities').set(...as('ramya'));
    const where = p.activity.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { entityType: { in: expect.not.arrayContaining(['Task']) } },
      { entityType: 'Task', entityId: { in: ['task-ramya'] } },
    ]);
  });

  it('lets an approver read the rounds of the type they review', async () => {
    p.taskApprover.findMany.mockResolvedValue([{ taskType: 'VIDEO' }]);
    const res = await request(app).get('/api/activities?entityType=Task&entityId=task-shyam').set(...as('ramya'));
    expect(res.status).toBe(200);
  });

  it('never carries an actor’s email', async () => {
    await request(app).get('/api/activities?entityType=Task&entityId=task-ramya').set(...as('ramya'));
    await request(app).get('/api/activities').set(...as('boss'));
    for (const call of p.activity.findMany.mock.calls) {
      expect(call[0].include.actor.select).not.toHaveProperty('email');
    }
  });

  it('leaves Management’s feed whole', async () => {
    await request(app).get('/api/activities?entityType=Task').set(...as('boss'));
    expect(p.activity.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', entityType: 'Task' });
  });
});
