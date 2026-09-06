import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * The audit trail, and the leak it used to be.
 *
 * A designer with nothing but `work.own` was correctly refused /costs,
 * /forecast, /companies and retainer profitability — and could then read every
 * one of those figures out of /activities, because the feed carried `amount`,
 * `quotedValue` and `monthlyValue` inside its payloads and had no gate at all.
 *
 * These tests hold both halves of the fix: which ROWS come back, and what is
 * left IN them.
 */

const PEOPLE = {
  boss: {
    id: 'usr-boss',
    preset: RolePreset.MANAGEMENT,
    permissions: ['work.own', 'work.all', 'company.read', 'money.figures', 'setup.admin'],
  },
  employee: { id: 'usr-emp', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] },
  head: {
    id: 'usr-head',
    preset: RolePreset.HEAD,
    permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'],
  },
  bd: {
    id: 'usr-bd',
    preset: RolePreset.BD,
    permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'money.status'],
  },
} as const;

type Who = keyof typeof PEOPLE;
const auth = (w: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[w].id,
      organizationId: 'org-1',
      email: `${w}@eyelevel.local`,
      preset: PEOPLE[w].preset,
      permissions: [...PEOPLE[w].permissions],
    })}`,
  ] as const;

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const p = Object.entries(PEOPLE).find(([, v]) => v.id === where.id)?.[1];
    if (!p) return null;
    return {
      id: p.id,
      organizationId: 'org-1',
      name: 'Somebody',
      email: 'x@eyelevel.local',
      preset: p.preset,
      permissions: [...p.permissions],
      active: true,
      sessionsValidFrom: null,
    };
  });
  (prisma.activity.count as any).mockResolvedValue(1);
});

const rowsWithMoney = [
  {
    id: 'a1',
    entityType: 'Cost',
    entityId: 'c1',
    verb: 'created',
    at: new Date(),
    actor: { id: 'usr-boss', name: 'Akmal' },
    payload: { type: 'DIRECT', amount: 40000, vendor: 'Meta Ads', category: 'Ad spend' },
  },
];

describe('which rows come back', () => {
  it('refuses an employee the cost history outright', async () => {
    const res = await request(app).get('/api/activities?entityType=Cost').set(...auth('employee'));
    expect(res.status).toBe(403);
  });

  it('refuses a Head the client history — they have no company.read', async () => {
    const res = await request(app).get('/api/activities?entityType=Company').set(...auth('head'));
    expect(res.status).toBe(403);
  });

  it('gives BD the client history, which is their job', async () => {
    (prisma.activity.findMany as any).mockResolvedValue([]);
    const res = await request(app).get('/api/activities?entityType=Company').set(...auth('bd'));
    expect(res.status).toBe(200);
  });

  it('narrows an unfiltered feed to what the caller could open anyway', async () => {
    (prisma.activity.findMany as any).mockResolvedValue([]);
    await request(app).get('/api/activities').set(...auth('employee'));

    const where = (prisma.activity.findMany as any).mock.calls.at(-1)[0].where;
    // An employee gets Task and Asset — the two types open to everybody — and
    // nothing else. Costs, invoices and clients are not in the query at all.
    expect(where.entityType.in.sort()).toEqual(['Asset', 'Task']);
  });

  it('gives management the full set', async () => {
    (prisma.activity.findMany as any).mockResolvedValue([]);
    await request(app).get('/api/activities').set(...auth('boss'));
    const where = (prisma.activity.findMany as any).mock.calls.at(-1)[0].where;
    expect(where.entityType.in).toContain('Cost');
    expect(where.entityType.in).toContain('Invoice');
  });

  it('refuses an entity type nobody has claimed, rather than allowing it', async () => {
    // Failing closed matters here: a new entity type should vanish from the
    // feed until somebody decides who may read it.
    const res = await request(app).get('/api/activities?entityType=Wibble').set(...auth('boss'));
    expect(res.status).toBe(403);
  });
});

describe('what is left in them', () => {
  it('strips the figure for somebody without money.figures', async () => {
    (prisma.activity.findMany as any).mockResolvedValue(rowsWithMoney);
    const res = await request(app).get('/api/activities?entityType=Cost').set(...auth('head'));

    expect(res.status).toBe(200);
    expect(res.body.data[0].payload).not.toHaveProperty('amount');
    // The rest of the row survives — WHAT happened is not the same question as
    // what it cost, and a head with cost.enter needs the first one.
    expect(res.body.data[0].payload.vendor).toBe('Meta Ads');
    expect(res.body.data[0].payload.category).toBe('Ad spend');
  });

  it('keeps it for somebody with money.figures', async () => {
    (prisma.activity.findMany as any).mockResolvedValue(rowsWithMoney);
    const res = await request(app).get('/api/activities?entityType=Cost').set(...auth('boss'));
    expect(res.body.data[0].payload.amount).toBe(40000);
  });

  it("strips a delivered project's closing profit from a Head", async () => {
    // work.all is enough to read a project's history and is NOT enough to read
    // what the job made. The closing figure (brief §11.3 step 6) arrives as its
    // own activity row, so it needs the same treatment as everything else with
    // a rupee in it — otherwise the new profit feature reopens a smaller
    // version of the leak this file exists to close.
    (prisma.activity.findMany as any).mockResolvedValue([
      {
        id: 'a2',
        entityType: 'Project',
        entityId: 'p1',
        verb: 'project_delivered',
        at: new Date(),
        actor: { id: 'usr-boss', name: 'Akmal' },
        payload: {
          revenue: 450_000,
          profit: 300_000,
          directCost: 60_000,
          peopleCost: 90_000,
          marginPercent: 66.7,
        },
      },
    ]);

    const res = await request(app).get('/api/activities?entityType=Project').set(...auth('head'));

    expect(res.status).toBe(200);
    for (const key of ['revenue', 'profit', 'directCost', 'peopleCost', 'marginPercent']) {
      expect(res.body.data[0].payload).not.toHaveProperty(key);
    }
    // The fact that it was delivered is not a figure, and survives.
    expect(res.body.data[0].verb).toBe('project_delivered');
  });

  it('reaches figures nested inside the payload too', async () => {
    (prisma.activity.findMany as any).mockResolvedValue([
      { ...rowsWithMoney[0], payload: { note: 'x', deal: { value: 75000, stage: 'WON' } } },
    ]);
    const res = await request(app).get('/api/activities?entityType=Cost').set(...auth('head'));
    expect(res.body.data[0].payload.deal).not.toHaveProperty('value');
    expect(res.body.data[0].payload.deal.stage).toBe('WON');
  });
});

describe('writing to the audit trail', () => {
  it('refuses a made-up entity id', async () => {
    // This returned 201 before. An audit log anybody can put arbitrary rows
    // into is not evidence of anything.
    (prisma.company.findFirst as any).mockResolvedValue(null);
    const res = await request(app)
      .post('/api/activities')
      .set(...auth('bd'))
      .send({ entityType: 'Company', entityId: 'does-not-exist-at-all', verb: 'called' });

    expect(res.status).toBe(404);
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it('refuses an entity type that cannot be logged against', async () => {
    const res = await request(app)
      .post('/api/activities')
      .set(...auth('boss'))
      .send({ entityType: 'Invoice', entityId: 'inv-1', verb: 'poked' });
    expect(res.status).toBe(400);
  });

  it('refuses somebody who could not open the thing', async () => {
    (prisma.company.findFirst as any).mockResolvedValue({ id: 'co-1' });
    const res = await request(app)
      .post('/api/activities')
      .set(...auth('head'))
      .send({ entityType: 'Company', entityId: 'co-1', verb: 'called' });
    expect(res.status).toBe(403);
  });

  it('still lets anybody log a call on a client they can see', async () => {
    (prisma.company.findFirst as any).mockResolvedValue({ id: 'co-1', name: 'Suvai', ownerId: 'usr-bd' });
    (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });

    const res = await request(app)
      .post('/api/activities')
      .set(...auth('bd'))
      .send({ entityType: 'Company', entityId: 'co-1', verb: 'called' });

    expect(res.status).toBe(201);
  });
});
