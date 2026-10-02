import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { lookAlikes, planDepartments } from '../services/departmentBackfill.js';

/**
 * Departments as records (Departments Plan 1).
 *
 *   · names are trimmed, non-empty and unique ignoring case;
 *   · a head is somebody active with Department head or Management access;
 *   · merge moves everybody in one go and archives; archive waits for nobody active;
 *   · only an admin changes anything, and people can only be put in this
 *     organisation's, active, departments;
 *   · the backfill makes one department per name, ignoring case and nothing more.
 */

const PEOPLE = {
  boss: { id: 'usr-boss', preset: RolePreset.MANAGEMENT },
  head: { id: 'usr-head', preset: RolePreset.HEAD },
  emp: { id: 'usr-emp', preset: RolePreset.EMPLOYEE },
} as const;

const as = (who: keyof typeof PEOPLE) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[who].id,
      organizationId: 'org-1',
      email: 'x@y',
      preset: PEOPLE[who].preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[PEOPLE[who].preset]],
    })}`,
  ] as const;

const DEPT = (over: Record<string, unknown> = {}) => ({
  id: 'd-video',
  organizationId: 'org-1',
  name: 'Video & Production',
  headId: null,
  sortOrder: 2,
  archivedAt: null,
  ...over,
});

beforeEach(() => {
  const p = prisma as any;
  p.user.findUnique.mockImplementation(async ({ where }: any) => {
    const who = Object.values(PEOPLE).find((x) => x.id === where.id);
    return who
      ? { id: who.id, organizationId: 'org-1', name: 'Someone', email: 'x@y', preset: who.preset, permissions: [], active: true, sessionsValidFrom: null }
      : null;
  });
  p.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  p.activity.create.mockResolvedValue({});
  p.department.findMany.mockResolvedValue([]);
});

describe('reading the list', () => {
  it('is open to anybody signed in, archived ones to an admin only', async () => {
    (prisma.department.findMany as any).mockResolvedValue([
      { id: 'd-design', name: 'Design', headId: 'usr-head', sortOrder: 0, archivedAt: null, head: { name: 'Janani' }, members: [{ id: 'a' }, { id: 'b' }] },
    ]);
    const res = await request(app).get('/api/departments').set(...as('emp'));
    expect(res.status).toBe(200);
    expect(res.body.departments).toEqual([
      { id: 'd-design', name: 'Design', headId: 'usr-head', headName: 'Janani', sortOrder: 0, archived: false, peopleCount: 2 },
    ]);
    // Active only, in their order.
    expect((prisma.department.findMany as any).mock.calls[0][0]).toMatchObject({
      where: { organizationId: 'org-1', archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    expect((await request(app).get('/api/departments?includeArchived=1').set(...as('emp'))).status).toBe(403);
    expect((await request(app).get('/api/departments?includeArchived=1').set(...as('boss'))).status).toBe(200);
  });
});

describe('adding and renaming', () => {
  it('refuses anybody without setup.admin', async () => {
    expect((await request(app).post('/api/departments').set(...as('head')).send({ name: 'Video' })).status).toBe(403);
    expect((await request(app).patch('/api/departments/d-video').set(...as('emp')).send({ name: 'Video' })).status).toBe(403);
    expect((await request(app).post('/api/departments/d-video/merge').set(...as('head')).send({ intoId: 'd-x' })).status).toBe(403);
    expect((await request(app).post('/api/departments/d-video/archive').set(...as('head'))).status).toBe(403);
    expect((await request(app).post('/api/departments/move-people').set(...as('head')).send({ userIds: ['a'], departmentId: 'd' })).status).toBe(403);
  });

  it('trims the name, and refuses a blank one or one that differs only by case', async () => {
    expect((await request(app).post('/api/departments').set(...as('boss')).send({ name: '   ' })).status).toBe(400);

    (prisma.department.findFirst as any).mockResolvedValueOnce({ id: 'd-design', name: 'Design', archivedAt: null });
    const clash = await request(app).post('/api/departments').set(...as('boss')).send({ name: ' design ' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('There is already a department called "Design".');
    // Asked ignoring case, with the trimmed name.
    expect((prisma.department.findFirst as any).mock.calls[0][0].where.name).toEqual({ equals: 'design', mode: 'insensitive' });

    (prisma.department.findFirst as any).mockResolvedValueOnce({ id: 'd-old', name: 'Content', archivedAt: new Date() });
    const archived = await request(app).post('/api/departments').set(...as('boss')).send({ name: 'content' });
    expect(archived.body.error).toMatch(/archived department called "Content". Restore it instead/);
  });

  it('adds a department at the end of the list, and records it', async () => {
    (prisma.department.findFirst as any)
      .mockResolvedValueOnce(null) // the name is free
      .mockResolvedValueOnce({ sortOrder: 6 }); // the last in the list
    (prisma.department.create as any).mockResolvedValue({ id: 'd-new', name: 'Content' });
    const res = await request(app).post('/api/departments').set(...as('boss')).send({ name: '  Content ' });
    expect(res.status).toBe(201);
    expect((prisma.department.create as any).mock.calls[0][0].data).toEqual({ organizationId: 'org-1', name: 'Content', sortOrder: 7 });
    expect((prisma.activity.create as any).mock.calls[0][0].data).toMatchObject({ entityType: 'Department', verb: 'department_created' });
  });

  it('renames once, and everybody in it carries the new name', async () => {
    (prisma.department.findFirst as any)
      .mockResolvedValueOnce(DEPT()) // the department
      .mockResolvedValueOnce(null); // nobody else is called Video
    (prisma.department.update as any).mockResolvedValue(DEPT({ name: 'Video' }));
    const res = await request(app).patch('/api/departments/d-video').set(...as('boss')).send({ name: 'Video' });
    expect(res.status).toBe(200);
    expect((prisma.user.updateMany as any).mock.calls[0][0]).toEqual({
      where: { organizationId: 'org-1', departmentId: 'd-video' },
      data: { dept: 'Video' },
    });
    expect((prisma.activity.create as any).mock.calls[0][0].data).toMatchObject({
      verb: 'department_renamed',
      payload: { from: 'Video & Production', to: 'Video' },
    });
  });
});

describe('the head', () => {
  it('must have Department head or Management access, and be active', async () => {
    (prisma.department.findFirst as any).mockResolvedValue(DEPT());

    (prisma.user.findFirst as any).mockResolvedValueOnce({ name: 'Sneha', active: true, preset: RolePreset.EMPLOYEE });
    const employee = await request(app).patch('/api/departments/d-video').set(...as('boss')).send({ headId: 'usr-sneha' });
    expect(employee.status).toBe(400);
    expect(employee.body.error).toBe('Sneha does not have Department head access. Give it to them in Team → Access first.');

    (prisma.user.findFirst as any).mockResolvedValueOnce({ name: 'Old', active: false, preset: RolePreset.HEAD });
    expect((await request(app).patch('/api/departments/d-video').set(...as('boss')).send({ headId: 'usr-old' })).status).toBe(400);

    // Another organisation's person is not found at all.
    (prisma.user.findFirst as any).mockResolvedValueOnce(null);
    expect((await request(app).patch('/api/departments/d-video').set(...as('boss')).send({ headId: 'usr-elsewhere' })).status).toBe(400);
    expect((prisma.user.findFirst as any).mock.calls.at(-1)[0].where).toEqual({ id: 'usr-elsewhere', organizationId: 'org-1' });

    (prisma.user.findFirst as any).mockResolvedValueOnce({ name: 'Ravi', active: true, preset: RolePreset.HEAD });
    (prisma.department.update as any).mockResolvedValue(DEPT({ headId: 'usr-ravi' }));
    const ravi = await request(app).patch('/api/departments/d-video').set(...as('boss')).send({ headId: 'usr-ravi' });
    expect(ravi.status).toBe(200);
    expect((prisma.department.update as any).mock.calls.at(-1)[0].data).toEqual({ headId: 'usr-ravi' });
    expect((prisma.activity.create as any).mock.calls.at(-1)[0].data).toMatchObject({ verb: 'department_head_changed', payload: { headTo: 'usr-ravi' } });
  });
});

describe('merge and archive', () => {
  it('merges: everybody moves across in one go, and the old one is archived', async () => {
    (prisma.department.findFirst as any).mockImplementation(async ({ where }: any) =>
      where.id === 'd-vp'
        ? DEPT({ id: 'd-vp', name: 'Video / Production' })
        : where.id === 'd-video'
          ? DEPT({ name: 'Video' })
          : null,
    );
    (prisma.user.updateMany as any).mockResolvedValue({ count: 3 });
    const res = await request(app).post('/api/departments/d-vp/merge').set(...as('boss')).send({ intoId: 'd-video' });
    expect(res.status).toBe(200);
    expect(res.body.moved).toBe(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect((prisma.user.updateMany as any).mock.calls[0][0]).toEqual({
      where: { organizationId: 'org-1', departmentId: 'd-vp' },
      data: { departmentId: 'd-video', dept: 'Video' },
    });
    expect((prisma.department.update as any).mock.calls[0][0].where).toEqual({ id: 'd-vp' });
    expect((prisma.department.update as any).mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
  });

  it('will not merge into itself or into an archived department', async () => {
    (prisma.department.findFirst as any).mockResolvedValue(DEPT());
    expect((await request(app).post('/api/departments/d-video/merge').set(...as('boss')).send({ intoId: 'd-video' })).status).toBe(400);

    (prisma.department.findFirst as any).mockImplementation(async ({ where }: any) =>
      where.id === 'd-old' ? DEPT({ id: 'd-old', name: 'Content', archivedAt: new Date() }) : DEPT(),
    );
    const res = await request(app).post('/api/departments/d-video/merge').set(...as('boss')).send({ intoId: 'd-old' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Content is archived/);
  });

  it('archives only once nobody active is left in it', async () => {
    (prisma.department.findFirst as any).mockResolvedValue(DEPT());
    (prisma.user.count as any).mockResolvedValueOnce(2);
    const busy = await request(app).post('/api/departments/d-video/archive').set(...as('boss'));
    expect(busy.status).toBe(409);
    expect(busy.body.error).toBe('Move its 2 people first, or merge it.');
    expect(prisma.department.update).not.toHaveBeenCalled();

    (prisma.user.count as any).mockResolvedValueOnce(0);
    expect((await request(app).post('/api/departments/d-video/archive').set(...as('boss'))).status).toBe(200);
    expect((prisma.department.update as any).mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
    // Never deleted.
    expect(prisma.department.delete).not.toHaveBeenCalled();
    expect(prisma.department.deleteMany).not.toHaveBeenCalled();
  });
});

describe('putting people in a department', () => {
  it('moves the people chosen, and only into an active department of this organisation', async () => {
    (prisma.department.findFirst as any).mockResolvedValueOnce(DEPT({ archivedAt: new Date() }));
    const archived = await request(app).post('/api/departments/move-people').set(...as('boss')).send({ userIds: ['u1'], departmentId: 'd-video' });
    expect(archived.status).toBe(400);

    (prisma.department.findFirst as any).mockResolvedValueOnce(DEPT());
    (prisma.user.findMany as any).mockResolvedValueOnce([{ id: 'u1', departmentId: null }]);
    const stranger = await request(app).post('/api/departments/move-people').set(...as('boss')).send({ userIds: ['u1', 'u-other-org'], departmentId: 'd-video' });
    expect(stranger.status).toBe(400);

    (prisma.department.findFirst as any).mockResolvedValueOnce(DEPT());
    (prisma.user.findMany as any).mockResolvedValueOnce([
      { id: 'u1', departmentId: null },
      { id: 'u2', departmentId: 'd-video' },
    ]);
    const ok = await request(app).post('/api/departments/move-people').set(...as('boss')).send({ userIds: ['u1', 'u2'], departmentId: 'd-video' });
    expect(ok.body.moved).toBe(1);
    expect((prisma.user.updateMany as any).mock.calls[0][0]).toEqual({
      where: { organizationId: 'org-1', id: { in: ['u1'] } },
      data: { departmentId: 'd-video', dept: 'Video & Production' },
    });
  });

  it('invite needs a department, and only this organisation’s active ones', async () => {
    const send = (body: Record<string, unknown>) =>
      request(app).post('/api/users/invite').set(...as('boss')).send({ name: 'Neha', email: 'neha@x.in', preset: 'EMPLOYEE', ...body });

    const none = await send({});
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('Choose a department.');

    (prisma.department.findFirst as any).mockResolvedValueOnce(null);
    expect((await send({ departmentId: 'd-other-org' })).status).toBe(400);

    (prisma.department.findFirst as any).mockResolvedValueOnce({ id: 'd-old', name: 'Content', archivedAt: new Date() });
    const archived = await send({ departmentId: 'd-old' });
    expect(archived.status).toBe(400);
    expect(archived.body.error).toBe('Content is archived. Choose another department.');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('the backfill mapping', () => {
  it('makes one department per name ignoring case, and guesses nothing else', () => {
    const plan = planDepartments(
      ['Design', 'Video / Production', 'Accounts / Finance', '  '],
      [
        { id: 'janani', dept: 'Design' },
        { id: 'sneha', dept: ' design ' },
        { id: 'charles', dept: 'Video & Production' },
        { id: 'priya', dept: 'Accounts' },
        { id: 'naif', dept: 'Development' },
        { id: 'new', dept: '   ' },
      ],
    );
    expect(plan.departments.map((d) => d.name)).toEqual([
      // The old list's order first, in its own spelling…
      'Design',
      'Video / Production',
      'Accounts / Finance',
      // …then the rest, alphabetically.
      'Accounts',
      'Development',
      'Video & Production',
    ]);
    expect(plan.placed.get('sneha')).toBe('Design');
    expect(plan.placed.get('charles')).toBe('Video & Production');
    expect(plan.unplaced).toEqual(['new']);
  });

  it('keeps the most used spelling when the old list has none', () => {
    const plan = planDepartments([], [
      { id: 'a', dept: 'digital marketing' },
      { id: 'b', dept: 'Digital Marketing' },
      { id: 'c', dept: 'Digital Marketing' },
    ]);
    expect(plan.departments).toEqual([{ name: 'Digital Marketing', sortOrder: 0 }]);
  });

  it('lists the near-duplicates for management to merge', () => {
    const alike = lookAlikes(['Video / Production', 'Video & Production', 'Accounts', 'Accounts / Finance', 'Design']);
    expect(alike).toContainEqual(['Video / Production', 'Video & Production']);
    expect(alike).toContainEqual(['Accounts', 'Accounts / Finance']);
    expect(alike.flat()).not.toContain('Design');
  });
});
