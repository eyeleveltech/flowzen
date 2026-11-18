import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

/**
 * GET /api/tasks/my/last-choices (Ease Plan 1, decision 2): the type of work
 * and "belongs to" of the last task this person wrote down themselves — the
 * target only while the pickers still offer it.
 */

const p = prisma as any;
const ME = 'usr-me';

const as = (preset: RolePreset = RolePreset.EMPLOYEE, userId = ME) => {
  p.user.findUnique.mockResolvedValue({
    id: userId, organizationId: 'org-1', name: 'Me', email: 'me@eyelevel.local',
    preset, permissions: [], active: true, sessionsValidFrom: null,
  });
  return ['Authorization', `Bearer ${signJwt({ userId, organizationId: 'org-1', email: 'me@eyelevel.local', preset, permissions: [] })}`] as const;
};

const at = (min: number) => new Date(Date.UTC(2026, 10, 17, 9, min));
const task = (over: Record<string, unknown>) => ({
  id: 't',
  createdAt: at(0),
  taskType: 'DESIGN',
  workType: 'PROJECT',
  repeatId: null,
  monthCardId: null,
  retainerProjectId: null,
  projectId: null,
  internalProjectId: null,
  companyId: null,
  monthCard: null,
  ...over,
});

/** What /tasks/targets offers: Acme's live project and retainer work, one active internal project. */
const COMPANIES = [
  {
    id: 'c-acme',
    name: 'Acme',
    retainers: [
      { id: 'r-acme', monthCards: [{ id: 'mc-nov', month: '2026-11' }], projects: [{ id: 'rp-reels', name: 'Reels' }] },
      { id: 'r-plain', monthCards: [{ id: 'mc-plain-nov', month: '2026-11' }], projects: [] },
    ],
    projects: [{ id: 'pr-site', name: 'Website', isSample: false }],
  },
];

beforeEach(() => {
  p.organization.findUnique.mockResolvedValue({ id: 'org-1', timezone: 'Asia/Kolkata' });
  p.company.findMany.mockResolvedValue(COMPANIES);
  p.internalProject.findMany.mockResolvedValue([{ id: 'ip-brand', name: 'Brand refresh' }]);
  p.task.groupBy.mockResolvedValue([]);
});

const ask = async (rows: unknown[]) => {
  p.task.findMany.mockResolvedValue(rows);
  const res = await request(app).get('/api/tasks/my/last-choices').set(...as());
  expect(res.status).toBe(200);
  return res.body;
};

describe('which task counts', () => {
  it('only tasks I created by hand, in my organisation, not deleted, not the scanner’s follow-ups', async () => {
    await ask([]);
    const where = p.task.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: 'org-1', createdById: ME, deletedAt: null });
    expect(where.OR).toEqual([{ workId: null }, { NOT: { workId: { startsWith: 'proposal_followup:' } } }]);
    expect(p.task.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('never reads another organisation’s work for the targets either', async () => {
    await ask([task({ projectId: 'pr-site' })]);
    expect(p.company.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
    expect(p.internalProject.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
  });

  it('skips a repeat’s later copies, which carry the first one’s creator', async () => {
    p.task.groupBy.mockResolvedValue([{ repeatId: 'rep-1', _min: { createdAt: at(1) } }]);
    const body = await ask([
      task({ id: 'copy', createdAt: at(30), repeatId: 'rep-1', taskType: 'VIDEO', projectId: 'pr-site' }),
      task({ id: 'mine', createdAt: at(20), taskType: 'DESIGN', retainerProjectId: 'rp-reels', monthCardId: 'mc-oct', workType: 'MONTH_CARD' }),
    ]);
    expect(body.choices.taskType).toBe('DESIGN');
    expect(body.choices.target).toMatchObject({ scope: 'CLIENT', key: 'rp-reels' });
  });

  it('keeps the first task of a repeat — that one was written by hand', async () => {
    p.task.groupBy.mockResolvedValue([{ repeatId: 'rep-1', _min: { createdAt: at(30) } }]);
    const body = await ask([task({ id: 'first', createdAt: at(30), repeatId: 'rep-1', taskType: 'VIDEO', projectId: 'pr-site' })]);
    expect(body.choices).toMatchObject({ taskType: 'VIDEO', target: { key: 'pr-site' } });
  });

  it('says nothing for somebody who has never written a task', async () => {
    const body = await ask([]);
    expect(body.choices).toBeNull();
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('what it belongs to', () => {
  it('a client project, as the picker offers it', async () => {
    const body = await ask([task({ projectId: 'pr-site', taskType: 'DEVELOPMENT' })]);
    expect(body.choices).toEqual({
      taskType: 'DEVELOPMENT',
      target: { scope: 'CLIENT', companyId: 'c-acme', name: 'Acme', key: 'pr-site', label: 'Project — Website', workType: 'PROJECT', projectId: 'pr-site' },
    });
  });

  it('a retainer month with no piece of work: this month’s card of the same retainer', async () => {
    const body = await ask([task({ workType: 'MONTH_CARD', monthCardId: 'mc-plain-oct', monthCard: { retainerId: 'r-plain' } })]);
    expect(body.choices.target).toMatchObject({ scope: 'CLIENT', key: 'mc-plain-nov', monthCardId: 'mc-plain-nov' });
    expect(body.choices.target).not.toHaveProperty('retainerId');
  });

  it('drops a target that is closed now, and keeps the type', async () => {
    const body = await ask([task({ projectId: 'pr-delivered', taskType: 'DESIGN' })]);
    expect(body.choices).toEqual({ taskType: 'DESIGN', target: null });
  });

  it('internal work: No project, an active internal project, or nothing once it is closed', async () => {
    expect((await ask([task({ workType: 'INTERNAL' })])).choices.target).toEqual({ scope: 'INTERNAL', internalProjectId: null, name: 'Internal' });
    expect((await ask([task({ workType: 'INTERNAL', internalProjectId: 'ip-brand' })])).choices.target).toEqual({
      scope: 'INTERNAL',
      internalProjectId: 'ip-brand',
      name: 'Brand refresh',
    });
    expect((await ask([task({ workType: 'INTERNAL', internalProjectId: 'ip-archived' })])).choices.target).toBeNull();
  });

  it('a follow-up on a client is not something the pickers offer', async () => {
    const body = await ask([task({ workType: 'INTERNAL', companyId: 'c-acme', taskType: 'BUSINESS_DEVELOPMENT' })]);
    expect(body.choices).toEqual({ taskType: 'BUSINESS_DEVELOPMENT', target: null });
  });
});

describe('who may ask', () => {
  it('exactly whoever may ask /tasks/targets', async () => {
    p.task.findMany.mockResolvedValue([]);
    for (const preset of Object.values(RolePreset)) {
      const targets = await request(app).get('/api/tasks/targets').set(...as(preset));
      const last = await request(app).get('/api/tasks/my/last-choices').set(...as(preset));
      expect(last.status, preset).toBe(targets.status);
    }
    const signedOut = await request(app).get('/api/tasks/my/last-choices');
    expect(signedOut.status).toBe((await request(app).get('/api/tasks/targets')).status);
  });

  it('leaves /tasks/targets exactly as it was — no retainer id on the options', async () => {
    const res = await request(app).get('/api/tasks/targets').set(...as());
    const jobs = res.body.companies[0].jobs;
    expect(jobs.map((j: any) => j.key)).toEqual(['rp-reels', 'mc-plain-nov', 'pr-site']);
    for (const j of jobs) expect(j).not.toHaveProperty('retainerId');
  });
});
