import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

/**
 * A task marked Done stays Done (reported 2026-10-23: "when a task is marked
 * done it becomes to do or in progress").
 *
 * The In progress half: taking a task off hold was two requests — /resume,
 * which moved ANY task (Done and Cancelled included) to In progress, then the
 * status it was really going to. A screen holding an out-of-date "On hold"
 * copy, or a second request that failed, left a finished task In progress.
 */

const ME = { id: 'usr-ramya', preset: RolePreset.MANAGEMENT };
const auth = [
  'Authorization',
  `Bearer ${signJwt({
    userId: ME.id,
    organizationId: 'org-1',
    email: 'ramya@studio.test',
    preset: ME.preset,
    permissions: [...ROLE_PRESET_PERMISSIONS[ME.preset]],
  } as never)}`,
] as const;

const p = prisma as any;
const task = (over: Record<string, unknown>) => ({
  id: 't-1',
  organizationId: 'org-1',
  title: 'Edit the reel',
  status: 'TODO',
  needsApproval: false,
  completedAt: null,
  reopenCount: 0,
  waitingOn: null,
  waitingSince: null,
  waitingTotalMinutes: 30,
  monthCardId: 'mc-1',
  projectId: null,
  companyId: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T06:00:00Z'));
  p.user.findUnique.mockResolvedValue({
    id: ME.id,
    organizationId: 'org-1',
    name: 'Ramya',
    email: 'ramya@studio.test',
    preset: ME.preset,
    permissions: [],
    active: true,
    sessionsValidFrom: null,
  });
  p.task.update.mockImplementation(async ({ data }: any) => ({ id: 't-1', ...data }));
  p.activity.create.mockResolvedValue({});
  p.user.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => vi.useRealTimers());

describe('resume takes a task off hold — and nothing else', () => {
  it.each(['DONE', 'CANCELLED'])('refuses a %s task instead of reopening it', async (status) => {
    p.task.findFirst.mockResolvedValue(task({ status, completedAt: new Date('2026-10-22T10:00:00Z') }));
    const res = await request(app).post('/api/tasks/t-1/resume').set(...auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/isn't on hold any more/);
    expect(p.task.update).not.toHaveBeenCalled();
  });

  it('still resumes a task that is on hold', async () => {
    p.task.findFirst.mockResolvedValue(task({ status: 'ON_HOLD', waitingSince: new Date('2026-10-23T05:00:00Z') }));
    const res = await request(app).post('/api/tasks/t-1/resume').set(...auth);
    expect(res.status).toBe(200);
    expect(p.task.update.mock.calls[0][0].data).toMatchObject({ status: 'IN_PROGRESS', waitingSince: null, waitingTotalMinutes: 90 });
  });
});

describe('leaving On hold is one request', () => {
  it('On hold → Done closes the wait in the same write, and the task is Done', async () => {
    p.task.findFirst.mockResolvedValue(task({ status: 'ON_HOLD', waitingOn: 'CLIENT', waitingSince: new Date('2026-10-23T04:00:00Z') }));
    const res = await request(app).patch('/api/tasks/t-1/status').set(...auth).send({ status: 'DONE' });
    expect(res.status).toBe(200);
    expect(p.task.update).toHaveBeenCalledTimes(1);
    const data = p.task.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'DONE', waitingOn: null, waitingSince: null, waitingTotalMinutes: 150 });
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('a task not on hold keeps its waiting fields untouched', async () => {
    p.task.findFirst.mockResolvedValue(task({ status: 'IN_PROGRESS' }));
    await request(app).patch('/api/tasks/t-1/status').set(...auth).send({ status: 'DONE' });
    expect(p.task.update.mock.calls[0][0].data).not.toHaveProperty('waitingTotalMinutes');
  });
});

describe('a finished task put on hold is reopened, not left "completed"', () => {
  it('clears the completed date and counts the reopen', async () => {
    p.task.findFirst.mockResolvedValue(task({ status: 'DONE', completedAt: new Date('2026-10-22T10:00:00Z'), reopenCount: 1 }));
    const res = await request(app).post('/api/tasks/t-1/wait').set(...auth).send({ waitingOn: null });
    expect(res.status).toBe(200);
    expect(p.task.update.mock.calls[0][0].data).toMatchObject({ status: 'ON_HOLD', completedAt: null, reopenCount: 2 });
  });
});
