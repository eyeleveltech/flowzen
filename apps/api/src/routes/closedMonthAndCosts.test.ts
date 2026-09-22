import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { jobProfit } from '../utils/jobProfit.js';

/**
 * Three things the screens showed that were not true.
 *
 * 1. A CLOSED month accepted costs, tasks and status changes, so a figure that
 *    had already been reported could be moved by anybody, silently.
 * 2. A job with no costs and nobody allocated computed to 100% margin and was
 *    shown in the tile reserved for the answer.
 * 3. A cost could be entered and deleted but never corrected, so a mistyped
 *    amount stayed in the month's margin for good.
 *
 * All three share a shape: nothing errored, so only a test that knows what the
 * number is supposed to mean can hold them.
 */

const ADMIN = {
  id: 'usr-admin',
  preset: RolePreset.MANAGEMENT,
  permissions: [
    'work.own', 'work.all', 'money.status', 'money.figures', 'company.read',
    'company.write', 'cost.enter', 'pipeline.read', 'reports.read', 'setup.admin',
  ],
};

const auth = () =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: ADMIN.id,
      organizationId: 'org-1',
      email: 'admin@eyelevel.local',
      preset: ADMIN.preset,
      permissions: [...ADMIN.permissions],
    })}`,
  ] as const;

const OPEN_CARD = { id: 'mc-open', status: 'OPEN', month: '2026-09', retainerId: 'ret-1' };
const CLOSED_CARD = { id: 'mc-closed', status: 'CLOSED', month: '2026-08', retainerId: 'ret-1' };

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.user.findUnique as any).mockResolvedValue({
    id: ADMIN.id,
    organizationId: 'org-1',
    name: 'Akmal',
    email: 'admin@eyelevel.local',
    preset: ADMIN.preset,
    permissions: [...ADMIN.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  // The guard reads the card by id and nothing else.
  (prisma.monthCard.findUnique as any).mockImplementation(async ({ where }: any) =>
    where.id === CLOSED_CARD.id ? CLOSED_CARD : where.id === OPEN_CARD.id ? OPEN_CARD : null,
  );
  (prisma.monthCard.findFirst as any).mockImplementation(async ({ where }: any) =>
    where.id === CLOSED_CARD.id ? CLOSED_CARD : where.id === OPEN_CARD.id ? OPEN_CARD : null,
  );
  (prisma.activity.create as any).mockResolvedValue({});
});

describe('a closed month is a reported month', () => {
  it('refuses a cost entered against it, and names the month', async () => {
    const res = await request(app)
      .post('/api/costs')
      .set(...auth())
      .send({ monthCardId: CLOSED_CARD.id, category: 'Ad Spend', vendor: 'Meta', amount: 99999 });

    expect(res.status).toBe(400);
    // "August 2026", not "2026-08" — a refusal should name the month a person
    // sees on the screen they are looking at.
    expect(res.body.error).toMatch(/August 2026 is closed/);
    expect(prisma.cost.create).not.toHaveBeenCalled();
  });

  it('still takes a cost on the open month beside it', async () => {
    (prisma.cost.create as any).mockResolvedValue({ id: 'cost-1', amount: 500 });
    const res = await request(app)
      .post('/api/costs')
      .set(...auth())
      .send({ monthCardId: OPEN_CARD.id, category: 'Ad Spend', vendor: 'Meta', amount: 500 });

    expect(res.status).toBe(201);
  });

  it('refuses a task added to it', async () => {
    (prisma.user.findMany as any).mockResolvedValue([{ id: ADMIN.id }]);
    const res = await request(app)
      .post('/api/tasks')
      .set(...auth())
      .send({
        title: 'late arrival',
        workType: 'MONTH_CARD',
        monthCardId: CLOSED_CARD.id,
        dueDate: '2026-08-30',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('refuses reopening a task finished in it', async () => {
    /*
     * The sharpest version: reopening moves that month's "tasks done" after
     * the fact AND bumps `reopenCount`, which the aging rules read as rework.
     */
    (prisma.task.findFirst as any).mockResolvedValue({
      id: 'task-1',
      organizationId: 'org-1',
      monthCardId: CLOSED_CARD.id,
      status: 'DONE',
      completedAt: new Date('2026-08-03'),
      reopenCount: 0,
    });

    const res = await request(app)
      .patch('/api/tasks/task-1/status')
      .set(...auth())
      .send({ status: 'TODO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('can be reopened deliberately, with the reason on the record', async () => {
    // Refusing every write with no way through would only mean the real
    // correction never gets recorded and the number stays wrong.
    (prisma.monthCard.findFirst as any).mockResolvedValue(CLOSED_CARD);
    (prisma.monthCard.update as any).mockResolvedValue({ ...CLOSED_CARD, status: 'OPEN' });

    const res = await request(app)
      .post('/api/retainers/ret-1/month-cards/2026-08/reopen')
      .set(...auth())
      .send({ reason: 'Vendor bill arrived late' });

    expect(res.status).toBe(200);
    expect(prisma.monthCard.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'OPEN', closedAt: null } }),
    );
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verb: 'month_card_reopened',
          payload: expect.objectContaining({ reason: 'Vendor bill arrived late' }),
        }),
      }),
    );
  });

  it('will not reopen without a reason', async () => {
    (prisma.monthCard.findFirst as any).mockResolvedValue(CLOSED_CARD);
    const res = await request(app)
      .post('/api/retainers/ret-1/month-cards/2026-08/reopen')
      .set(...auth())
      .send({ reason: '' });

    expect(res.status).toBe(400);
    expect(prisma.monthCard.update).not.toHaveBeenCalled();
  });
});

describe('no costs recorded is not a 100% margin', () => {
  const base = { quotedValue: 90000, estimatedCost: null, directCost: 0, peopleCost: 0 };

  it('says so, rather than reporting the whole quote as profit', () => {
    const p = jobProfit({ ...base, costEntries: 0 });
    expect(p.costBasis).toBe('none');
    // The arithmetic is unchanged — the company rollups still need something
    // to add — but the screens key off costBasis and say "not known yet".
    expect(p.profit).toBe(90000);
    expect(p.marginPercent).toBe(100);
  });

  it('is a real nought once somebody has entered a cost of nothing', () => {
    // A recorded zero IS a finding. Only an absence of records is not.
    const p = jobProfit({ ...base, costEntries: 1 });
    expect(p.costBasis).toBe('recorded');
  });

  it('trusts a caller that does not say', () => {
    expect(jobProfit(base).costBasis).toBe('recorded');
  });
});

describe('a cost can be corrected', () => {
  it('records what it was as well as what it is now', async () => {
    (prisma.cost.findFirst as any).mockResolvedValue({
      id: 'cost-1',
      organizationId: 'org-1',
      monthCardId: OPEN_CARD.id,
      amount: 4000,
      vendor: 'Meta Ads Manager',
      category: 'Ad Spend',
    });
    (prisma.cost.update as any).mockResolvedValue({
      id: 'cost-1',
      amount: 40000,
      vendor: 'Meta Ads Manager',
      category: 'Ad Spend',
    });

    const res = await request(app)
      .patch('/api/costs/cost-1')
      .set(...auth())
      .send({ amount: 40000 });

    expect(res.status).toBe(200);
    // The old amount is the part worth keeping — it is what makes a later
    // "why did August move?" answerable at all.
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verb: 'cost_updated',
          payload: expect.objectContaining({
            was: expect.objectContaining({ amount: 4000 }),
            now: expect.objectContaining({ amount: 40000 }),
          }),
        }),
      }),
    );
  });

  it('but not on a closed month', async () => {
    (prisma.cost.findFirst as any).mockResolvedValue({
      id: 'cost-1',
      organizationId: 'org-1',
      monthCardId: CLOSED_CARD.id,
      amount: 4000,
      vendor: 'Meta',
      category: 'Ad Spend',
    });

    const res = await request(app)
      .patch('/api/costs/cost-1')
      .set(...auth())
      .send({ amount: 40000 });

    expect(res.status).toBe(400);
    expect(prisma.cost.update).not.toHaveBeenCalled();
  });

  it('nor removed from one', async () => {
    (prisma.cost.findFirst as any).mockResolvedValue({
      id: 'cost-1',
      organizationId: 'org-1',
      monthCardId: CLOSED_CARD.id,
      amount: 4000,
      vendor: 'Meta',
      category: 'Ad Spend',
    });

    const res = await request(app)
      .delete('/api/costs/cost-1')
      .set(...auth());

    expect(res.status).toBe(400);
    expect(prisma.cost.update).not.toHaveBeenCalled();
  });
});
