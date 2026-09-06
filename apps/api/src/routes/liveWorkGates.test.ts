import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * Who is allowed live work, and how many times.
 *
 * ─── The shape of the bug ───────────────────────────────────────────────────
 *
 * Both creation routes carried the same rule and the same hole:
 *
 *     if (sourceProposalId) {
 *       ...only a won proposal, and only once...
 *     }
 *
 * Every rule inside that block was skippable by leaving one optional field out
 * of the request. A retainer or a live project could be opened against a
 * company nobody had ever sold anything to, and a second retainer opened
 * beside the first — the client chose whether to be validated.
 *
 * The invariant was never really about the request. A company becomes a CLIENT
 * when a proposal is won, so "not a prospect" is the same sentence as "somebody
 * bought something" and it holds whatever shape the call takes.
 */

const AUTH = [
  'Authorization',
  `Bearer ${signJwt({
    userId: 'usr-bd',
    organizationId: 'org-1',
    email: 'bd@eyelevel.local',
    preset: RolePreset.BD,
    permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write'],
  })}`,
] as const;

const CLIENT = { id: 'co-client', name: 'Carlton Wellness', status: 'CLIENT' };
const PROSPECT = { id: 'co-prospect', name: 'Suvai Foods', status: 'PROSPECT' };

/** Tomorrow and next quarter, so a test never depends on the day it runs. */
const iso = (monthsFromNow: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsFromNow);
  return d.toISOString().slice(0, 10);
};
const thisMonth = new Date().toISOString().slice(0, 7);

beforeEach(() => {
  (prisma.user.findUnique as any).mockResolvedValue({
    id: 'usr-bd',
    organizationId: 'org-1',
    name: 'Tanuja',
    email: 'bd@eyelevel.local',
    preset: RolePreset.BD,
    permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write'],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.company.findFirst as any).mockImplementation(async ({ where }: any) =>
    where.id === CLIENT.id ? CLIENT : where.id === PROSPECT.id ? PROSPECT : null,
  );
  // Nothing running, nothing seeded from a proposal, unless a test says so.
  (prisma.retainer.findFirst as any).mockResolvedValue(null);
  (prisma.project.findFirst as any).mockResolvedValue(null);
  (prisma.retainer.create as any).mockImplementation(async ({ data }: any) => ({ ...data, id: 'ret-new' }));
  (prisma.project.create as any).mockImplementation(async ({ data }: any) => ({ ...data, id: 'proj-new' }));
  (prisma.monthCard.create as any).mockResolvedValue({ id: 'mc-new' });
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
});

const newRetainer = (over: Record<string, unknown> = {}) => ({
  companyId: CLIENT.id,
  monthlyValue: 60000,
  startDate: iso(0),
  ...over,
});

describe('a prospect cannot carry live work', () => {
  it('refuses a retainer for a company that has not bought anything', async () => {
    const res = await request(app)
      .post('/api/retainers')
      .set(...AUTH)
      .send(newRetainer({ companyId: PROSPECT.id }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/still a prospect/i);
    expect(prisma.retainer.create).not.toHaveBeenCalled();
  });

  it('refuses a project for one either — the same hole, in the other route', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(...AUTH)
      .send({
        companyId: PROSPECT.id,
        name: 'Website rebuild',
        quotedValue: 200000,
        startDate: iso(0),
        endDate: iso(3),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/still a prospect/i);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('does not depend on the caller sending sourceProposalId', async () => {
    // The whole defect: the old gate lived inside `if (sourceProposalId)`, so
    // omitting the field was enough to skip it.
    const res = await request(app)
      .post('/api/retainers')
      .set(...AUTH)
      .send(newRetainer({ companyId: PROSPECT.id, sourceProposalId: undefined }));

    expect(res.status).toBe(400);
  });

  it('lets a client through', async () => {
    const res = await request(app)
      .post('/api/retainers')
      .set(...AUTH)
      .send(newRetainer());

    expect(res.status).toBe(201);
    expect(prisma.retainer.create).toHaveBeenCalled();
  });

  it('refuses a company from another organization outright', async () => {
    // The same read that asks "is this a prospect" is the first one that ever
    // confined `companyId` to the caller's own tenant.
    const res = await request(app)
      .post('/api/retainers')
      .set(...AUTH)
      .send(newRetainer({ companyId: 'co-somebody-elses' }));

    expect(res.status).toBe(404);
    expect(prisma.retainer.create).not.toHaveBeenCalled();
  });
});

describe('one live retainer per client', () => {
  it('refuses a second while the first is running', async () => {
    (prisma.retainer.findFirst as any).mockResolvedValue({ id: 'ret-existing', monthlyValue: 60000 });

    const res = await request(app)
      .post('/api/retainers')
      .set(...AUTH)
      .send(newRetainer());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already has an active retainer/i);
    expect(prisma.retainer.create).not.toHaveBeenCalled();
  });
});

describe('a retainer is not billed before it starts', () => {
  it('opens this month card when it starts now', async () => {
    const res = await request(app)
      .post('/api/retainers')
      .set(...AUTH)
      .send(newRetainer({ startDate: iso(0) }));

    expect(res.status).toBe(201);
    const { data } = (prisma.monthCard.create as any).mock.calls.at(-1)[0];
    expect(data.month).toBe(thisMonth);
  });

  it('opens none at all when it starts in a later month', async () => {
    /*
     * It used to read `new Date()` and open a card for the current month
     * whatever the start date said, so a retainer signed today to begin in
     * three months was billed for this one the moment it was saved. The
     * monthly roll picks it up when the month it really starts comes round.
     */
    const res = await request(app)
      .post('/api/retainers')
      .set(...AUTH)
      .send(newRetainer({ startDate: iso(3) }));

    expect(res.status).toBe(201);
    expect(prisma.monthCard.create).not.toHaveBeenCalled();
  });
});
