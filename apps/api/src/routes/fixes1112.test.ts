import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { isLate } from '../services/internalWork.js';

/**
 * 12 Nov fixes: taking somebody off "Not signed in", and on hold never being
 * overdue. (The follow-up fix is in salesNextStep.test.ts, beside the scanner.)
 */

const ADMIN = {
  id: 'usr-admin',
  organizationId: 'org-1',
  name: 'Harish',
  email: 'admin@x',
  preset: RolePreset.MANAGEMENT,
  permissions: ['setup.admin', 'work.all', 'work.team', 'work.own'],
  active: true,
  sessionsValidFrom: null,
};
const auth = `Bearer ${signJwt({ userId: ADMIN.id, organizationId: 'org-1', email: ADMIN.email, preset: ADMIN.preset, permissions: ADMIN.permissions } as never)}`;
const p = prisma as any;

beforeEach(() => {
  p.user.findUnique.mockImplementation(async ({ where }: any) => (where.id === ADMIN.id ? ADMIN : null));
  p.activity.create.mockResolvedValue({});
});

describe('removing somebody from "Not signed in"', () => {
  const person = (over: Record<string, unknown> = {}) => ({
    id: 'usr-new',
    organizationId: 'org-1',
    name: 'Priya',
    email: 'priya@eyelevel.test',
    active: false,
    inviteToken: 'tok',
    removedAt: null,
    ...over,
  });

  it('cancels an invitation: off the list, and the link stops working', async () => {
    p.user.findFirst.mockResolvedValue(person());
    p.user.update.mockResolvedValue({});
    const res = await request(app).delete('/api/users/usr-new').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/invitation is cancelled/);
    const data = p.user.update.mock.calls[0][0].data;
    expect(data.removedAt).toBeInstanceOf(Date);
    expect(data).toMatchObject({ inviteToken: null, inviteTokenExpiresAt: null });
    expect(p.activity.create.mock.calls[0][0].data.verb).toBe('user_invite_cancelled');
  });

  it('removes somebody switched off â€” the row stays, so their history keeps the name', async () => {
    p.user.findFirst.mockResolvedValue(person({ inviteToken: null }));
    p.user.update.mockResolvedValue({});
    const res = await request(app).delete('/api/users/usr-new').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(p.user.delete).not.toHaveBeenCalled();
    expect(p.activity.create.mock.calls[0][0].data.verb).toBe('user_removed');
  });

  it('never a live account', async () => {
    p.user.findFirst.mockResolvedValue(person({ active: true, inviteToken: null }));
    const res = await request(app).delete('/api/users/usr-new').set('Authorization', auth);
    expect(res.status).toBe(409);
    expect(p.user.update).not.toHaveBeenCalled();
  });

  it('the list leaves removed people out', async () => {
    p.user.findMany.mockResolvedValue([]);
    await request(app).get('/api/users').set('Authorization', auth);
    expect(p.user.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1', removedAt: null });
  });

  it('inviting the same email again brings the row back as a fresh invitation', async () => {
    p.department.findFirst.mockResolvedValue({ id: 'dep-1', name: 'Design', archivedAt: null, organizationId: 'org-1' });
    p.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === ADMIN.id ? ADMIN : where.email === 'priya@eyelevel.test' ? person({ inviteToken: null, removedAt: new Date('2026-11-01') }) : null,
    );
    p.user.update.mockResolvedValue({ ...person(), dept: 'Design', departmentId: 'dep-1', preset: 'EMPLOYEE' });
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', auth)
      .send({ name: 'Priya', email: 'priya@eyelevel.test', departmentId: 'dep-1', preset: 'EMPLOYEE' });

    expect(res.status).toBe(201);
    expect(p.user.create).not.toHaveBeenCalled();
    expect(p.user.update.mock.calls[0][0]).toMatchObject({ where: { id: 'usr-new' }, data: { removedAt: null, active: false } });
  });
});

describe('on hold is never overdue', () => {
  const past = new Date('2026-10-01T00:00:00Z');
  it('a held task past its date is not late; the same task in progress is', () => {
    expect(isLate({ status: 'ON_HOLD', dueDate: past }, '2026-11-12')).toBe(false);
    expect(isLate({ status: 'IN_PROGRESS', dueDate: past }, '2026-11-12')).toBe(true);
    expect(isLate({ status: 'DONE', dueDate: past }, '2026-11-12')).toBe(false);
  });
});
