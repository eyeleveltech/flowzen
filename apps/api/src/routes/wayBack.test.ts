import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Ways back, and things that no longer get lost (30 Oct 2026, second batch).
 *
 * A lost deal could not be reopened, a stopped retainer not resumed, a retired
 * asset not brought back, a contact not removed; promoting a lead dropped its
 * next step and filed it in Chennai. Each is checked at the rule it follows now.
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
const BD = () => signIn('usr-bd', RolePreset.BD, ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write']);
const ADMIN = () => signIn('usr-admin', RolePreset.MANAGEMENT, ['setup.admin']);

beforeEach(() => {
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
  (prisma.activity.create as any).mockResolvedValue({});
  (prisma.organization.findUnique as any).mockResolvedValue({ timezone: 'Asia/Kolkata', financialYearStart: 4 });
});

describe('reopening a lost deal', () => {
  const lost = (over: Record<string, unknown> = {}) => ({
    id: 'prop-1',
    outcome: 'LOST',
    lostReason: 'Went with a cheaper agency',
    company: { name: 'Acme Homes', archivedAt: null },
    ...over,
  });
  beforeEach(() => {
    (prisma.proposal.update as any).mockResolvedValue({ id: 'prop-1' });
  });

  it('goes back to the stage it was lost from', async () => {
    const auth = BD();
    (prisma.proposal.findFirst as any).mockResolvedValue(lost());
    (prisma.activity.findFirst as any).mockResolvedValue({ payload: { lostFromStage: 'IN_NEGOTIATION' } });
    const res = await request(app).post('/api/proposals/prop-1/reopen').set(...auth);
    expect(res.status).toBe(200);
    expect((prisma.proposal.update as any).mock.calls[0][0].data).toMatchObject({
      outcome: null,
      stage: 'IN_NEGOTIATION',
      lostReason: null,
    });
    // Why it was lost stays, on the row that undid it.
    expect((prisma.activity.create as any).mock.calls[0][0].data).toMatchObject({
      verb: 'proposal_reopened',
      payload: { stageTo: 'IN_NEGOTIATION', lostReason: 'Went with a cheaper agency' },
    });
  });

  it('goes back to Verbal yes, not Won, when it had been won', async () => {
    const auth = BD();
    (prisma.proposal.findFirst as any).mockResolvedValue(lost());
    (prisma.activity.findFirst as any).mockResolvedValue({ payload: { lostFromStage: 'WON' } });
    await request(app).post('/api/proposals/prop-1/reopen').set(...auth);
    expect((prisma.proposal.update as any).mock.calls[0][0].data.stage).toBe('VERBAL_YES');
  });

  it('refuses a deal that is not lost', async () => {
    const auth = BD();
    (prisma.proposal.findFirst as any).mockResolvedValue(lost({ outcome: null }));
    const res = await request(app).post('/api/proposals/prop-1/reopen').set(...auth);
    expect(res.status).toBe(409);
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('only takes a lost reason on a lost deal', async () => {
    const auth = BD();
    (prisma.proposal.findFirst as any).mockResolvedValue({
      ...lost({ outcome: null }),
      ownerId: 'usr-bd',
      versions: [],
      wonVersion: null,
      company: { id: 'co-1', name: 'Acme Homes' },
    });
    const res = await request(app).patch('/api/proposals/prop-1').set(...auth).send({ lostReason: 'Budget' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only a lost deal/);
  });
});

describe('promoting a lead', () => {
  const entry = {
    id: 'out-1',
    organizationId: 'org-1',
    name: 'Prestige Group',
    status: 'INTERESTED',
    promotedCompanyId: null,
    vertical: 'Real Estate & Infrastructure',
    source: 'Referrals',
    ownerId: 'usr-bd',
    contactPersonName: 'Ravi',
    email: null,
    phone: '9840000000',
    nextStep: 'Send the deck',
    nextActionDate: new Date('2026-11-05'),
  };
  beforeEach(() => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(entry);
    (prisma.company.findMany as any).mockResolvedValue([]);
    (prisma.company.create as any).mockResolvedValue({ id: 'co-9', name: 'Prestige Group' });
    (prisma.person.create as any).mockResolvedValue({});
    (prisma.task.create as any).mockResolvedValue({ id: 'task-9' });
    (prisma.outreachEntry.update as any).mockResolvedValue({ ...entry, promotedCompanyId: 'co-9' });
  });

  it('asks which city rather than assuming Chennai', async () => {
    const auth = BD();
    const res = await request(app).post('/api/outreach/out-1/promote').set(...auth).send({});
    expect(res.status).toBe(400);
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('keeps the contact’s role and turns the next step into a follow-up on the company', async () => {
    const auth = BD();
    const res = await request(app)
      .post('/api/outreach/out-1/promote')
      .set(...auth)
      .send({ city: 'Madurai', contactRole: 'PAYER' });
    expect(res.status).toBe(201);
    expect((prisma.company.create as any).mock.calls[0][0].data.city).toBe('Madurai');
    expect((prisma.person.create as any).mock.calls[0][0].data.role).toBe('PAYER');
    const task = (prisma.task.create as any).mock.calls[0][0].data;
    expect(task).toMatchObject({
      title: 'Send the deck — Prestige Group',
      companyId: 'co-9',
      assigneeId: 'usr-bd',
      workType: 'INTERNAL',
      dueDate: entry.nextActionDate,
    });
  });
});

describe('removing a contact', () => {
  it('takes them off the company and keeps the row', async () => {
    const auth = BD();
    (prisma.person.findFirst as any).mockResolvedValue({ id: 'p-1', name: 'Ravi', role: 'PAYER' });
    (prisma.person.update as any).mockResolvedValue({});
    const res = await request(app).delete('/api/companies/co-1/people/p-1').set(...auth);
    expect(res.status).toBe(200);
    expect((prisma.person.update as any).mock.calls[0][0].data).toEqual({ active: false });
    expect(prisma.person.delete).not.toHaveBeenCalled();
  });
});

describe('resuming a stopped retainer', () => {
  const stopped = {
    id: 'ret-1',
    companyId: 'co-1',
    status: 'STOPPED',
    startDate: new Date('2026-01-01'),
    monthlyValue: 50_000,
    stopReason: 'Paused for the monsoon',
    company: { id: 'co-1', name: 'Acme Homes', status: 'PAST', archivedAt: null },
  };
  beforeEach(() => {
    (prisma.retainer.update as any).mockResolvedValue({ ...stopped, status: 'ACTIVE' });
    (prisma.monthCard.findUnique as any).mockResolvedValue(null);
    (prisma.monthCard.create as any).mockResolvedValue({ id: 'mc-new' });
    (prisma.company.update as any).mockResolvedValue({});
  });

  it('runs again, opens this month, and makes the company a client', async () => {
    const auth = BD();
    (prisma.retainer.findFirst as any).mockResolvedValueOnce(stopped).mockResolvedValueOnce(null);
    const res = await request(app).post('/api/retainers/ret-1/resume').set(...auth);
    expect(res.status).toBe(200);
    expect((prisma.retainer.update as any).mock.calls[0][0].data).toEqual({ status: 'ACTIVE', stoppedAt: null, stopReason: null });
    expect((prisma.monthCard.create as any).mock.calls[0][0].data).toMatchObject({ retainerId: 'ret-1', status: 'OPEN' });
    expect((prisma.company.update as any).mock.calls[0][0].data).toEqual({ status: 'CLIENT' });
  });

  it('refuses while the client has another live retainer', async () => {
    const auth = BD();
    (prisma.retainer.findFirst as any).mockResolvedValueOnce(stopped).mockResolvedValueOnce({ id: 'ret-2' });
    const res = await request(app).post('/api/retainers/ret-1/resume').set(...auth);
    expect(res.status).toBe(409);
    expect(prisma.retainer.update).not.toHaveBeenCalled();
  });
});

describe('bringing an asset back into use', () => {
  const lostCamera = {
    id: 'ast-1',
    organizationId: 'org-1',
    tag: 'EL/CAM/001',
    name: 'Sony A7 IV',
    category: 'CAMERA_BODY',
    make: 'Sony',
    model: 'A7 IV',
    serialNumber: 'SN-1',
    status: 'LOST',
    condition: 'GOOD',
    bookable: true,
    costId: null,
    purchasePrice: 240_000,
    purchasedAt: new Date('2026-04-01'),
    vendor: null,
    invoiceNumber: null,
    usefulLifeMonths: 60,
    salvageValue: 40_000,
    disposedAt: new Date('2026-09-01'),
    disposalValue: null,
    disposalNote: 'Left at a shoot',
    warrantyUntil: null,
    insuredUntil: null,
    billUrl: null,
    photoUrl: null,
    notes: null,
    currentHolderId: null,
    currentHolder: null,
    deletedAt: null,
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-09-01'),
  };

  it('goes back in stock with its disposal cleared', async () => {
    const auth = ADMIN();
    (prisma.asset.findFirst as any).mockResolvedValue(lostCamera);
    (prisma.asset.update as any).mockResolvedValue({ ...lostCamera, status: 'IN_STOCK', disposedAt: null, disposalNote: null });
    const res = await request(app).post('/api/assets/ast-1/reinstate').set(...auth).send({});
    expect(res.status).toBe(200);
    expect((prisma.asset.update as any).mock.calls[0][0].data).toMatchObject({
      status: 'IN_STOCK',
      disposedAt: null,
      disposalValue: null,
      disposalNote: null,
    });
  });

  it('refuses one that is still in use', async () => {
    const auth = ADMIN();
    (prisma.asset.findFirst as any).mockResolvedValue({ ...lostCamera, status: 'IN_STOCK' });
    const res = await request(app).post('/api/assets/ast-1/reinstate').set(...auth).send({});
    expect(res.status).toBe(409);
  });
});

describe('a task’s client, and an internal project with deleted tasks', () => {
  it('only takes a client on an internal task', async () => {
    const auth = ADMIN();
    (prisma.task.findFirst as any).mockResolvedValue({ id: 'task-1', workType: 'MONTH_CARD', monthCardId: 'mc-1' });
    const res = await request(app).patch('/api/tasks/task-1').set(...auth).send({ companyId: 'co-1' });
    expect(res.status).toBe(400);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('counts only tasks that are still there before refusing a delete', async () => {
    const auth = ADMIN();
    (prisma.internalProject.findFirst as any).mockResolvedValue({ id: 'ip-1', name: 'Website', _count: { tasks: 0 } });
    (prisma.internalProject.delete as any).mockResolvedValue({});
    const res = await request(app).delete('/api/internal-projects/ip-1').set(...auth);
    expect(res.status).toBe(200);
    const asked = (prisma.internalProject.findFirst as any).mock.calls[0][0];
    expect(asked.select._count.select.tasks).toEqual({ where: { deletedAt: null } });
  });
});
