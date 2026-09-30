import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { sendMail } from '../utils/mailer.js';
import { runApprovalChaser } from './approvalChaser.cron.js';

vi.mock('../utils/mailer.js', () => ({ sendMail: vi.fn() }));
vi.mock('../sse.js', async () => {
  const actual = await vi.importActual<typeof import('../sse.js')>('../sse.js');
  return { ...actual, emitToOrganization: vi.fn() };
});

/**
 * Plan 2 — the chaser, and who the bell tells.
 *
 * A video sits waiting; after two working hours the Video approvers are
 * reminded, after four it escalates to them and Akmal. Once each, never twice,
 * counted in working time only. And the bell shows a reminder to the
 * approvers, an escalation to them and the escalation people, and neither to
 * the editor or anybody else.
 */

const ORG = 'org-1';
const EDITOR = 'usr-editor';
const APPROVER = 'usr-approver';
const AKMAL = 'usr-akmal';

/** A wall-clock time in IST, the office's own. */
const ist = (s: string) => new Date(`${s}+05:30`);

/** Wednesday 11:00 IST — well inside the default 10:00–19:00 day. */
const SENT = ist('2026-09-30T11:00:00');

const round = (over: Record<string, unknown> = {}) => ({
  id: 'rev-1',
  round: 1,
  submittedAt: SENT,
  link: 'https://drive.example/cut-v1.mp4',
  note: 'First cut',
  remindedAt: null,
  escalatedAt: null,
  submittedBy: { name: 'Ramya' },
  task: {
    id: 'task-1',
    title: 'Diwali reel',
    taskType: 'VIDEO',
    organizationId: ORG,
    assignees: [{ userId: EDITOR }],
    monthCard: null,
    project: { name: 'Diwali campaign', company: { name: 'Carlton Wellness' } },
    company: null,
    internalProject: null,
    retainerProject: null,
  },
  ...over,
});

const EMAIL: Record<string, string> = {
  [APPROVER]: 'approver@eyelevel.local',
  [AKMAL]: 'akmal@eyelevel.local',
  [EDITOR]: 'editor@eyelevel.local',
};

/** Who got mailed, by address. */
const mailedTo = () => (sendMail as any).mock.calls.map((c: any[]) => c[1].to);
const createdRules = () => (prisma.alert.create as any).mock.calls.map((c: any[]) => c[0].data.rule);

beforeEach(() => {
  (sendMail as any).mockReset();
  (sendMail as any).mockResolvedValue(undefined);
  // Both the calendar and the thresholds come from the organisation row:
  // default hours, 2h and 4h.
  (prisma.organization.findUnique as any).mockResolvedValue({ approvalRemindMinutes: 120, approvalEscalateMinutes: 240 });
  // Video: one approver, and Akmal to escalate to. Neither is the editor.
  (prisma.taskApprover.findMany as any).mockResolvedValue([{ userId: APPROVER }]);
  (prisma.approvalEscalationContact.findMany as any).mockResolvedValue([{ userId: AKMAL }]);
  (prisma.user.findMany as any).mockImplementation(async ({ where }: any) =>
    (where.id.in as string[]).map((id) => ({ email: EMAIL[id] })),
  );
  (prisma.taskReview.updateMany as any).mockResolvedValue({ count: 1 });
  (prisma.alert.create as any).mockResolvedValue({});
  (prisma.alert.updateMany as any).mockResolvedValue({ count: 0 });
  // Nothing left over to clean up, unless a test says so.
  (prisma.alert.findMany as any).mockResolvedValue([]);
});

// ── The tick ─────────────────────────────────────────────────────────────────

describe('the chaser tick', () => {
  it('reminds the approvers once the reminder time has passed — nobody else', async () => {
    (prisma.taskReview.findMany as any).mockResolvedValue([round()]);

    const out = await runApprovalChaser(ist('2026-09-30T13:10:00'));

    expect(out).toMatchObject({ reminded: 1, escalated: 0 });
    // Claimed before anything is sent.
    expect(prisma.taskReview.updateMany).toHaveBeenCalledWith({
      where: { id: 'rev-1', remindedAt: null },
      data: { remindedAt: ist('2026-09-30T13:10:00') },
    });
    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rule: 'APPROVAL_REMINDER',
        severity: 'MED',
        entityType: 'Task',
        entityId: 'task-1',
        message: '"Diwali reel" has been waiting 2h for approval — Round 1, by Ramya.',
      }),
    });
    // The approver, not Akmal and not the editor.
    expect(mailedTo()).toEqual(['approver@eyelevel.local']);
    const mail = (sendMail as any).mock.calls[0][1];
    expect(mail.subject).toBe('Approval waiting 2h: Diwali reel');
    expect(mail.html).toContain('/my-work?task=task-1');
    expect(mail.html).toContain('Carlton Wellness · Diwali campaign');
  });

  it('does nothing before the reminder time', async () => {
    (prisma.taskReview.findMany as any).mockResolvedValue([round()]);
    const out = await runApprovalChaser(ist('2026-09-30T12:50:00'));
    expect(out).toMatchObject({ reminded: 0, escalated: 0 });
    expect(prisma.taskReview.updateMany).not.toHaveBeenCalled();
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('counts working time only — a video sent at 6:30pm is not chased that night', async () => {
    const lateRound = round({ submittedAt: ist('2026-09-30T18:30:00') });
    (prisma.taskReview.findMany as any).mockResolvedValue([lateRound]);

    // Three wall-clock hours later, but only 30 working minutes.
    expect(await runApprovalChaser(ist('2026-09-30T21:30:00'))).toMatchObject({ reminded: 0 });
    expect(prisma.alert.create).not.toHaveBeenCalled();

    // Next morning at 11:40: 30 + 100 = 130 working minutes.
    expect(await runApprovalChaser(ist('2026-10-01T11:40:00'))).toMatchObject({ reminded: 1 });
    expect(createdRules()).toEqual(['APPROVAL_REMINDER']);
  });

  it('escalates to the approvers and the escalation people, replacing the reminder', async () => {
    (prisma.taskReview.findMany as any).mockResolvedValue([round({ remindedAt: ist('2026-09-30T13:10:00') })]);
    const now = ist('2026-09-30T15:10:00');

    const out = await runApprovalChaser(now);

    expect(out).toMatchObject({ reminded: 0, escalated: 1 });
    expect(prisma.taskReview.updateMany).toHaveBeenCalledWith({
      where: { id: 'rev-1', escalatedAt: null },
      data: { escalatedAt: now },
    });
    // The reminder is closed…
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ rule: 'APPROVAL_REMINDER', entityId: 'task-1', resolvedAt: null }),
      data: { resolvedAt: now },
    });
    // …and the escalation takes its place.
    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rule: 'APPROVAL_ESCALATED',
        severity: 'HIGH',
        message: '"Diwali reel" has waited 4h for approval with no answer — Round 1, by Ramya.',
      }),
    });
    expect(mailedTo().sort()).toEqual(['akmal@eyelevel.local', 'approver@eyelevel.local']);
    expect((sendMail as any).mock.calls[0][1].subject).toBe('Escalated: Diwali reel waiting 4h for approval');
  });

  it('skips straight to the escalation when the server was down past both', async () => {
    (prisma.taskReview.findMany as any).mockResolvedValue([round()]);
    const now = ist('2026-09-30T15:10:00');

    const out = await runApprovalChaser(now);

    expect(out).toMatchObject({ reminded: 0, escalated: 1 });
    // One claim stamping both, and only the escalation sent.
    expect(prisma.taskReview.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.taskReview.updateMany).toHaveBeenCalledWith({
      where: { id: 'rev-1', escalatedAt: null },
      data: { escalatedAt: now, remindedAt: now },
    });
    expect(createdRules()).toEqual(['APPROVAL_ESCALATED']);
    expect((sendMail as any).mock.calls.every((c: any[]) => c[1].subject.startsWith('Escalated:'))).toBe(true);
  });

  it('never sends twice — a lost claim sends nothing, and a reminded round waits for the escalation', async () => {
    // Another tick claimed it first.
    (prisma.taskReview.findMany as any).mockResolvedValue([round()]);
    (prisma.taskReview.updateMany as any).mockResolvedValue({ count: 0 });
    expect(await runApprovalChaser(ist('2026-09-30T13:10:00'))).toMatchObject({ reminded: 0 });
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();

    // The next tick sees it already reminded, and it is not yet time to escalate.
    (prisma.taskReview.updateMany as any).mockClear();
    (prisma.taskReview.findMany as any).mockResolvedValue([round({ remindedAt: ist('2026-09-30T13:10:00') })]);
    expect(await runApprovalChaser(ist('2026-09-30T13:20:00'))).toMatchObject({ reminded: 0, escalated: 0 });
    expect(prisma.taskReview.updateMany).not.toHaveBeenCalled();

    // And once escalated, nothing more — no repeat pings.
    (prisma.taskReview.findMany as any).mockResolvedValue([
      round({ remindedAt: ist('2026-09-30T13:10:00'), escalatedAt: ist('2026-09-30T15:10:00') }),
    ]);
    expect(await runApprovalChaser(ist('2026-10-01T18:00:00'))).toMatchObject({ reminded: 0, escalated: 0 });
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('still raises the bell alert when mail is not set up', async () => {
    (prisma.taskReview.findMany as any).mockResolvedValue([round()]);
    (sendMail as any).mockRejectedValue(new Error('Email is not set up'));

    const out = await runApprovalChaser(ist('2026-09-30T13:10:00'));

    expect(out).toMatchObject({ reminded: 1 });
    expect(createdRules()).toEqual(['APPROVAL_REMINDER']);
  });

  it('closes alerts whose task was cancelled or deleted, and keeps the ones still waiting', async () => {
    (prisma.taskReview.findMany as any).mockResolvedValue([]);
    (prisma.alert.findMany as any).mockResolvedValue([
      { id: 'al-cancelled', entityId: 't-cancelled' },
      { id: 'al-waiting', entityId: 't-waiting' },
      { id: 'al-deleted', entityId: 't-deleted' },
      { id: 'al-gone', entityId: 't-gone' },
    ]);
    (prisma.task.findMany as any).mockResolvedValue([
      { id: 't-cancelled', status: 'CANCELLED', deletedAt: null },
      { id: 't-waiting', status: 'IN_REVIEW', deletedAt: null },
      { id: 't-deleted', status: 'IN_REVIEW', deletedAt: new Date() },
    ]);
    (prisma.alert.updateMany as any).mockImplementation(async ({ where }: any) => ({ count: where.id.in.length }));

    const now = ist('2026-09-30T13:10:00');
    const out = await runApprovalChaser(now);

    expect(out.resolved).toBe(3);
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['al-cancelled', 'al-deleted', 'al-gone'] } },
      data: { resolvedAt: now },
    });
  });
});

// ── The bell ─────────────────────────────────────────────────────────────────

const PEOPLE = {
  approver: { id: APPROVER, preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  akmal: {
    id: AKMAL,
    preset: RolePreset.MANAGEMENT,
    permissions: [
      'work.own', 'work.team', 'work.all', 'company.read', 'pipeline.read',
      'money.status', 'money.figures', 'cost.enter', 'reports.read', 'setup.admin',
    ],
  },
  editor: { id: EDITOR, preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  bystander: { id: 'usr-other', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
} as const;
type Who = keyof typeof PEOPLE;

const auth = (w: Who) =>
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

/** One Video task in review (the editor's), and its two chaser alerts. */
const BELL = [
  { id: 'al-rem', rule: 'APPROVAL_REMINDER', severity: 'MED', entityType: 'Task', entityId: 'task-1', message: 'reminder', createdAt: new Date(), resolvedAt: null },
  { id: 'al-esc', rule: 'APPROVAL_ESCALATED', severity: 'HIGH', entityType: 'Task', entityId: 'task-1', message: 'escalated', createdAt: new Date(), resolvedAt: null },
];

describe('who the bell tells', () => {
  beforeEach(() => {
    (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
      const p = Object.values(PEOPLE).find((v) => v.id === where.id);
      if (!p) return null;
      return {
        id: p.id, organizationId: ORG, name: 'Somebody', email: 'x@eyelevel.local',
        preset: p.preset, permissions: [...p.permissions], active: true, sessionsValidFrom: null,
      };
    });
    // Who approves / escalates what, per person.
    (prisma.taskApprover.findMany as any).mockImplementation(async ({ where }: any) =>
      where.userId === APPROVER ? [{ taskType: 'VIDEO' }] : [],
    );
    (prisma.approvalEscalationContact.findMany as any).mockImplementation(async ({ where }: any) =>
      where.userId === AKMAL ? [{ taskType: 'VIDEO' }] : [],
    );
    // The one task in review, the editor's; "my tasks" for the task rules.
    (prisma.task.findMany as any).mockImplementation(async ({ where }: any) => {
      if (where.status === 'IN_REVIEW') {
        const onIt = where.NOT?.assignees?.some?.userId === EDITOR;
        return where.taskType.in.includes('VIDEO') && !onIt ? [{ id: 'task-1' }] : [];
      }
      return [];
    });
    const matches = (where: any) =>
      BELL.filter((a) =>
        (where?.OR ?? []).some((c: any) => {
          if (typeof c.rule === 'string' && c.rule !== a.rule) return false;
          if (c.rule?.in && !c.rule.in.includes(a.rule)) return false;
          if (c.entityType && c.entityType !== a.entityType) return false;
          if (c.entityId?.in && !c.entityId.in.includes(a.entityId)) return false;
          return true;
        }),
      );
    (prisma.alert.findMany as any).mockImplementation(async ({ where }: any) => matches(where));
    (prisma.alert.count as any).mockImplementation(async ({ where }: any) =>
      matches(where).filter((a) => !where.id || a.id === where.id).length,
    );
    (prisma.alert.findFirst as any).mockImplementation(async ({ where }: any) => BELL.find((a) => a.id === where.id) ?? null);
    (prisma.alertRead.findMany as any).mockResolvedValue([]);
    (prisma.alertRead.upsert as any).mockResolvedValue({});
  });

  const rulesFor = async (who: Who) => {
    const res = await request(app).get('/api/notifications').set(...auth(who));
    expect(res.status).toBe(200);
    return res.body.notifications.map((n: any) => n.type).sort();
  };

  it('tells the approvers about both, and opens the task itself', async () => {
    expect(await rulesFor('approver')).toEqual(['APPROVAL_ESCALATED', 'APPROVAL_REMINDER']);
    const res = await request(app).get('/api/notifications').set(...auth('approver'));
    expect(res.body.notifications[0].link).toBe('/my-work?task=task-1');
  });

  it('tells the escalation person only once it has escalated — permissions alone do not', async () => {
    // Akmal holds every permission, and still is not reminded.
    expect(await rulesFor('akmal')).toEqual(['APPROVAL_ESCALATED']);
  });

  it('tells neither the editor nor anybody else', async () => {
    expect(await rulesFor('editor')).toEqual([]);
    expect(await rulesFor('bystander')).toEqual([]);
  });

  it('lets the person it reached mark it read, and nobody else', async () => {
    expect((await request(app).patch('/api/notifications/al-esc/read').set(...auth('akmal'))).status).toBe(200);
    expect((await request(app).patch('/api/notifications/al-rem/read').set(...auth('akmal'))).status).toBe(403);
    expect((await request(app).patch('/api/notifications/al-rem/read').set(...auth('bystander'))).status).toBe(403);
  });
});
