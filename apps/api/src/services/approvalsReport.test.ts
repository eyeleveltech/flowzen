import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { composeApprovalsReport, median } from './approvalsReport.js';

/**
 * Plan 3 — the approvals report, counted by hand.
 *
 * A week of Video rounds against a pool of three (one of whom decided nothing)
 * and Akmal to escalate to. Times are IST in the default 10:00–19:00 day, so
 * a round sent at 6pm and decided at 11:30 the next morning took 2h 30m, not
 * seventeen and a half hours.
 */

const ORG = 'org-1';
const ist = (s: string) => new Date(`${s}+05:30`);

/** Wednesday evening; the last 7 days run from the Wednesday before. */
const NOW = ist('2026-09-30T18:00:00');
const FROM = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);

const ANAND = { id: 'u-anand', name: 'Anand' };
const BALA = { id: 'u-bala', name: 'Bala' };
const CHITRA = { id: 'u-chitra', name: 'Chitra' };
const AKMAL = { id: 'u-akmal', name: 'Akmal' };

const round = (o: {
  submittedAt: string;
  decidedAt?: string;
  decision?: 'APPROVED' | 'CHANGES_REQUESTED';
  by?: { id: string; name: string };
  escalatedAt?: string;
}) => ({
  submittedAt: ist(o.submittedAt),
  decision: o.decision ?? null,
  decidedAt: o.decidedAt ? ist(o.decidedAt) : null,
  escalatedAt: o.escalatedAt ? ist(o.escalatedAt) : null,
  decidedBy: o.by ?? null,
  task: { taskType: 'VIDEO' },
});

/** Everything the period query could hand back. */
const ROUNDS = [
  // 1h, on time.
  round({ submittedAt: '2026-09-28T11:00:00', decidedAt: '2026-09-28T12:00:00', decision: 'APPROVED', by: ANAND }),
  // 3h 30m, sent back, late.
  round({ submittedAt: '2026-09-28T11:00:00', decidedAt: '2026-09-28T14:30:00', decision: 'CHANGES_REQUESTED', by: BALA }),
  // Sent at 6pm, decided 11:30 next day: 1h + 1h 30m of working time = 2h 30m, late.
  round({ submittedAt: '2026-09-29T18:00:00', decidedAt: '2026-09-30T11:30:00', decision: 'APPROVED', by: ANAND }),
  // Escalated at 2pm, decided by Akmal at 3pm: 5h, after escalation.
  round({
    submittedAt: '2026-09-29T10:00:00',
    escalatedAt: '2026-09-29T14:00:00',
    decidedAt: '2026-09-29T15:00:00',
    decision: 'APPROVED',
    by: AKMAL,
  }),
  // Sent this morning, still waiting: counts as submitted, not decided.
  round({ submittedAt: '2026-09-30T10:00:00' }),
  // Last week's, before the period: counts for nothing.
  round({ submittedAt: '2026-09-20T11:00:00', decidedAt: '2026-09-21T12:00:00', decision: 'APPROVED', by: BALA }),
];

const openRound = (o: { id: string; submittedAt: string; remindedAt?: string; escalatedAt?: string }) => ({
  round: 1,
  submittedAt: ist(o.submittedAt),
  remindedAt: o.remindedAt ? ist(o.remindedAt) : null,
  escalatedAt: o.escalatedAt ? ist(o.escalatedAt) : null,
  submittedBy: { name: 'Ramya' },
  task: {
    id: o.id,
    title: `Reel ${o.id}`,
    taskType: 'VIDEO',
    monthCard: null,
    project: { company: { name: 'Carlton Wellness' } },
    company: null,
  },
});

/** Waiting now, oldest first, as the database orders them. */
const OPEN = [
  // Tue 5pm → Wed 6pm: 2h + 8h = 10h, escalated.
  openRound({ id: 't-old', submittedAt: '2026-09-29T17:00:00', remindedAt: '2026-09-29T19:00:00', escalatedAt: '2026-09-30T12:00:00' }),
  // Wed 10am → 6pm: 8h, reminded.
  openRound({ id: 't-new', submittedAt: '2026-09-30T10:00:00', remindedAt: '2026-09-30T12:00:00' }),
];

beforeEach(() => {
  // The reminder time (2h), and — through the same row — the default calendar.
  (prisma.organization.findUnique as any).mockResolvedValue({ approvalRemindMinutes: 120 });
  (prisma.taskApprover.findMany as any).mockResolvedValue(
    [ANAND, BALA, CHITRA].map((user) => ({ taskType: 'VIDEO', user })),
  );
  (prisma.approvalEscalationContact.findMany as any).mockResolvedValue([{ taskType: 'VIDEO', user: AKMAL }]);
  (prisma.taskReview.findMany as any).mockImplementation(async ({ where }: any) =>
    where.decision === null ? OPEN : ROUNDS,
  );
});

describe('composeApprovalsReport', () => {
  it('counts the group: sent, decided, the split, on time and escalated', async () => {
    const report = await composeApprovalsReport(ORG, { from: FROM, to: NOW }, NOW);
    expect(report.onTimeMinutes).toBe(120);
    expect(report.byType).toHaveLength(1);
    expect(report.byType[0]).toMatchObject({
      taskType: 'VIDEO',
      approvers: [ANAND, BALA, CHITRA],
      submitted: 5,
      decided: 4,
      approved: 3,
      changesRequested: 1,
      // 60, 150, 210, 300 → the middle two, averaged.
      medianDecisionMinutes: 180,
      // Only the one-hour decision is within 2h.
      onTime: 1,
      escalated: 1,
    });
  });

  it('holds the waiting list live, oldest first, in working time', async () => {
    const report = await composeApprovalsReport(ORG, { from: FROM, to: NOW }, NOW);
    expect(report.waitingNow.map((w) => [w.taskId, w.waitingMinutes])).toEqual([
      ['t-old', 600],
      ['t-new', 480],
    ]);
    expect(report.waitingNow[0]).toMatchObject({ clientName: 'Carlton Wellness', editorName: 'Ramya', round: 1 });
    expect(report.byType[0]).toMatchObject({ waitingNow: 2, oldestWaitingMinutes: 600, anyEscalated: true });
  });

  it('lists what each person did — and an approver who decided nothing, with zeros', async () => {
    const report = await composeApprovalsReport(ORG, { from: FROM, to: NOW }, NOW);
    // Most decided first; one each is by name; the zero last.
    expect(report.byPerson.map((p) => [p.user.name, p.approved, p.changesRequested])).toEqual([
      ['Anand', 2, 0],
      ['Akmal', 1, 0],
      ['Bala', 0, 1],
      ['Chitra', 0, 0],
    ]);
    const byName = Object.fromEntries(report.byPerson.map((p) => [p.user.name, p]));
    expect(byName.Anand.medianDecisionMinutes).toBe(105); // 60 and 150
    expect(byName.Akmal).toMatchObject({ afterEscalation: 1, taskTypes: ['VIDEO'] });
    expect(byName.Chitra).toMatchObject({ approved: 0, changesRequested: 0, medianDecisionMinutes: null, afterEscalation: 0 });
  });

  it('never counts an editor', async () => {
    const report = await composeApprovalsReport(ORG, { from: FROM, to: NOW }, NOW);
    // The editor is context on a waiting row, and nowhere else.
    expect(report.byPerson.some((p) => p.user.name === 'Ramya')).toBe(false);
    expect(JSON.stringify(report.byType)).not.toContain('Ramya');
  });

  it('leaves out rounds on a deleted task, in both queries', async () => {
    await composeApprovalsReport(ORG, { from: FROM, to: NOW }, NOW);
    const calls = (prisma.taskReview.findMany as any).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(args.where.organizationId).toBe(ORG);
      expect(args.where.task).toMatchObject({ deletedAt: null, taskType: { in: ['VIDEO'] } });
    }
  });

  it('makes one "all work" card when every type has the same approvers', async () => {
    // Settings → Approvals writes one list onto every type.
    const every = ['DESIGN', 'VIDEO', 'DIGITAL_MARKETING', 'DEVELOPMENT', 'BUSINESS_DEVELOPMENT', 'ACCOUNTS', 'MANAGEMENT', 'OTHER'];
    (prisma.taskApprover.findMany as any).mockResolvedValue(
      every.flatMap((taskType) => [ANAND, BALA, CHITRA].map((user) => ({ taskType, user }))),
    );
    const report = await composeApprovalsReport(ORG, { from: FROM, to: NOW }, NOW);
    expect(report.byType).toHaveLength(1);
    expect(report.byType[0]).toMatchObject({ allWork: true, submitted: 5, decided: 4, waitingNow: 2 });
    expect(report.byType[0].taskTypes).toHaveLength(8);
  });

  it('reports nothing when no type has approvers', async () => {
    (prisma.taskApprover.findMany as any).mockResolvedValue([]);
    const report = await composeApprovalsReport(ORG, { from: FROM, to: NOW }, NOW);
    expect(report).toMatchObject({ byType: [], byPerson: [], waitingNow: [] });
    expect(prisma.taskReview.findMany).not.toHaveBeenCalled();
  });

  it('takes the middle value', () => {
    expect(median([])).toBeNull();
    expect(median([300, 60, 150])).toBe(150);
    expect(median([60, 150])).toBe(105);
  });
});

// ── The endpoint ─────────────────────────────────────────────────────────────

const PEOPLE = {
  head: { id: 'u-head', preset: RolePreset.HEAD, permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'] },
  employee: { id: 'u-emp', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
} as const;
const auth = (w: keyof typeof PEOPLE) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[w].id,
      organizationId: ORG,
      email: `${w}@eyelevel.local`,
      preset: PEOPLE[w].preset,
      permissions: [...PEOPLE[w].permissions],
    })}`,
  ] as const;

describe('GET /api/team/approvals-report', () => {
  beforeEach(() => {
    (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
      const p = Object.values(PEOPLE).find((v) => v.id === where.id);
      return p
        ? { id: p.id, organizationId: ORG, name: 'Somebody', email: 'x@eyelevel.local', preset: p.preset, permissions: [...p.permissions], active: true, sessionsValidFrom: null }
        : null;
    });
  });

  it('refuses somebody with only their own work', async () => {
    const res = await request(app).get('/api/team/approvals-report').set(...auth('employee'));
    expect(res.status).toBe(403);
  });

  it('gives a head the report, for 7 or 30 days and nothing else', async () => {
    const week = await request(app).get('/api/team/approvals-report').set(...auth('head'));
    expect(week.status).toBe(200);
    expect(week.body.period.days).toBe(7);
    expect(week.body.byType[0].taskType).toBe('VIDEO');

    const month = await request(app).get('/api/team/approvals-report?days=30').set(...auth('head'));
    expect(month.body.period.days).toBe(30);

    expect((await request(app).get('/api/team/approvals-report?days=14').set(...auth('head'))).status).toBe(400);
  });
});
