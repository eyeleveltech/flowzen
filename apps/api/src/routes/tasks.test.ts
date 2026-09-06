import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Editing a task, and removing one.
 *
 * `PATCH /tasks/:id` accepted `notes` and nothing else, so a task created with
 * the wrong due date or pointed at the wrong person could not be corrected —
 * cancel it and type it again was the only way out. There was no delete route
 * at all; a dead `TaskDetailPanel` in the web app called one that had never
 * existed.
 *
 * The brief is unambiguous about what a delete means here (§16: "Soft delete
 * only. Nothing is ever hard deleted by a user."), and about the one case
 * where it must not happen at all: a finished task is what
 * `computeTaskTypeMedians` reads to say how long this kind of work usually
 * takes, and what the allocation cron counts towards who did what this month.
 * Removing one rewrites figures that have already been reported.
 */

const PEOPLE = {
  designer: { id: 'usr-des', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  head: { id: 'usr-head', preset: RolePreset.HEAD, permissions: ['work.own', 'work.team', 'work.all'] },
  other: { id: 'usr-other', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
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

const OPEN_TASK = {
  id: 'task-1',
  organizationId: 'org-1',
  title: 'Ad Creatives Batch 1',
  assigneeId: 'usr-des',
  createdById: 'usr-des',
  dueDate: new Date('2026-09-02'),
  priority: 'MEDIUM',
  status: 'TODO',
  completedAt: null,
  notes: null,
  deletedAt: null,
};

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const p = Object.entries(PEOPLE).find(([, v]) => v.id === where.id)?.[1];
    if (!p) return null;
    return {
      id: p.id,
      organizationId: 'org-1',
      name: 'Somebody',
      email: 'x@eyelevel.local',
      preset: p.preset,
      permissions: [...p.permissions],
      active: true,
      sessionsValidFrom: null,
    };
  });
  (prisma.task.findFirst as any).mockResolvedValue(OPEN_TASK);
  (prisma.task.update as any).mockImplementation(async ({ data }: any) => ({ ...OPEN_TASK, ...data }));
  (prisma.task.create as any).mockImplementation(async ({ data }: any) => ({ ...OPEN_TASK, ...data, id: 'task-new' }));
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
  (prisma.user.findFirst as any).mockResolvedValue({ id: 'usr-head' });
  // Everybody asked for is on the team, unless a test says otherwise. One
  // query for the whole set, which is also what de-duplicates it.
  (prisma.user.findMany as any).mockImplementation(async ({ where }: any) =>
    (where.id.in as string[]).map((id) => ({ id })),
  );
});

describe('editing a task', () => {
  it('changes the fields a mistake actually lands in', async () => {
    const res = await request(app)
      .patch('/api/tasks/task-1')
      .set(...auth('designer'))
      .send({ title: 'Ad Creatives Batch 1 — statics', dueDate: '2026-09-09', priority: 'HIGH' });

    expect(res.status).toBe(200);
    const { data } = (prisma.task.update as any).mock.calls.at(-1)[0];
    expect(data.title).toBe('Ad Creatives Batch 1 — statics');
    expect(data.priority).toBe('HIGH');
    expect(data.dueDate).toEqual(new Date('2026-09-09'));
  });

  it('still takes a notes-only call', async () => {
    // My Work has always sent exactly this and must keep working.
    const res = await request(app)
      .patch('/api/tasks/task-1')
      .set(...auth('designer'))
      .send({ notes: 'Client wants the blue one' });

    expect(res.status).toBe(200);
    const { data } = (prisma.task.update as any).mock.calls.at(-1)[0];
    expect(data).toEqual({ notes: 'Client wants the blue one' });
  });

  it('refuses to hand a task to somebody who is not on the team', async () => {
    // Otherwise the contents of a picker are the only thing between a typo and
    // a task assigned into another company.
    (prisma.user.findMany as any).mockResolvedValue([]);

    const res = await request(app)
      .patch('/api/tasks/task-1')
      .set(...auth('designer'))
      .send({ assigneeIds: ['usr-from-another-org'] });

    expect(res.status).toBe(400);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('logs what moved, not what was posted', async () => {
    /*
     * An edit form submits every field it holds. Logging the payload would
     * record five changes for a one-word fix, and the trail is the only thing
     * that answers "who moved this due date".
     */
    await request(app)
      .patch('/api/tasks/task-1')
      .set(...auth('designer'))
      .send({ title: OPEN_TASK.title, priority: 'URGENT', dueDate: '2026-09-02' });

    const { data } = (prisma.activity.create as any).mock.calls.at(-1)[0];
    expect(Object.keys(data.payload.changed)).toEqual(['priority']);
    expect(data.payload.changed.priority).toEqual({ from: 'MEDIUM', to: 'URGENT' });
  });

  it('writes no activity when nothing actually changed', async () => {
    await request(app)
      .patch('/api/tasks/task-1')
      .set(...auth('designer'))
      .send({ title: OPEN_TASK.title });

    expect(prisma.activity.create).not.toHaveBeenCalled();
  });
});

describe('deleting a task', () => {
  it('stamps deletedAt rather than removing the row', async () => {
    // §16: soft delete only.
    const res = await request(app).delete('/api/tasks/task-1').set(...auth('designer'));

    expect(res.status).toBe(200);
    expect(prisma.task.delete).not.toHaveBeenCalled();
    expect((prisma.task.update as any).mock.calls.at(-1)[0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('will not remove a finished task, because its timing has been counted', async () => {
    /*
     * `computeTaskTypeMedians` reads DONE tasks to say how long this kind of
     * work usually takes, and the allocation cron counts them towards who did
     * what this month. Both figures have already been shown to somebody.
     */
    (prisma.task.findFirst as any).mockResolvedValue({
      ...OPEN_TASK,
      status: 'DONE',
      completedAt: new Date('2026-09-01'),
    });

    const res = await request(app).delete('/api/tasks/task-1').set(...auth('designer'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/finished/i);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('lets a Head remove somebody else’s task, and a bystander not', async () => {
    const head = await request(app).delete('/api/tasks/task-1').set(...auth('head'));
    expect(head.status).toBe(200);

    (prisma.task.update as any).mockClear();
    const stranger = await request(app).delete('/api/tasks/task-1').set(...auth('other'));
    // 403, not 404 — the task plainly exists, and pretending otherwise is not
    // security, just confusion.
    expect(stranger.status).toBe(403);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('puts one back', async () => {
    // A soft delete with no way back is a hard delete with extra steps.
    (prisma.task.findFirst as any).mockResolvedValue({ ...OPEN_TASK, deletedAt: new Date() });

    const res = await request(app).post('/api/tasks/task-1/restore').set(...auth('designer'));

    expect(res.status).toBe(200);
    expect((prisma.task.update as any).mock.calls.at(-1)[0].data).toEqual({ deletedAt: null });
    // It looks for a DELETED row — the one thing every other query here hides.
    expect((prisma.task.findFirst as any).mock.calls.at(-1)[0].where.deletedAt).toEqual({ not: null });
  });
});

describe('a deleted task is gone from every list that reads one', () => {
  beforeEach(() => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.task.count as any).mockResolvedValue(0);
  });

  it('is filtered out of the task list', async () => {
    await request(app).get('/api/tasks').set(...auth('head'));
    expect((prisma.task.findMany as any).mock.calls.at(-1)[0].where.deletedAt).toBeNull();
  });

  it('is filtered out of My Work', async () => {
    await request(app).get('/api/tasks/my').set(...auth('designer'));
    expect((prisma.task.findMany as any).mock.calls.at(-1)[0].where.deletedAt).toBeNull();
  });
});

describe('several people on one task', () => {
  it('puts everybody on it, and makes the first the lead', async () => {
    /*
     * `assigneeId` is kept alongside the join rather than replaced by it:
     * forty reads across nine files ask "whose task is this", and a task
     * always has somebody answerable for it. Keeping the lead as the first
     * name in the list is what stops the two from ever disagreeing.
     */
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Reel cutdowns', dueDate: '2026-09-09', assigneeIds: ['usr-des', 'usr-head'] });

    expect(res.status).toBe(201);
    const { data } = (prisma.task.create as any).mock.calls.at(-1)[0];
    expect(data.assigneeId).toBe('usr-des');
    expect(data.assignees.create).toEqual([{ userId: 'usr-des' }, { userId: 'usr-head' }]);
  });

  it('does not write the same person twice', async () => {
    // The unique index would reject it with a 500, and a form that sends the
    // same id twice is a form, not an attack.
    await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Statics', dueDate: '2026-09-09', assigneeIds: ['usr-des', 'usr-des', 'usr-head'] });

    const { data } = (prisma.task.create as any).mock.calls.at(-1)[0];
    expect(data.assignees.create).toEqual([{ userId: 'usr-des' }, { userId: 'usr-head' }]);
  });

  it('still accepts a single assigneeId, which is what every old caller sends', async () => {
    await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'One person', dueDate: '2026-09-09', assigneeId: 'usr-head' });

    const { data } = (prisma.task.create as any).mock.calls.at(-1)[0];
    expect(data.assigneeId).toBe('usr-head');
    expect(data.assignees.create).toEqual([{ userId: 'usr-head' }]);
  });

  it('replaces the set on edit rather than merging it', async () => {
    // A merge would make removing somebody impossible, and the form sends the
    // whole set every time.
    await request(app)
      .patch('/api/tasks/task-1')
      .set(...auth('designer'))
      .send({ assigneeIds: ['usr-head'] });

    const { data } = (prisma.task.update as any).mock.calls.at(-1)[0];
    expect(data.assignees.deleteMany).toEqual({ userId: { notIn: ['usr-head'] } });
    expect(data.assigneeId).toBe('usr-head');
  });

  it('shows a task to everybody on it, not only its lead', async () => {
    // A task two people share appearing for one of them is how the other finds
    // out too late.
    (prisma.task.findMany as any).mockResolvedValue([]);
    await request(app).get('/api/tasks/my').set(...auth('designer'));

    // The FIRST call — `computeTaskTypeMedians` queries tasks too, and it runs
    // after this one, so `.at(-1)` reads the medians query instead.
    const { where } = (prisma.task.findMany as any).mock.calls[0][0];
    expect(where.assignees).toEqual({ some: { userId: 'usr-des' } });
    expect(where.assigneeId).toBeUndefined();
  });
});

describe('who assigned it, who reviews it, and what kind of work it is', () => {
  it('records a reviewer and a type', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Key visual', dueDate: '2026-09-09', reviewerId: 'usr-head', taskType: 'DESIGN' });

    expect(res.status).toBe(201);
    const { data } = (prisma.task.create as any).mock.calls.at(-1)[0];
    expect(data.reviewerId).toBe('usr-head');
    expect(data.taskType).toBe('DESIGN');
    // Who typed it is the caller, and stays the caller.
    expect(data.createdById).toBe('usr-des');
  });

  it('records who asked for the work, when it is somebody else', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Key visual', dueDate: '2026-09-09', assignedById: 'usr-head' });

    expect(res.status).toBe(201);
    const { data } = (prisma.task.create as any).mock.calls.at(-1)[0];
    expect(data.assignedById).toBe('usr-head');
    /*
     * And the audit fact does not move with it. `canRemove` grants deleting
     * a task to whoever created it, so if the form could write this column
     * it would be handing out a permission — a person could name somebody
     * else and lose their own right to undo the task they just typed.
     */
    expect(data.createdById).toBe('usr-des');
  });

  it('falls back to whoever is typing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Key visual', dueDate: '2026-09-09' });

    expect(res.status).toBe(201);
    const { data } = (prisma.task.create as any).mock.calls.at(-1)[0];
    expect(data.assignedById).toBe('usr-des');
  });

  it('refuses somebody who is not on the team', async () => {
    (prisma.user.findMany as any).mockResolvedValue([]);
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Key visual', dueDate: '2026-09-09', assignedById: 'usr-elsewhere' });

    expect(res.status).toBe(400);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('refuses a reviewer who is not on the team', async () => {
    (prisma.user.findMany as any).mockResolvedValue([]);
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Key visual', dueDate: '2026-09-09', reviewerId: 'usr-elsewhere' });

    expect(res.status).toBe(400);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rejects a type that is not one of the departments', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth('designer'))
      .send({ title: 'Key visual', dueDate: '2026-09-09', taskType: 'SOMETHING_ELSE' });

    expect(res.status).toBe(400);
  });
});
