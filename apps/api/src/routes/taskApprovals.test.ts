/**
 * Task approvals — send, approve, request changes, and the doors that stay shut.
 *
 * The video team finishes a video and then waits on WhatsApp for someone to
 * approve it. These pin the rules that make Flowzen the record instead: a task
 * that needs approval reaches Done only through Approve, nobody approves their
 * own work, feedback is required to send it back, and two approvers clicking
 * at once cannot both decide it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

const EDITOR = 'usr-editor';
const APPROVER = 'usr-approver';
const OTHER_APPROVER = 'usr-approver-2';

const as = (userId: string, permissions = ['work.own']) => {
  (prisma.user.findUnique as any).mockResolvedValue({
    id: userId,
    organizationId: 'org-1',
    name: userId,
    email: `${userId}@eyelevel.local`,
    preset: RolePreset.EMPLOYEE,
    permissions,
    active: true,
    sessionsValidFrom: null,
  });
  return [
    'Authorization',
    `Bearer ${signJwt({ userId, organizationId: 'org-1', email: `${userId}@eyelevel.local`, preset: RolePreset.EMPLOYEE, permissions })}`,
  ] as const;
};

const SUBMITTED = new Date('2026-09-29T05:00:00Z');

/** A video, needing approval, on the editor's desk. */
const task = (over: Record<string, unknown> = {}) => ({
  id: 'task-1',
  organizationId: 'org-1',
  title: 'Carlton reel — cut 1',
  status: 'IN_PROGRESS',
  taskType: 'VIDEO',
  needsApproval: true,
  monthCardId: null,
  createdById: 'usr-head',
  completedAt: null,
  reopenCount: 0,
  waitingTotalMinutes: 0,
  assignees: [{ userId: EDITOR }],
  reviews: [],
  ...over,
});

/** The round that is waiting. */
const openRound = (over: Record<string, unknown> = {}) => ({
  id: 'rev-1',
  round: 1,
  submittedAt: SUBMITTED,
  decision: null,
  decidedBy: null,
  submittedBy: { id: EDITOR, name: 'Editor' },
  ...over,
});

beforeEach(() => {
  // The approval actions write the task and the round together.
  (prisma.$transaction as any).mockImplementation((fn: any) => fn(prisma));
  // Two VIDEO approvers, neither of them the editor.
  (prisma.taskApprover.findMany as any).mockResolvedValue([{ userId: APPROVER }, { userId: OTHER_APPROVER }]);
  // Nobody to escalate to, unless a test says otherwise.
  (prisma.approvalEscalationContact.findMany as any).mockResolvedValue([]);
  (prisma.task.updateMany as any).mockResolvedValue({ count: 1 });
  (prisma.taskReview.updateMany as any).mockResolvedValue({ count: 1 });
  (prisma.taskReview.create as any).mockImplementation(async ({ data }: any) => ({ id: 'rev-new', ...data }));
  (prisma.activity.create as any).mockResolvedValue({});
});

// ── Send for approval ────────────────────────────────────────────────────────

describe('send for approval', () => {
  it('opens round 1 and moves the task to In review', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task());
    const res = await request(app)
      .post('/api/tasks/task-1/submit-review')
      .set(...as(EDITOR))
      .send({ link: 'https://drive.google.com/file/abc', note: 'Cut 1, music is temp' });

    expect(res.status).toBe(201);
    const move = (prisma.task.updateMany as any).mock.calls[0][0];
    expect(move.where.status).toEqual({ in: ['TODO', 'IN_PROGRESS'] });
    expect(move.data).toEqual({ status: 'IN_REVIEW' });
    const round = (prisma.taskReview.create as any).mock.calls[0][0].data;
    expect(round).toMatchObject({ round: 1, submittedById: EDITOR, link: 'https://drive.google.com/file/abc' });
  });

  it('numbers the resubmission after changes as the next round', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(
      task({ reviews: [openRound({ decision: 'CHANGES_REQUESTED', decidedBy: { id: APPROVER, name: 'Approver' } })] }),
    );
    const res = await request(app).post('/api/tasks/task-1/submit-review').set(...as(EDITOR)).send({});
    expect(res.status).toBe(201);
    expect((prisma.taskReview.create as any).mock.calls[0][0].data.round).toBe(2);
  });

  it('refuses a task that does not need approval', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task({ needsApproval: false }));
    const res = await request(app).post('/api/tasks/task-1/submit-review').set(...as(EDITOR)).send({});
    expect(res.status).toBe(400);
    expect(prisma.taskReview.create).not.toHaveBeenCalled();
  });

  it('refuses somebody who is neither on the task nor its creator', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task());
    const res = await request(app).post('/api/tasks/task-1/submit-review').set(...as('usr-stranger')).send({});
    expect(res.status).toBe(403);
  });

  it('refuses a link that is not a web address', async () => {
    const res = await request(app).post('/api/tasks/task-1/submit-review').set(...as(EDITOR)).send({ link: 'drive/abc' });
    expect(res.status).toBe(400);
  });
});

// ── The Done block ───────────────────────────────────────────────────────────

describe('a task that needs approval', () => {
  it('cannot be marked Done from the status menu', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task());
    const res = await request(app).patch('/api/tasks/task-1/status').set(...as(EDITOR)).send({ status: 'DONE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This task needs approval. Use 'Send for approval'.");
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('cannot be moved into review from the status menu', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task());
    const res = await request(app).patch('/api/tasks/task-1/status').set(...as(EDITOR)).send({ status: 'IN_REVIEW' });
    expect(res.status).toBe(400);
  });

  it('cannot be moved out of review except by cancelling', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task({ status: 'IN_REVIEW' }));
    const res = await request(app).patch('/api/tasks/task-1/status').set(...as(EDITOR)).send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(400);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });
});

// ── Approve ──────────────────────────────────────────────────────────────────

describe('approve', () => {
  it('finishes the task and gives the review time back to the editor', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task({ status: 'IN_REVIEW', reviews: [openRound()] }));
    const res = await request(app).post('/api/tasks/task-1/approve').set(...as(APPROVER)).send({});

    expect(res.status).toBe(200);
    const move = (prisma.task.updateMany as any).mock.calls[0][0];
    // Conditional on still being in review — the race guard.
    expect(move.where).toEqual({ id: 'task-1', status: 'IN_REVIEW' });
    expect(move.data.status).toBe('DONE');
    expect(move.data.completedAt).toBeInstanceOf(Date);
    // The round's wait goes onto the clock every elapsed figure subtracts.
    expect(move.data.waitingTotalMinutes).toEqual({ increment: expect.any(Number) });
    expect(move.data.waitingTotalMinutes.increment).toBeGreaterThan(0);
    const decided = (prisma.taskReview.updateMany as any).mock.calls[0][0];
    expect(decided.data).toMatchObject({ decision: 'APPROVED', decidedById: APPROVER });
  });

  it('refuses an approver who is on the task — nobody approves their own work', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(
      task({ status: 'IN_REVIEW', reviews: [openRound()], assignees: [{ userId: EDITOR }, { userId: APPROVER }] }),
    );
    const res = await request(app).post('/api/tasks/task-1/approve').set(...as(APPROVER)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/can't approve it/);
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('says so when the only approver is the one on the task', async () => {
    (prisma.taskApprover.findMany as any).mockResolvedValue([{ userId: APPROVER }]);
    (prisma.task.findFirst as any).mockResolvedValue(
      task({ status: 'IN_REVIEW', reviews: [openRound()], assignees: [{ userId: APPROVER }] }),
    );
    const res = await request(app).post('/api/tasks/task-1/approve').set(...as(APPROVER)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/nobody else is set to approve Video/);
  });

  it('refuses somebody who is not an approver for the type', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task({ status: 'IN_REVIEW', reviews: [openRound()] }));
    const res = await request(app).post('/api/tasks/task-1/approve').set(...as('usr-designer')).send({});
    expect(res.status).toBe(403);
  });

  it('lets one of two simultaneous approvers win, and tells the other who did', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task({ status: 'IN_REVIEW', reviews: [openRound()] }));
    // By the time this write lands, the other approver has already moved it.
    (prisma.task.updateMany as any).mockResolvedValue({ count: 0 });
    (prisma.taskReview.findFirst as any).mockResolvedValue({ decidedBy: { name: 'Akmal' } });

    const res = await request(app).post('/api/tasks/task-1/approve').set(...as(OTHER_APPROVER)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already decided by Akmal');
    expect(prisma.taskReview.updateMany).not.toHaveBeenCalled();
  });

  it('answers 409 for a round already decided', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(
      task({ status: 'DONE', reviews: [openRound({ decision: 'APPROVED', decidedBy: { id: APPROVER, name: 'Akmal' } })] }),
    );
    const res = await request(app).post('/api/tasks/task-1/approve').set(...as(OTHER_APPROVER)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already decided by Akmal');
  });
});

// ── Request changes ──────────────────────────────────────────────────────────

describe('request changes', () => {
  it('needs written feedback', async () => {
    const res = await request(app).post('/api/tasks/task-1/request-changes').set(...as(APPROVER)).send({ feedback: '   ' });
    expect(res.status).toBe(400);
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('sends it back to In progress with the feedback, without counting a reopen', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task({ status: 'IN_REVIEW', reviews: [openRound()] }));
    const res = await request(app)
      .post('/api/tasks/task-1/request-changes')
      .set(...as(APPROVER))
      .send({ feedback: 'Logo sits too low in the last frame' });

    expect(res.status).toBe(200);
    const move = (prisma.task.updateMany as any).mock.calls[0][0];
    expect(move.data.status).toBe('IN_PROGRESS');
    expect(move.data).not.toHaveProperty('reopenCount');
    expect(move.data).not.toHaveProperty('completedAt');
    expect(move.data.waitingTotalMinutes).toEqual({ increment: expect.any(Number) });
    const decided = (prisma.taskReview.updateMany as any).mock.calls[0][0];
    expect(decided.data).toMatchObject({
      decision: 'CHANGES_REQUESTED',
      decidedById: APPROVER,
      feedback: 'Logo sits too low in the last frame',
    });
  });
});

// ── The approver's queue ─────────────────────────────────────────────────────

describe("the approver's queue", () => {
  it('is empty, not refused, for somebody who approves nothing', async () => {
    (prisma.taskApprover.findMany as any).mockResolvedValue([]);
    const res = await request(app).get('/api/tasks/approvals').set(...as(EDITOR));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it("asks only for in-review work of the caller's types, leaving out their own", async () => {
    (prisma.taskApprover.findMany as any).mockResolvedValue([{ taskType: 'VIDEO' }]);
    (prisma.task.findMany as any).mockResolvedValue([]);
    await request(app).get('/api/tasks/approvals').set(...as(APPROVER));
    // Two queries now: what is waiting, and what was sent back.
    const where = (prisma.task.findMany as any).mock.calls.find((c: any[]) => c[0].where.status === 'IN_REVIEW')[0].where;
    expect(where).toMatchObject({
      status: 'IN_REVIEW',
      OR: [{ taskType: { in: ['VIDEO'] } }],
      NOT: { assignees: { some: { userId: APPROVER } } },
    });
  });
});

// ── No type of work needed ──────────────────────────────────────────────────

describe('needs approval without a type', () => {
  it('is allowed, and is filed as Other — the same approvers cover all work', async () => {
    const { approvalFlagRefusal, approvalType } = await import('../services/taskApprovals.js');
    expect(approvalType(null)).toBe('OTHER');
    expect(approvalType('VIDEO' as any)).toBe('VIDEO');
    // Somebody approves (the default mock): no refusal, and the pool asked for is Other's.
    expect(await approvalFlagRefusal('org-1', null, true)).toBeNull();
    expect((prisma.taskApprover.findMany as any).mock.calls.at(-1)[0].where.taskType).toBe('OTHER');
  });

  it('is refused only when nobody approves at all', async () => {
    const { approvalFlagRefusal } = await import('../services/taskApprovals.js');
    (prisma.taskApprover.findMany as any).mockResolvedValue([]);
    expect(await approvalFlagRefusal('org-1', null, true)).toBe(
      'Nobody is set to approve work yet. Set the approvers in Settings → Approvals.',
    );
  });
});

// ── Add my changes ──────────────────────────────────────────────────────────

describe('adding changes to a round somebody sent back', () => {
  /** Back with the editor: round 1 sent back by the first approver. */
  const sentBack = (over: Record<string, unknown> = {}) =>
    task({
      status: 'IN_PROGRESS',
      reviews: [openRound({ decision: 'CHANGES_REQUESTED', decidedBy: { id: APPROVER, name: 'Approver' }, feedback: 'Logo too low' })],
      ...over,
    });

  it('lets another approver add theirs, with their name on it', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(sentBack());
    (prisma.taskReviewNote.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'note-1',
      feedback: data.feedback,
      createdAt: new Date(),
      author: { id: data.authorId, name: 'Other approver' },
    }));
    const res = await request(app)
      .post('/api/tasks/task-1/add-changes')
      .set(...as(OTHER_APPROVER))
      .send({ feedback: 'Music is too loud at the start' });

    expect(res.status).toBe(201);
    expect((prisma.taskReviewNote.create as any).mock.calls[0][0].data).toMatchObject({
      reviewId: 'rev-1',
      authorId: OTHER_APPROVER,
      feedback: 'Music is too loud at the start',
    });
    // Adding changes decides nothing: the task stays with the editor.
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('needs something written', async () => {
    const res = await request(app).post('/api/tasks/task-1/add-changes').set(...as(OTHER_APPROVER)).send({ feedback: ' ' });
    expect(res.status).toBe(400);
  });

  it('refuses once the editor has sent it again — the new round is the one to answer', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(task({ status: 'IN_REVIEW', reviews: [openRound({ round: 2 })] }));
    const res = await request(app).post('/api/tasks/task-1/add-changes').set(...as(OTHER_APPROVER)).send({ feedback: 'x' });
    expect(res.status).toBe(400);
    expect(prisma.taskReviewNote.create).not.toHaveBeenCalled();
  });

  it('refuses somebody who does not approve this work', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(sentBack());
    const res = await request(app).post('/api/tasks/task-1/add-changes').set(...as('usr-stranger')).send({ feedback: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approvers can add changes/);
  });

  it('refuses the editor sending their own work back', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(sentBack({ assignees: [{ userId: OTHER_APPROVER }] }));
    const res = await request(app).post('/api/tasks/task-1/add-changes').set(...as(OTHER_APPROVER)).send({ feedback: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/on this task/);
  });
});
