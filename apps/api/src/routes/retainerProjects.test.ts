import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Projects inside a retainer.
 *
 * A retainer client buys a Diwali campaign, an always-on content stream, a
 * brand film — not "six tasks in September". Those run across month
 * boundaries, and the rules that matter are the ones that keep that true
 * without disturbing the money:
 *
 *   · a project carries no value, ever, because the retainer is already billed
 *     monthly and a second figure would count the same work twice;
 *   · a task belongs to a project AND to a month card, never one instead of
 *     the other — that is what lets October and November tasks sit in one
 *     campaign while each month's profit stays its own;
 *   · a project and a month card must belong to the same retainer;
 *   · deleting a project moves its tasks into the retainer's default rather
 *     than orphaning them, because a closed month's figures are not something
 *     a tidy-up may change — and because ungrouped retainer work no longer
 *     exists at all.
 */

const PM = {
  id: 'usr-pm',
  preset: RolePreset.HEAD,
  permissions: ['work.own', 'work.all', 'work.team'],
};

const auth = () =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PM.id,
      organizationId: 'org-1',
      email: 'pm@eyelevel.local',
      preset: PM.preset,
      permissions: [...PM.permissions],
    })}`,
  ] as const;

let written: { project?: any; task?: any; deleted?: any };

beforeEach(() => {
  written = {};
  (prisma.user.findUnique as any).mockResolvedValue({
    id: PM.id,
    organizationId: 'org-1',
    name: 'Tanuja',
    email: 'pm@eyelevel.local',
    preset: PM.preset,
    permissions: [...PM.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.retainer.findFirst as any).mockResolvedValue({ id: 'ret-1' });
  (prisma.activity.create as any).mockResolvedValue({});
  (prisma.user.findFirst as any).mockResolvedValue({ id: 'usr-varsha' });
  (prisma.retainerProject.create as any).mockImplementation(async ({ data }: any) => {
    written.project = data;
    return { id: 'rp-1', ...data, owner: null, _count: { tasks: 0 } };
  });
  (prisma.retainerProject.update as any).mockImplementation(async ({ data }: any) => {
    written.project = data;
    return { id: 'rp-1', ...data, owner: null, _count: { tasks: 0 } };
  });
  (prisma.retainerProject.delete as any).mockImplementation(async (args: any) => {
    written.deleted = args.where;
    return { id: 'rp-1' };
  });
});

const create = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/retainers/ret-1/projects')
    .set(...auth())
    .send({ name: 'Diwali Campaign', ...body });

describe('creating a project on a retainer', () => {
  it('stores the name and the dates', async () => {
    const res = await create({ startDate: '2026-10-01', endDate: '2026-11-15', ownerId: 'usr-varsha' });
    expect(res.status).toBe(201);
    expect(written.project.name).toBe('Diwali Campaign');
    expect(written.project.retainerId).toBe('ret-1');
    expect(written.project.startDate).toEqual(new Date('2026-10-01'));
    expect(written.project.endDate).toEqual(new Date('2026-11-15'));
  });

  it('treats no end date as ongoing rather than missing', async () => {
    const res = await create({ startDate: '2026-09-01' });
    expect(res.status).toBe(201);
    expect(written.project.endDate).toBeNull();
  });

  it('never writes a value — a retainer project carries no money', async () => {
    const res = await create({ quotedValue: 150000, amount: 999, monthlyValue: 1 });
    expect(res.status).toBe(201);
    // Whatever a caller sends, none of it becomes a figure on this row. The
    // retainer's month cards are the only place its revenue is counted.
    expect(Object.keys(written.project)).toEqual(
      expect.not.arrayContaining(['quotedValue', 'amount', 'monthlyValue', 'value', 'revenue']),
    );
  });

  it('refuses an end date before the start', async () => {
    const res = await create({ startDate: '2026-11-01', endDate: '2026-10-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/before the start/i);
  });

  it('refuses a nameless project', async () => {
    const res = await create({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('refuses an owner who is not on the team', async () => {
    (prisma.user.findFirst as any).mockResolvedValue(null);
    const res = await create({ ownerId: 'usr-stranger' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not on this team/i);
  });

  it('will not add a project to another organisation’s retainer', async () => {
    (prisma.retainer.findFirst as any).mockResolvedValue(null);
    const res = await create({});
    expect(res.status).toBe(404);
  });
});

describe('deleting a project', () => {
  it('moves the work it held into the default, rather than orphaning it', async () => {
    /*
     * It used to null the tasks' project and leave them on their month cards.
     * That is no longer a state a task can be in — a month-card task names a
     * project, and the database enforces it — so the delete would fail on a
     * CHECK with an error nobody could read. They go to the default, which is
     * what "the campaign is over, the work still happened" actually means.
     */
    (prisma.retainerProject.findFirst as any)
      .mockResolvedValueOnce({ id: 'rp-1', name: 'Diwali Campaign', retainerId: 'ret-1', isDefault: false, _count: { tasks: 7 } })
      .mockResolvedValueOnce({ id: 'rp-default', name: 'Monthly Retainer Work' });
    (prisma.task.updateMany as any).mockResolvedValue({ count: 7 });

    const res = await request(app)
      .delete('/api/retainers/ret-1/projects/rp-1')
      .set(...auth());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tasksMoved: 7, movedTo: 'Monthly Retainer Work' });
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { retainerProjectId: 'rp-1' },
      data: { retainerProjectId: 'rp-default' },
    });
    expect(written.deleted).toEqual({ id: 'rp-1' });
  });

  it('refuses to delete the one the monthly work falls into', async () => {
    // Deleting it would leave the next 1st-of-month roll with nowhere to spawn
    // the template, and every existing task on it in a state the CHECK forbids.
    (prisma.retainerProject.findFirst as any).mockResolvedValue({
      id: 'rp-default', name: 'Monthly Retainer Work', retainerId: 'ret-1', isDefault: true, _count: { tasks: 12 },
    });

    const res = await request(app)
      .delete('/api/retainers/ret-1/projects/rp-default')
      .set(...auth());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be removed/i);
    expect(written.deleted).toBeUndefined();
  });

  it('will not delete a project belonging to a different retainer', async () => {
    (prisma.retainerProject.findFirst as any).mockResolvedValue(null);
    const res = await request(app)
      .delete('/api/retainers/ret-1/projects/rp-other')
      .set(...auth());
    expect(res.status).toBe(404);
  });
});

// ── The task pairing ────────────────────────────────────────────────────────

describe('a task on a retainer project', () => {
  beforeEach(() => {
    (prisma.$transaction as any).mockImplementation(async (fn: any) => (typeof fn === 'function' ? fn(prisma) : fn));
    // `resolvePeople` reads this to check everybody named is on the team.
    (prisma.user.findMany as any).mockResolvedValue([{ id: PM.id }]);
    (prisma.task.create as any).mockImplementation(async ({ data }: any) => {
      written.task = data;
      // Join included, the way Prisma returns it when the route asks for it.
      return { id: 'task-1', ...data, assignees: (data.assignees?.create ?? []).map((a: any) => ({ user: { id: a.userId, name: a.userId, designation: null } })) };
    });
  });

  const makeTask = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/tasks')
      .set(...auth())
      .send({
        title: 'Ad Creatives Batch 1',
        workType: 'MONTH_CARD',
        monthCardId: 'mc-oct',
        dueDate: '2026-10-12',
        assigneeId: PM.id,
        ...body,
      });

  it('keeps its month card as well as its project', async () => {
    (prisma.retainerProject.findFirst as any).mockResolvedValue({ id: 'rp-1' });
    const res = await makeTask({ retainerProjectId: 'rp-1' });
    expect(res.status).toBe(201);
    // Both. The month card says which month it is billed and costed in; the
    // project says what it is for.
    expect(written.task.monthCardId).toBe('mc-oct');
    expect(written.task.retainerProjectId).toBe('rp-1');
  });

  it('refuses a project whose retainer does not own that month', async () => {
    (prisma.retainerProject.findFirst as any).mockResolvedValue(null);
    const res = await makeTask({ retainerProjectId: 'rp-voso' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different retainers/i);
    expect(written.task).toBeUndefined();
  });

  it('refuses a project on a task that sits on no month at all', async () => {
    const res = await makeTask({ workType: 'INTERNAL', monthCardId: null, retainerProjectId: 'rp-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/month/i);
  });

  it('files a task that names no project into the retainer default', async () => {
    /*
     * There is no such thing as an ungrouped retainer task any more. A caller
     * that does not choose is not refused — four forms would break to enforce
     * a filing decision the app can make correctly — it gets the default.
     */
    (prisma.monthCard.findFirst as any).mockResolvedValue({ retainer: { id: 'ret-1', ownerId: 'usr-head' } });
    (prisma.retainerProject.findFirst as any).mockResolvedValue({ id: 'rp-default' });

    const res = await makeTask({});
    expect(res.status).toBe(201);
    expect(written.task.monthCardId).toBe('mc-oct');
    expect(written.task.retainerProjectId).toBe('rp-default');
  });
});

/**
 * The retainer list says what the client is buying.
 *
 * Its only column about the work was "1 of 5 tasks done" for the current
 * month — a number that says how busy the month is and nothing about what the
 * retainer IS. A retainer is a Diwali campaign and an always-on stream.
 */
describe('the retainer list carries its projects', () => {
  beforeEach(() => {
    (prisma.retainer.count as any).mockResolvedValue(1);
    (prisma.retainer.findMany as any).mockResolvedValue([
      {
        id: 'ret-1',
        companyId: 'co-1',
        company: { id: 'co-1', name: 'Carlton Wellness' },
        owner: { id: 'u-1', name: 'Tanuja' },
        template: null,
        monthCards: [],
        monthlyValue: 220000,
        startDate: new Date('2026-08-01'),
        termMonths: 12,
        renewalDate: new Date('2026-10-07'),
        status: 'ACTIVE',
        projects: [
          { id: 'rp-1', name: 'Always-on Content', status: 'ACTIVE', endDate: null },
          { id: 'rp-2', name: 'Diwali Campaign', status: 'ACTIVE', endDate: null },
          { id: 'rp-3', name: 'Clinic Rebrand Rollout', status: 'DONE', endDate: null },
        ],
      },
    ]);
  });

  it('names them, and counts only the ones still running', async () => {
    const res = await request(app).get('/api/retainers').set(...auth());

    expect(res.status).toBe(200);
    const row = res.body.retainers[0];
    // A finished campaign is not something the list should keep advertising —
    // but it still goes out, so the row can say "2 · 1 done" without a second call.
    expect(row.activeProjectCount).toBe(2);
    expect(row.projects.map((p: any) => p.name)).toEqual([
      'Always-on Content',
      'Diwali Campaign',
      'Clinic Rebrand Rollout',
    ]);
  });

  it('says nought rather than nothing when a retainer has none', async () => {
    (prisma.retainer.findMany as any).mockResolvedValue([
      {
        id: 'ret-2', companyId: 'co-2', company: { id: 'co-2', name: 'Right Hospitals' },
        owner: { id: 'u-1', name: 'Dilshad' }, template: null, monthCards: [],
        monthlyValue: 30000, startDate: new Date('2026-07-01'), termMonths: null,
        renewalDate: null, status: 'ACTIVE', projects: [],
      },
    ]);

    const res = await request(app).get('/api/retainers').set(...auth());
    expect(res.body.retainers[0].activeProjectCount).toBe(0);
    expect(res.body.retainers[0].projects).toEqual([]);
  });
});

/**
 * The name you see first on a new retainer.
 *
 * Every retainer is created with one project, because a retainer task must
 * name one and the 1st-of-month roll needs somewhere to put its work. It was
 * always called "Monthly Retainer Work" -- a placeholder nobody chose, sitting
 * on the client's page before anyone had said what the retainer was for, and
 * impossible to delete because it is the fallback other projects' tasks move
 * into. Renaming it was the only way out, and nothing said so.
 */
describe('naming the first piece of work', () => {
  /*
   * Its own token: opening a retainer needs `company.write`, which the head
   * persona this file is built around does not carry.
   */
  const bdAuth = () =>
    [
      'Authorization',
      `Bearer ${signJwt({
        userId: PM.id,
        organizationId: 'org-1',
        email: 'bd@eyelevel.local',
        preset: RolePreset.BD,
        permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read'],
      })}`,
    ] as const;

  /** POST /retainers against a mocked database, returning the project written. */
  const createRetainer = async (body: Record<string, unknown>) => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: PM.id,
      organizationId: 'org-1',
      name: 'Naif',
      email: 'bd@eyelevel.local',
      preset: RolePreset.BD,
      permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read'],
      active: true,
      sessionsValidFrom: null,
    });
    (prisma.company.findFirst as any).mockResolvedValue({
      id: 'co-1',
      name: 'Acme',
      organizationId: 'org-1',
      status: 'CLIENT',
    });
    (prisma.retainer.findFirst as any).mockResolvedValue(null);
    (prisma.retainer.create as any).mockResolvedValue({ id: 'ret-1', companyId: 'co-1' });
    (prisma.monthCard.create as any).mockResolvedValue({ id: 'mc-1' });
    (prisma.activity.create as any).mockResolvedValue({});
    let written: any = null;
    (prisma.retainerProject.create as any).mockImplementation(async ({ data }: any) => {
      written = data;
      return { id: 'rp-1', ...data };
    });

    const res = await request(app)
      .post('/api/retainers')
      .set(...bdAuth())
      .send({ companyId: 'co-1', monthlyValue: 40000, startDate: '2026-09-01', ...body });

    return { status: res.status, project: written };
  };

  it('uses the name given at creation', async () => {
    const { project } = await createRetainer({ firstProjectName: 'Social media management' });
    expect(project.name).toBe('Social media management');
    expect(project.isDefault).toBe(true);
  });

  it('falls back to the placeholder when nothing is given', async () => {
    const { project } = await createRetainer({});
    expect(project.name).toBe('Monthly Retainer Work');
  });

  it('refuses a name that is only whitespace', async () => {
    // Zod trims before min(1), so this is a bad request rather than a project
    // silently called "   ", which would be unreadable in every list.
    const { status } = await createRetainer({ firstProjectName: '   ' });
    expect(status).toBe(400);
  });
});
