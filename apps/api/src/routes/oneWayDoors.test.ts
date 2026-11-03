import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { codeWord, listWord, COMPANY_STATUS_WORD, TASK_STATUS_WORD } from '../utils/codeWords.js';

/**
 * Ways back that did not exist (30 Oct 2026).
 *
 * A lapsed invitation could not be sent again, a cost deleted by mistake could
 * only be restored by an admin, and the Team tile headed "Waiting on Clients"
 * counted every task on hold. Each is checked here at the rule it now follows.
 */

const signIn = (id: string, preset: RolePreset, permissions: string[]) => {
  (prisma.user.findUnique as any).mockResolvedValue({
    id,
    organizationId: 'org-1',
    name: 'Someone',
    email: `${id}@eyelevel.local`,
    preset,
    permissions,
    active: true,
    sessionsValidFrom: null,
  });
  return [
    'Authorization',
    `Bearer ${signJwt({ userId: id, organizationId: 'org-1', email: `${id}@eyelevel.local`, preset, permissions })}`,
  ] as const;
};

const ADMIN = () => signIn('usr-admin', RolePreset.MANAGEMENT, ['setup.admin']);
const ACCOUNTS = () => signIn('usr-acc', RolePreset.ACCOUNTS, ['cost.enter', 'money.figures']);

const person = (over: Record<string, unknown> = {}) => ({
  id: 'usr-new',
  organizationId: 'org-1',
  name: 'Meera',
  email: 'meera@eyelevel.local',
  active: false,
  inviteToken: 'old-token',
  inviteTokenExpiresAt: new Date('2026-10-01'),
  ...over,
});

describe('sending an invitation again', () => {
  beforeEach(() => {
    (prisma.user.update as any).mockResolvedValue({});
    (prisma.activity.create as any).mockResolvedValue({});
  });

  it('issues a fresh seven-day link on a pending invitation, and returns it', async () => {
    const auth = ADMIN();
    (prisma.user.findFirst as any).mockResolvedValue(person());
    const res = await request(app).post('/api/users/usr-new/resend-invite').set(...auth);
    expect(res.status).toBe(200);
    const data = (prisma.user.update as any).mock.calls[0][0].data;
    expect(data.inviteToken).not.toBe('old-token');
    expect(data.inviteTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    // No mail server in a test: the link still comes back, to hand over.
    expect(res.body.data.emailed).toBe(false);
    expect(res.body.data.inviteLink).toContain(data.inviteToken);
  });

  it('refuses somebody who has already joined', async () => {
    const auth = ADMIN();
    (prisma.user.findFirst as any).mockResolvedValue(person({ active: true, inviteToken: null }));
    const res = await request(app).post('/api/users/usr-new/resend-invite').set(...auth);
    expect(res.status).toBe(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses somebody who was switched off, and says how to let them back', async () => {
    const auth = ADMIN();
    (prisma.user.findFirst as any).mockResolvedValue(person({ inviteToken: null }));
    const res = await request(app).post('/api/users/usr-new/resend-invite').set(...auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Switch them back on/);
  });

  it('points an invitation to an email already invited at Resend invite', async () => {
    const auth = ADMIN();
    (prisma.department.findFirst as any).mockResolvedValue({ id: 'dep-1', name: 'Design', archivedAt: null });
    // The session lookup is by id; the invite's duplicate check is by email.
    const session = await (prisma.user.findUnique as any)();
    (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) =>
      where.email ? person() : session,
    );
    const res = await request(app)
      .post('/api/users/invite')
      .set(...auth)
      .send({ name: 'Meera', email: 'meera@eyelevel.local', departmentId: 'dep-1', preset: 'EMPLOYEE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Resend invite/);
  });
});

describe('restoring a deleted cost', () => {
  beforeEach(() => {
    (prisma.cost.update as any).mockResolvedValue({});
    (prisma.activity.create as any).mockResolvedValue({});
  });

  it('is open to whoever can delete one, not only an admin', async () => {
    const auth = ACCOUNTS();
    (prisma.cost.findFirst as any).mockResolvedValue({ id: 'c-1', monthCardId: null, category: 'Office rent', vendor: 'Landlord' });
    const res = await request(app).post('/api/costs/c-1/restore').set(...auth);
    expect(res.status).toBe(200);
    expect((prisma.cost.update as any).mock.calls[0][0].data).toEqual({ deletedAt: null });
  });

  it('will not put a cost back onto a closed month', async () => {
    const auth = ACCOUNTS();
    (prisma.cost.findFirst as any).mockResolvedValue({ id: 'c-1', monthCardId: 'mc-1', category: 'Ad spend', vendor: 'Meta' });
    (prisma.monthCard.findUnique as any).mockResolvedValue({ status: 'CLOSED', month: '2026-09' });
    const res = await request(app).post('/api/costs/c-1/restore').set(...auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/is closed/);
    expect(prisma.cost.update).not.toHaveBeenCalled();
  });
});

describe('the Team tile "Waiting on Clients"', () => {
  it('counts client holds only, and a shared task once', async () => {
    const auth = ADMIN();
    const hold = (id: string, waitingOn: string | null, onClientWork = true) => ({
      task: {
        id,
        status: 'ON_HOLD',
        dueDate: new Date('2026-11-05'),
        assignedAt: new Date('2026-10-20'),
        completedAt: null,
        waitingTotalMinutes: 0,
        waitingOn,
        monthCardId: onClientWork ? 'mc-1' : null,
        projectId: null,
        companyId: null,
      },
    });
    const member = (id: string, tasks: unknown[]) => ({
      id,
      name: id,
      designation: null,
      email: `${id}@x`,
      departmentId: null,
      department: null,
      preset: 'EMPLOYEE',
      monthlyCost: 0,
      permissions: [],
      taskAssignments: tasks,
    });
    (prisma.user.findMany as any).mockResolvedValue([
      // One client hold shared by both, one each waiting on a colleague.
      member('a', [hold('t-shared', 'CLIENT'), hold('t-a', 'ANOTHER_PERSON')]),
      member('b', [hold('t-shared', 'CLIENT'), hold('t-b', 'ANOTHER_PERSON')]),
    ]);
    const res = await request(app).get('/api/team/capacity').set(...auth);
    expect(res.status).toBe(200);
    expect(res.body.waitingOnClientCount).toBe(1);
    // The per-person column still counts every hold.
    expect(res.body.members.map((m: any) => m.waitingTasksCount)).toEqual([2, 2]);
  });
});

describe('exports in words', () => {
  it('turns stored codes into the words the screens use', () => {
    expect(codeWord('PAST', COMPANY_STATUS_WORD)).toBe('Past client');
    expect(codeWord('NOT_CONTACTED')).toBe('Not contacted');
    expect(codeWord('TODO', TASK_STATUS_WORD)).toBe('To do');
    expect(codeWord(null)).toBe('');
    // Already words: left alone.
    expect(codeWord('Cold Outreach')).toBe('Cold Outreach');
    expect(listWord('REAL_ESTATE')).toBe('Real Estate & Infrastructure');
    expect(listWord('Partnerships')).toBe('Outsource');
  });
});
