import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { resolvePermissions, type UserSession } from '../middleware/auth.js';
import { canSeeTask, taskInScope, teamScope } from './teamScope.js';
import { alertsForUser } from '../workers/alertDigest.cron.js';

/**
 * Heads see their own departments (Departments Plan 3).
 *
 *   · Management sees everyone; a Head sees the departments they lead; a Head
 *     who leads nothing still sees everyone, until they are given one.
 *   · A task is a Head's when anybody on it is one of their people, or they
 *     created it or asked for it.
 *   · Each scoped route refuses the rest: detail routes with a 404, lists by
 *     leaving them out.
 *
 * The where clauses the routes build are run against a small in-memory studio
 * rather than inspected by eye, so a test fails on what a Head would SEE.
 */

// ── The studio ──────────────────────────────────────────────────────────────

const PEOPLE = [
  { id: 'usr-boss', name: 'Akmal', preset: RolePreset.MANAGEMENT, departmentId: 'd-mgmt' },
  { id: 'usr-ravi', name: 'Ravi', preset: RolePreset.HEAD, departmentId: 'd-video' },
  { id: 'usr-vid1', name: 'Vikram', preset: RolePreset.EMPLOYEE, departmentId: 'd-video' },
  { id: 'usr-janani', name: 'Janani', preset: RolePreset.HEAD, departmentId: 'd-design' },
  { id: 'usr-des1', name: 'Sneha', preset: RolePreset.EMPLOYEE, departmentId: 'd-design' },
  { id: 'usr-con1', name: 'Priya', preset: RolePreset.EMPLOYEE, departmentId: 'd-content' },
  // Heads two departments.
  { id: 'usr-two', name: 'Dilshad', preset: RolePreset.HEAD, departmentId: 'd-content' },
  // Department head access, no department to lead.
  { id: 'usr-idle', name: 'Charles', preset: RolePreset.HEAD, departmentId: 'd-content' },
  { id: 'usr-acc', name: 'Meena', preset: RolePreset.ACCOUNTS, departmentId: 'd-mgmt' },
  { id: 'usr-emp', name: 'Arun', preset: RolePreset.EMPLOYEE, departmentId: 'd-content' },
].map((p) => ({
  ...p,
  organizationId: 'org-1',
  email: `${p.id}@studio.test`,
  phone: '99999',
  designation: null,
  dept: '',
  permissions: [] as string[],
  active: true,
  inviteToken: null,
  createdAt: new Date('2026-01-01'),
  monthlyCost: null,
  sessionsValidFrom: null,
  taskAssignments: [],
}));
for (const p of PEOPLE) (p as any).department = { id: p.departmentId, name: p.departmentId.slice(2) };
type Who = 'usr-boss' | 'usr-ravi' | 'usr-janani' | 'usr-two' | 'usr-idle' | 'usr-acc' | 'usr-emp';

const DEPARTMENTS = [
  { id: 'd-mgmt', name: 'Management', headId: 'usr-boss', sortOrder: 0 },
  { id: 'd-video', name: 'Video', headId: 'usr-ravi', sortOrder: 1 },
  { id: 'd-design', name: 'Design', headId: 'usr-janani', sortOrder: 2 },
  { id: 'd-content', name: 'Content', headId: 'usr-two', sortOrder: 3 },
  { id: 'd-social', name: 'Social', headId: 'usr-two', sortOrder: 4 },
].map((d) => ({
  ...d,
  organizationId: 'org-1',
  archivedAt: null,
  head: { name: PEOPLE.find((p) => p.id === d.headId)!.name },
  members: PEOPLE.filter((p) => p.departmentId === d.id),
}));

const TASKS = [
  // A Video editor's task, set by Management.
  { id: 't-vid', assigneeIds: ['usr-vid1'], createdById: 'usr-boss', assignedById: 'usr-boss' },
  // A designer's task, nothing to do with Video.
  { id: 't-des', assigneeIds: ['usr-des1'], createdById: 'usr-janani', assignedById: 'usr-janani' },
  // A designer's task that Ravi created.
  { id: 't-made', assigneeIds: ['usr-des1'], createdById: 'usr-ravi', assignedById: 'usr-ravi' },
  // A designer's task Ravi asked for, typed in by somebody else.
  { id: 't-asked', assigneeIds: ['usr-des1'], createdById: 'usr-boss', assignedById: 'usr-ravi' },
  // Shared between Design and Video.
  { id: 't-shared', assigneeIds: ['usr-des1', 'usr-vid1'], createdById: 'usr-janani', assignedById: 'usr-janani' },
].map((t) => ({
  ...t,
  organizationId: 'org-1',
  deletedAt: null,
  status: 'TODO',
  taskType: 'VIDEO',
  assignees: t.assigneeIds.map((id) => ({ user: { id, name: id } })),
  reviews: [],
}));

const ALERTS = [
  { id: 'a-vid', rule: 'TASK_OVERDUE', entityType: 'Task', entityId: 't-vid' },
  { id: 'a-des', rule: 'TASK_OVERDUE', entityType: 'Task', entityId: 't-des' },
  { id: 'a-load-vid', rule: 'MEMBER_OVERALLOCATED', entityType: 'User', entityId: 'usr-vid1' },
  { id: 'a-load-des', rule: 'MEMBER_OVERALLOCATED', entityType: 'User', entityId: 'usr-des1' },
  { id: 'a-kit', rule: 'ASSET_OVERDUE', entityType: 'Asset', entityId: 'as-1' },
].map((a) => ({
  ...a,
  organizationId: 'org-1',
  resolvedAt: null,
  severity: 'MED',
  message: a.id,
  createdAt: new Date(),
}));

const EVENTS = [
  // Booked by a designer, with designers on it.
  { id: 'ev-des', createdById: 'usr-des1', attendees: [{ userId: 'usr-des1' }] },
  // Booked by a designer, with a Video editor on it.
  { id: 'ev-vid', createdById: 'usr-des1', attendees: [{ userId: 'usr-des1' }, { userId: 'usr-vid1' }] },
].map((e) => ({
  ...e,
  organizationId: 'org-1',
  title: e.id,
  startsAt: new Date('2026-10-05T04:30:00Z'),
  endsAt: new Date('2026-10-05T05:30:00Z'),
  allDay: false,
  location: null,
  createdBy: { id: e.createdById, name: 'Sneha' },
  kind: 'MEETING',
  deletedAt: null,
}));

/**
 * Prisma's where, run in memory — the operators these routes use and nothing
 * more. An operator it does not know (a date range, say) is treated as a match,
 * so it never hides a row for a reason that is not the scope.
 */
function matches(row: any, where: any): boolean {
  for (const [key, want] of Object.entries(where ?? {})) {
    if (key === 'AND') {
      if (!(want as any[]).every((w) => matches(row, w))) return false;
    } else if (key === 'OR') {
      if (!(want as any[]).some((w) => matches(row, w))) return false;
    } else if (key === 'NOT') {
      if (matches(row, want)) return false;
    } else if (key === 'assignees') {
      const some = (want as any).some;
      const ids: string[] = row.assigneeIds;
      const who = some?.userId;
      if (typeof who === 'string' && !ids.includes(who)) return false;
      if (who?.in && !ids.some((id) => who.in.includes(id))) return false;
    } else if (want === null) {
      if (row[key] != null) return false;
    } else if (typeof want === 'object' && !(want instanceof Date)) {
      const op = want as any;
      if ('in' in op && !op.in.includes(row[key])) return false;
      if ('not' in op && (op.not === null ? row[key] == null : row[key] === op.not)) return false;
    } else if (row[key] !== want) {
      return false;
    }
  }
  return true;
}

const session = (id: Who): UserSession => {
  const p = PEOPLE.find((x) => x.id === id)!;
  return {
    userId: p.id,
    organizationId: 'org-1',
    email: p.email,
    name: p.name,
    preset: p.preset,
    permissions: resolvePermissions(p.preset, []),
    active: true,
  };
};

const as = (id: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: id,
      organizationId: 'org-1',
      email: `${id}@studio.test`,
      preset: PEOPLE.find((p) => p.id === id)!.preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[PEOPLE.find((p) => p.id === id)!.preset]],
    })}`,
  ] as const;

beforeEach(() => {
  const p = prisma as any;
  p.user.findUnique.mockImplementation(async ({ where }: any) => PEOPLE.find((x) => x.id === where.id) ?? null);
  p.user.findMany.mockImplementation(async ({ where }: any) => PEOPLE.filter((x) => matches(x, where)));
  p.user.findFirst.mockImplementation(async ({ where }: any) => PEOPLE.find((x) => matches(x, where)) ?? null);
  p.user.count.mockImplementation(async ({ where }: any) => PEOPLE.filter((x) => matches(x, where)).length);
  p.department.findMany.mockImplementation(async ({ where }: any) => DEPARTMENTS.filter((d) => matches(d, where)));
  p.task.findMany.mockImplementation(async ({ where }: any) => TASKS.filter((t) => matches(t, where)));
  p.task.findFirst.mockImplementation(async ({ where }: any) => TASKS.find((t) => matches(t, where)) ?? null);
  p.task.count.mockImplementation(async ({ where }: any) => TASKS.filter((t) => matches(t, where)).length);
  p.alert.findMany.mockImplementation(async ({ where }: any) => ALERTS.filter((a) => matches(a, where)));
  p.alert.count.mockImplementation(async ({ where }: any) => ALERTS.filter((a) => matches(a, where)).length);
  p.alertRead.findMany.mockResolvedValue([]);
  p.taskApprover.findMany.mockResolvedValue([]);
  p.approvalEscalationContact.findMany.mockResolvedValue([]);
  p.calendarEvent.findFirst.mockImplementation(async ({ where }: any) => EVENTS.find((e) => e.id === where.id) ?? null);
  p.calendarEvent.findMany.mockResolvedValue(EVENTS);
  p.organization.findUnique.mockResolvedValue({
    timezone: 'Asia/Kolkata',
    workingDays: [1, 2, 3, 4, 5, 6],
    holidays: [],
    googleCalendarEnabled: false,
  });
  p.activity.create.mockResolvedValue({});
  p.$transaction.mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : []));
});

/** Which of the in-memory tasks a where clause lets through. */
const tasksFor = (where: any) => TASKS.filter((t) => matches(t, where)).map((t) => t.id);

// ── The rule ────────────────────────────────────────────────────────────────

describe('teamScope', () => {
  it('Management sees everyone', async () => {
    expect(await teamScope(session('usr-boss'))).toEqual({ all: true });
  });

  it('a Head sees the department they lead, and its people', async () => {
    const scope = await teamScope(session('usr-ravi'));
    expect(scope).toEqual({
      all: false,
      departments: [{ id: 'd-video', name: 'Video', peopleCount: 2 }],
      departmentIds: ['d-video'],
      peopleIds: ['usr-ravi', 'usr-vid1'],
    });
  });

  it('a Head of two sees both', async () => {
    const scope = await teamScope(session('usr-two'));
    expect(scope.all).toBe(false);
    if (scope.all) return;
    expect(scope.departmentIds).toEqual(['d-content', 'd-social']);
    expect(scope.peopleIds).toEqual(expect.arrayContaining(['usr-con1', 'usr-two', 'usr-idle', 'usr-emp']));
  });

  it('a Head who leads no department still sees everyone', async () => {
    expect(await teamScope(session('usr-idle'))).toEqual({ all: true });
  });

  it('is not about anybody without Team work', async () => {
    expect(await teamScope(session('usr-acc'))).toEqual({ all: true });
    expect(await teamScope(session('usr-emp'))).toEqual({ all: true });
  });

  it('reads the departments once per request', async () => {
    const me = session('usr-ravi');
    await teamScope(me);
    await teamScope(me);
    expect(prisma.department.findMany).toHaveBeenCalledTimes(1);
  });

  it("a Head's work: anybody on it is theirs, or they created or asked for it", async () => {
    const where = await taskInScope(session('usr-ravi'), { organizationId: 'org-1', deletedAt: null });
    expect(tasksFor(where).sort()).toEqual(['t-asked', 't-made', 't-shared', 't-vid']);
  });

  it("Management's work is everything", async () => {
    const where = await taskInScope(session('usr-boss'), { organizationId: 'org-1' });
    expect(tasksFor(where)).toHaveLength(TASKS.length);
  });

  it('answers one task', async () => {
    expect(await canSeeTask(session('usr-ravi'), 't-des')).toBe(false);
    expect(await canSeeTask(session('usr-ravi'), 't-made')).toBe(true);
    expect(await canSeeTask(session('usr-boss'), 't-des')).toBe(true);
  });
});

// ── Each route ──────────────────────────────────────────────────────────────

describe('the Team screen', () => {
  it('lists only the Head’s people and departments', async () => {
    const res = await request(app).get('/api/team/capacity').set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: any) => m.id).sort()).toEqual(['usr-ravi', 'usr-vid1']);
    expect(res.body.departments.map((d: any) => d.id)).toEqual(['d-video']);
  });

  it('is "not on this team" for somebody in another department', async () => {
    const res = await request(app).get('/api/team/usr-des1').set(...as('usr-ravi'));
    expect(res.status).toBe(404);
  });

  it('opens anybody for Management, and for a Head who leads nothing', async () => {
    expect((await request(app).get('/api/team/usr-des1').set(...as('usr-boss'))).status).toBe(200);
    expect((await request(app).get('/api/team/usr-des1').set(...as('usr-idle'))).status).toBe(200);
  });

  it('says whose people they are', async () => {
    const res = await request(app).get('/api/team/scope').set(...as('usr-ravi'));
    expect(res.body.scope).toEqual({ all: false, departments: [{ id: 'd-video', name: 'Video', peopleCount: 2 }] });
    expect((await request(app).get('/api/team/scope').set(...as('usr-boss'))).body.scope).toEqual({ all: true });
  });

  it('still offers everybody to assign to, and only their people when asked', async () => {
    const all = await request(app).get('/api/team/members').set(...as('usr-ravi'));
    expect(all.body.members).toHaveLength(PEOPLE.length);
    const mine = await request(app).get('/api/team/members?scoped=1').set(...as('usr-ravi'));
    expect(mine.body.members.map((m: any) => m.id).sort()).toEqual(['usr-ravi', 'usr-vid1']);
  });
});

describe('people details', () => {
  it('gives a Head the email and phone of their people and themselves only', async () => {
    const res = await request(app).get('/api/users').set(...as('usr-ravi'));
    const byId = new Map(res.body.map((u: any) => [u.id, u]));
    expect((byId.get('usr-vid1') as any).email).toBe('usr-vid1@studio.test');
    expect((byId.get('usr-ravi') as any).email).toBe('usr-ravi@studio.test');
    expect((byId.get('usr-des1') as any).email).toBeUndefined();
    expect((byId.get('usr-des1') as any).phone).toBeUndefined();
    // Still in the list, the picker way.
    expect((byId.get('usr-des1') as any).name).toBe('Sneha');
  });
});

describe('All work', () => {
  beforeEach(() => {
    const p = prisma as any;
    for (const m of [p.project, p.monthCard, p.company, p.retainerProject, p.internalProject]) m.findMany.mockResolvedValue([]);
    // The list reads every column of a task; the scope is in the where, so
    // that is what is judged.
    p.task.findMany.mockResolvedValue([]);
  });

  it('shows a Head only their departments’ work, even with work.all', async () => {
    const res = await request(app).get('/api/tasks/all').set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    const where = (prisma.task.findMany as any).mock.calls[0][0].where;
    expect(tasksFor(where).sort()).toEqual(['t-asked', 't-made', 't-shared', 't-vid']);
  });

  it('shows Management everything', async () => {
    await request(app).get('/api/tasks/all').set(...as('usr-boss'));
    const where = (prisma.task.findMany as any).mock.calls[0][0].where;
    expect(tasksFor(where)).toHaveLength(TASKS.length);
  });
});

describe("somebody else's task", () => {
  it('is not found when a Head edits one outside their departments', async () => {
    const res = await request(app).patch('/api/tasks/t-des').set(...as('usr-ravi')).send({ title: 'Mine now' });
    expect(res.status).toBe(404);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('is not found when a Head changes its status, holds it or deletes it', async () => {
    expect((await request(app).patch('/api/tasks/t-des/status').set(...as('usr-ravi')).send({ status: 'DONE' })).status).toBe(404);
    expect((await request(app).post('/api/tasks/t-des/resume').set(...as('usr-ravi'))).status).toBe(404);
    expect((await request(app).delete('/api/tasks/t-des').set(...as('usr-ravi'))).status).toBe(404);
  });

  it('is not found when a Head opens its reviews', async () => {
    const res = await request(app).get('/api/tasks/t-des/reviews').set(...as('usr-ravi'));
    expect(res.status).toBe(404);
  });
});

describe('the calendar', () => {
  it("shows a Head's team layer as their departments' work", async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/calendar?from=2026-10-01&to=2026-10-31&layers=team')
      .set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    const where = (prisma.task.findMany as any).mock.calls[0][0].where;
    expect(tasksFor(where).sort()).toEqual(['t-asked', 't-made', 't-shared', 't-vid']);
  });

  /** Which events this person may move, as the calendar draws them. */
  const movable = async (who: Who) => {
    const res = await request(app).get('/api/calendar?from=2026-10-01&to=2026-10-31&layers=events').set(...as(who));
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.items.map((i: any) => [i.id, i.draggable]));
  };

  it('lets a Head change an event only when one of their people is on it', async () => {
    expect(await movable('usr-ravi')).toEqual({ 'event:ev-des': false, 'event:ev-vid': true });
    const res = await request(app).delete('/api/calendar/events/ev-des').set(...as('usr-ravi'));
    expect(res.status).toBe(403);
  });

  it('shows every event to a Head, and lets Management change any', async () => {
    expect(Object.keys(await movable('usr-ravi'))).toHaveLength(EVENTS.length);
    expect(await movable('usr-boss')).toEqual({ 'event:ev-des': true, 'event:ev-vid': true });
  });
});

describe('team alerts', () => {
  it("reach a Head only about their own people, in the bell", async () => {
    const res = await request(app).get('/api/notifications').set(...as('usr-ravi'));
    expect(res.body.notifications.map((n: any) => n.id).sort()).toEqual(['a-kit', 'a-load-vid', 'a-vid']);
  });

  it('and in the morning digest, by the same rule', async () => {
    const alerts = await alertsForUser('org-1', { userId: 'usr-ravi', preset: 'HEAD', permissions: [] });
    expect(alerts.map((a) => a.id).sort()).toEqual(['a-kit', 'a-load-vid', 'a-vid']);
  });

  it('reach Management about everybody', async () => {
    const res = await request(app).get('/api/notifications').set(...as('usr-boss'));
    expect(res.body.notifications).toHaveLength(ALERTS.length);
  });

  it("refuse to mark read an alert about somebody else's people", async () => {
    (prisma.alert.findFirst as any).mockResolvedValue(ALERTS.find((a) => a.id === 'a-des'));
    const res = await request(app).patch('/api/notifications/a-des/read').set(...as('usr-ravi'));
    expect(res.status).toBe(403);
  });
});

describe('confirming the time split', () => {
  it('refuses a Head confirming somebody outside their departments', async () => {
    const res = await request(app)
      .post('/api/allocations/confirm')
      .set(...as('usr-ravi'))
      .send({ month: '2026-10', userIds: ['usr-des1'] });
    expect(res.status).toBe(403);
    expect(prisma.peopleAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("confirms all of a Head's own people when none are named", async () => {
    (prisma.peopleAllocation.updateMany as any).mockResolvedValue({ count: 2 });
    const res = await request(app).post('/api/allocations/confirm').set(...as('usr-ravi')).send({ month: '2026-10' });
    expect(res.status).toBe(200);
    const where = (prisma.peopleAllocation.updateMany as any).mock.calls[0][0].where;
    const whose = PEOPLE.filter((p) => matches(p, where.user)).map((p) => p.id).sort();
    expect(whose).toEqual(['usr-ravi', 'usr-vid1']);
  });

  it('lets Accounts confirm anybody', async () => {
    (prisma.peopleAllocation.updateMany as any).mockResolvedValue({ count: 1 });
    const res = await request(app)
      .post('/api/allocations/confirm')
      .set(...as('usr-acc'))
      .send({ month: '2026-10', userIds: ['usr-des1'] });
    expect(res.status).toBe(200);
  });
});

describe('Settings → Departments', () => {
  it('names the people with Department head access who lead nothing', async () => {
    const res = await request(app).get('/api/departments?withPeople=1').set(...as('usr-boss'));
    expect(res.body.headsLeadingNothing).toEqual([{ id: 'usr-idle', name: 'Charles' }]);
  });
});
