import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

/**
 * My Department (Department head page plan): who may open a department's
 * page, and what its overview and work say.
 *
 * Ravi heads Development; Priya heads Video; Akmal is Management and heads
 * nothing; Janani and Vikram are in Development; Arun is in Video.
 */

const PEOPLE = [
  { id: 'usr-akmal', name: 'Akmal', preset: RolePreset.MANAGEMENT, departmentId: 'd-mgmt', phone: null },
  { id: 'usr-ravi', name: 'Ravi', preset: RolePreset.HEAD, departmentId: 'd-dev', phone: '98400 11223' },
  { id: 'usr-janani', name: 'Janani', preset: RolePreset.EMPLOYEE, departmentId: 'd-dev', phone: null },
  { id: 'usr-vikram', name: 'Vikram', preset: RolePreset.EMPLOYEE, departmentId: 'd-dev', phone: '98765 43210' },
  { id: 'usr-priya', name: 'Priya', preset: RolePreset.HEAD, departmentId: 'd-video', phone: null },
  { id: 'usr-arun', name: 'Arun', preset: RolePreset.EMPLOYEE, departmentId: 'd-video', phone: null },
].map((x) => ({
  ...x,
  organizationId: 'org-1',
  email: `${x.id}@studio.test`,
  designation: null,
  permissions: [] as string[],
  active: true,
  sessionsValidFrom: null,
  focusTaskId: null,
  monthlyCost: 90000,
  dept: x.departmentId,
  department: { name: x.departmentId.slice(2) },
  organization: { id: 'org-1', name: 'EyeLevel', currency: 'INR', timezone: 'Asia/Kolkata', proformaPrefix: 'EL' },
}));
type Who = (typeof PEOPLE)[number]['id'];
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
    } as never)}`,
  ] as const;

const DEPARTMENTS = [
  { id: 'd-mgmt', name: 'Management', headId: null as string | null },
  { id: 'd-dev', name: 'Development', headId: 'usr-ravi' },
  { id: 'd-video', name: 'Video', headId: 'usr-priya' },
].map((d, i) => ({ ...d, organizationId: 'org-1', archivedAt: null, sortOrder: i, head: d.headId ? { name: person(d.headId).name } : null }));

const p = prisma as any;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** Enough of Prisma's where to answer the people queries: id, department, active, AND. */
function matches(u: (typeof PEOPLE)[number], where: any): boolean {
  if (!where) return true;
  if (where.AND) return where.AND.every((w: any) => matches(u, w));
  if (where.OR) return where.OR.some((w: any) => matches(u, w));
  if (where.id !== undefined && (typeof where.id === 'string' ? u.id !== where.id : !where.id.in.includes(u.id))) return false;
  if (where.active !== undefined && u.active !== where.active) return false;
  if (where.departmentId !== undefined) {
    const d = where.departmentId;
    if (d && typeof d === 'object' && 'in' in d ? !d.in.includes(u.departmentId) : u.departmentId !== d) return false;
  }
  return true;
}

const task = (id: string, assigneeIds: string[], over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  organizationId: 'org-1',
  assignees: assigneeIds.map((u) => ({ user: { id: u, name: person(u).name, designation: null, dept: '' } })),
  status: 'TODO',
  priority: 'MEDIUM',
  taskType: null,
  workType: 'INTERNAL',
  internalProjectId: null,
  dueDate: day('2026-10-27'),
  dueTime: null,
  assignedAt: day('2026-10-01'),
  createdAt: day('2026-10-01'),
  completedAt: null,
  reopenCount: 0,
  notes: null,
  waitingOn: null,
  waitingSince: null,
  repeat: null,
  monthCardId: null,
  projectId: null,
  companyId: null,
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Monday 26 October 2026, 11:30 in Chennai — after the 25th.
  vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
  p.user.findUnique.mockImplementation(async ({ where }: any) => PEOPLE.find((u) => u.id === where.id) ?? null);
  // By name, as the routes ask for them.
  p.user.findMany.mockImplementation(async ({ where }: any) =>
    PEOPLE.filter((u) => matches(u, where)).sort((a, b) => a.name.localeCompare(b.name)),
  );
  p.department.findFirst.mockImplementation(async ({ where }: any) => DEPARTMENTS.find((d) => d.id === where.id && d.organizationId === where.organizationId) ?? null);
  p.department.findMany.mockImplementation(async ({ where }: any) =>
    DEPARTMENTS.filter((d) => (where?.headId === undefined ? true : d.headId === where.headId)),
  );
  p.organization.findUnique.mockResolvedValue({
    timezone: 'Asia/Kolkata',
    workingHoursStart: '09:30',
    workingHoursEnd: '18:30',
    workingDays: [1, 2, 3, 4, 5, 6],
    holidays: [],
  });
  for (const model of [
    'task',
    'taskAssignee',
    'calendarEvent',
    'asset',
    'assetReservation',
    'peopleAllocation',
    'internalProject',
  ] as const) {
    p[model].findMany.mockResolvedValue([]);
  }
});
afterEach(() => vi.useRealTimers());

// ── Who may open it ─────────────────────────────────────────────────────────

describe("a department's page: its head, or Management — nobody else", () => {
  it.each([
    ['Ravi, its head', 'usr-ravi', 200],
    ['Akmal, Management (not a head)', 'usr-akmal', 200],
    ['Janani, an employee in it', 'usr-janani', 403],
    ["Priya, another department's head", 'usr-priya', 403],
  ] as const)('%s → %i', async (_label, who, status) => {
    for (const path of ['overview', 'work']) {
      const res = await request(app).get(`/api/departments/d-dev/${path}`).set(...as(who));
      expect(res.status, path).toBe(status);
    }
  });

  it('answers 404 for a department that is not there', async () => {
    const res = await request(app).get('/api/departments/d-nope/overview').set(...as('usr-akmal'));
    expect(res.status).toBe(404);
  });

  it('tells the sidebar which departments a person heads', async () => {
    const ravi = await request(app).get('/api/auth/me').set(...as('usr-ravi'));
    expect(ravi.body.user.headOf).toEqual(['d-dev']);
    const akmal = await request(app).get('/api/auth/me').set(...as('usr-akmal'));
    expect(akmal.body.user.headOf).toEqual([]);
  });
});

// ── The overview ────────────────────────────────────────────────────────────

describe('the overview: its people only, with their cards and what needs attention', () => {
  beforeEach(() => {
    p.task.findMany.mockResolvedValue([
      task('t-late', ['usr-janani'], { dueDate: day('2026-10-20') }),
      task('t-hold', ['usr-vikram'], { status: 'ON_HOLD', dueDate: day('2026-10-30') }),
    ]);
    p.calendarEvent.findMany.mockResolvedValue([
      {
        id: 'ev-1',
        kind: 'SHOOT',
        title: 'Acme shoot',
        startsAt: new Date('2026-10-26T08:30:00Z'),
        endsAt: new Date('2026-10-26T10:30:00Z'),
        allDay: false,
        location: 'Studio B',
        attendees: [{ userId: 'usr-vikram' }],
      },
    ]);
    p.asset.findMany.mockResolvedValue([
      {
        id: 'a-cam',
        tag: 'EL/CAM/001',
        name: 'Sony A7 IV',
        category: 'CAMERA',
        status: 'BOOKED_OUT',
        currentHolderId: 'usr-vikram',
        movements: [{ kind: 'BOOKING', dueAt: new Date('2026-10-23T12:30:00Z'), outAt: new Date('2026-10-20T04:00:00Z') }],
      },
    ]);
    // Vikram's split is confirmed; Janani's is not; Ravi has none.
    p.peopleAllocation.findMany.mockResolvedValue([
      { userId: 'usr-vikram', confirmedAt: new Date('2026-10-25T10:00:00Z') },
      { userId: 'usr-janani', confirmedAt: null },
    ]);
  });

  it("is Development's people, through the head's team scope — never Video's", async () => {
    const res = await request(app).get('/api/departments/d-dev/overview').set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    expect(res.body.department).toMatchObject({ id: 'd-dev', name: 'Development', headName: 'Ravi', peopleCount: 3 });
    expect(res.body.people.map((x: any) => x.name)).toEqual(['Janani', 'Ravi', 'Vikram']);
    // The board's compute was asked for these three and nobody else.
    const asked = p.task.findMany.mock.calls[0][0].where.assignees.some.userId.in;
    expect([...asked].sort()).toEqual(['usr-janani', 'usr-ravi', 'usr-vikram']);
  });

  it('gives each card its contact, counts, today and gear — and no pay', async () => {
    const res = await request(app).get('/api/departments/d-dev/overview').set(...as('usr-ravi'));
    const vikram = res.body.people.find((x: any) => x.id === 'usr-vikram');
    expect(vikram).toMatchObject({ phone: '98765 43210', email: 'usr-vikram@studio.test' });
    expect(vikram.lists.waiting).toEqual(['t-hold']);
    expect(vikram.todayEvents).toEqual([
      { id: 'ev-1', kind: 'SHOOT', title: 'Acme shoot', location: 'Studio B', allDay: false, time: '14:00', endTime: '16:00' },
    ]);
    expect(vikram.gear[0]).toMatchObject({ tag: 'EL/CAM/001', kind: 'BOOKING', overdue: true, daysOverdue: 2 });
    const janani = res.body.people.find((x: any) => x.id === 'usr-janani');
    expect(janani.lists.overdue).toEqual(['t-late']);
    expect(JSON.stringify(res.body)).not.toMatch(/monthlyCost|salary|90000/);
  });

  it('needs attention: the overdue task, the gear late back, and — after the 25th — the unconfirmed split', async () => {
    const res = await request(app).get('/api/departments/d-dev/overview').set(...as('usr-ravi'));
    const kinds = res.body.attention.map((a: any) => a.kind);
    expect(kinds).toEqual(['TASK', 'GEAR_OVERDUE', 'TIME_SPLIT']);
    expect(res.body.attention[0]).toEqual({ kind: 'TASK', taskId: 't-late', reasons: ['OVERDUE'] });
    expect(res.body.attention[1]).toMatchObject({ assetId: 'a-cam', holder: { id: 'usr-vikram', name: 'Vikram' } });
    // Nothing entered is not confirmed either.
    expect(res.body.attention[2]).toMatchObject({ month: '2026-10', people: [{ name: 'Janani' }, { name: 'Ravi' }] });
  });

  it('says nothing about the split before the 25th', async () => {
    vi.setSystemTime(new Date('2026-10-20T06:00:00Z'));
    const res = await request(app).get('/api/departments/d-dev/overview').set(...as('usr-ravi'));
    expect(res.body.attention.map((a: any) => a.kind)).not.toContain('TIME_SPLIT');
  });
});

// ── The work ────────────────────────────────────────────────────────────────

describe('the work: by client, then retainer or project; and the internal projects', () => {
  it('counts the open and overdue work its people are on, and the next deadline', async () => {
    const acme = { id: 'co-acme', name: 'Acme' };
    p.task.findMany.mockResolvedValue([
      task('t-1', ['usr-janani'], { dueDate: day('2026-10-22'), monthCardId: 'mc-1', monthCard: { retainerId: 'r-1', retainer: { id: 'r-1', company: acme } } }),
      task('t-2', ['usr-janani', 'usr-arun'], { dueDate: day('2026-10-29'), monthCardId: 'mc-1', monthCard: { retainerId: 'r-1', retainer: { id: 'r-1', company: acme } } }),
      task('t-3', ['usr-vikram'], { dueDate: day('2026-11-02'), projectId: 'p-1', project: { id: 'p-1', name: 'Website build', company: acme } }),
      task('t-4', ['usr-vikram'], { status: 'ON_HOLD', dueDate: day('2026-10-30'), projectId: 'p-1', project: { id: 'p-1', name: 'Website build', company: acme } }),
    ]);
    p.internalProject.findMany.mockResolvedValue([
      {
        id: 'ip-1',
        name: 'Design system',
        status: 'ACTIVE',
        targetDate: day('2026-11-05'),
        owner: { id: 'usr-ravi', name: 'Ravi' },
        tasks: [
          { id: 'i1', title: 'Tokens', status: 'DONE', dueDate: day('2026-10-10'), assignees: [{ user: { id: 'usr-ravi', name: 'Ravi' } }] },
          { id: 'i2', title: 'Buttons', status: 'TODO', dueDate: day('2026-10-24'), assignees: [{ user: { id: 'usr-janani', name: 'Janani' } }] },
          { id: 'i3', title: 'Forms', status: 'TODO', dueDate: day('2026-11-01'), assignees: [{ user: { id: 'usr-janani', name: 'Janani' } }] },
          { id: 'i4', title: 'Old idea', status: 'CANCELLED', dueDate: day('2026-10-01'), assignees: [] },
        ],
      },
    ]);

    const res = await request(app).get('/api/departments/d-dev/work').set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    // Only the department's own internal projects.
    expect(p.internalProject.findMany.mock.calls[0][0].where).toMatchObject({ departmentId: 'd-dev', status: 'ACTIVE' });

    expect(res.body.clients).toHaveLength(1);
    const [retainer, project] = res.body.clients[0].items;
    expect(retainer).toMatchObject({
      kind: 'RETAINER',
      href: '/retainers/r-1',
      open: 2,
      overdue: 1,
      // Arun is on t-2, but he is Video's.
      people: [{ id: 'usr-janani', name: 'Janani' }],
      nextDeadline: { taskId: 't-1', dueDate: '2026-10-22' },
    });
    expect(project).toMatchObject({ kind: 'PROJECT', name: 'Website build', href: '/projects/p-1', open: 2, overdue: 0 });

    expect(res.body.internalProjects[0]).toMatchObject({
      name: 'Design system',
      href: '/internal-projects/ip-1',
      percentDone: 33,
      open: 2,
      overdue: 1,
      daysLeft: 10,
      targetDate: '2026-11-05',
    });
  });
});

// ── The reused routes, narrowed to one department ───────────────────────────

describe('the reused routes, narrowed to the department', () => {
  it("time split: that department's people, percentages only — even for Management", async () => {
    p.user.findMany.mockImplementation(async ({ where }: any) =>
      PEOPLE.filter((u) => matches(u, where)).map((u) => ({ ...u, allocations: [] })),
    );
    const res = await request(app).get('/api/allocations?month=2026-10&departmentId=d-dev').set(...as('usr-akmal'));
    expect(res.status).toBe(200);
    expect(res.body.canSeeFigures).toBe(false);
    expect(res.body.members.map((m: any) => m.name).sort()).toEqual(['Janani', 'Ravi', 'Vikram']);
    expect(res.body.members.every((m: any) => m.monthlyCost === null)).toBe(true);
  });

  it("calendar: meetings and Google busy time for the department's people only", async () => {
    const res = await request(app)
      .get('/api/calendar?from=2026-10-26&to=2026-11-01&layers=events,team&onlyDepartment=d-dev')
      .set(...as('usr-ravi'));
    expect(res.status).toBe(200);
    const events = p.calendarEvent.findMany.mock.calls[0][0].where;
    expect(events.attendees).toEqual({ some: { user: { departmentId: 'd-dev', active: true } } });
  });
});
