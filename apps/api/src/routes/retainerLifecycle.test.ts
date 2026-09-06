import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset, RetainerStatus } from '@prisma/client';
import { rollActiveRetainers } from '../workers/monthCard.cron.js';

/**
 * Ending a retainer, and closing the months it ran for.
 *
 * ─── Why there was nothing to end it with ───────────────────────────────────
 *
 * `STOPPED`, `stoppedAt` and `stopReason` were in the schema from the first
 * version and nothing ever wrote them, so a retainer once started ran for
 * ever. Everything downstream keys off `status: 'ACTIVE'` — the 1st-of-month
 * roll, MRR, the forecast, the scanner — which meant a client who had left
 * kept generating tasks on real people's screens and kept counting towards the
 * monthly recurring figure. Nothing was wrong with any of those readers; there
 * was simply no way to tell them the client had gone.
 *
 * ─── And why the months were never closed ───────────────────────────────────
 *
 * `MonthCardStatus.CLOSED` had the same problem with a smaller blast radius:
 * one alert rule, MONTH_CARD_NOT_INVOICED, waits for a card closed five days
 * ago with no invoice — the month's work done and nobody billed for it — and
 * could never fire, because no card was ever closed.
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

const RETAINER = {
  id: 'ret-1',
  organizationId: 'org-1',
  companyId: 'co-1',
  status: RetainerStatus.ACTIVE,
  monthlyValue: 220000,
  company: { name: 'Carlton Wellness' },
};

/** A month card as the stop route reads it — with what has happened on it. */
const card = (id: string, month: string, over: Partial<{ tasks: number; costs: number; invoiceId: string | null }> = {}) => ({
  id,
  month,
  status: 'OPEN',
  invoiceId: over.invoiceId ?? null,
  _count: { tasks: over.tasks ?? 0, costs: over.costs ?? 0 },
});

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
  (prisma.retainer.findFirst as any).mockResolvedValue(RETAINER);
  (prisma.retainer.update as any).mockImplementation(async ({ data }: any) => ({ ...RETAINER, ...data }));
  (prisma.monthCard.findMany as any).mockResolvedValue([]);
  (prisma.monthCard.deleteMany as any).mockResolvedValue({ count: 0 });
  (prisma.monthCard.updateMany as any).mockResolvedValue({ count: 0 });
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
});

const stop = (body: Record<string, unknown> = { reason: 'Contract not renewed' }) =>
  request(app).post('/api/retainers/ret-1/stop').set(...AUTH).send(body);

describe('stopping a retainer', () => {
  it('records that it ended, when, and why', async () => {
    const res = await stop({ reason: 'Client moved in-house' });

    expect(res.status).toBe(200);
    const { data } = (prisma.retainer.update as any).mock.calls.at(-1)[0];
    expect(data.status).toBe('STOPPED');
    expect(data.stopReason).toBe('Client moved in-house');
    expect(data.stoppedAt).toBeInstanceOf(Date);
  });

  it('insists on a reason', async () => {
    // The one thing nobody remembers six months later, and the only field that
    // makes a churned client tell you anything.
    const res = await stop({ reason: '' });
    expect(res.status).toBe(400);
    expect(prisma.retainer.update).not.toHaveBeenCalled();
  });

  it('refuses to stop one twice', async () => {
    (prisma.retainer.findFirst as any).mockResolvedValue({ ...RETAINER, status: RetainerStatus.STOPPED });
    const res = await stop();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been stopped/i);
  });

  it('will not reach into another organization', async () => {
    (prisma.retainer.findFirst as any).mockResolvedValue(null);
    const res = await stop();
    expect(res.status).toBe(404);
  });

  it('writes the ending to the trail', async () => {
    await stop({ reason: 'Budget cut' });
    const { data } = (prisma.activity.create as any).mock.calls.at(-1)[0];
    expect(data.verb).toBe('retainer_stopped');
    expect(data.payload.reason).toBe('Budget cut');
  });
});

describe('the month you are part way through', () => {
  it('keeps a month that has been worked, and closes it', async () => {
    // Work happened, so it is owed for. Closing it is also what puts it in
    // front of somebody: MONTH_CARD_NOT_INVOICED reads closed-and-unbilled.
    (prisma.monthCard.findMany as any).mockResolvedValue([card('mc-1', '2026-09', { tasks: 6 })]);

    const res = await stop();

    expect(res.status).toBe(200);
    expect(res.body.closedMonths).toEqual(['2026-09']);
    const { data } = (prisma.monthCard.updateMany as any).mock.calls.at(-1)[0];
    expect(data.status).toBe('CLOSED');
    expect(prisma.monthCard.deleteMany).not.toHaveBeenCalled();
  });

  it('removes a month nothing ever happened on', async () => {
    // The roll opened it on the 1st and the client left on the 2nd. Billing
    // for it would be billing for a month that never took place.
    (prisma.monthCard.findMany as any).mockResolvedValue([card('mc-1', '2026-09')]);

    const res = await stop();

    expect(res.status).toBe(200);
    expect(res.body.removedMonths).toEqual(['2026-09']);
    expect(prisma.monthCard.deleteMany).toHaveBeenCalled();
    expect(prisma.monthCard.updateMany).not.toHaveBeenCalled();
  });

  it('counts a cost as work, not only a task', async () => {
    (prisma.monthCard.findMany as any).mockResolvedValue([card('mc-1', '2026-09', { costs: 1 })]);
    const res = await stop();
    expect(res.body.closedMonths).toEqual(['2026-09']);
  });

  it('never removes one that has already been invoiced', async () => {
    (prisma.monthCard.findMany as any).mockResolvedValue([card('mc-1', '2026-09', { invoiceId: 'inv-1' })]);
    const res = await stop();
    expect(res.body.removedMonths).toEqual([]);
    expect(res.body.closedMonths).toEqual(['2026-09']);
  });
});

describe('the monthly roll closes the month that ended', () => {
  beforeEach(() => {
    (prisma.retainer.findMany as any).mockResolvedValue([]);
  });

  it('closes every open card from a month before the one being opened', async () => {
    await rollActiveRetainers('2026-10');

    const call = (prisma.monthCard.updateMany as any).mock.calls.at(-1)[0];
    expect(call.where).toEqual({ month: { lt: '2026-10' }, status: 'OPEN' });
    expect(call.data.status).toBe('CLOSED');
    expect(call.data.closedAt).toBeInstanceOf(Date);
  });

  it('closes a departed client’s last month too, not only running ones', async () => {
    // Scoped by month rather than by retainer status: a client who left in
    // March still has a March card, and it still wants invoicing.
    await rollActiveRetainers('2026-10');
    const call = (prisma.monthCard.updateMany as any).mock.calls.at(-1)[0];
    expect(call.where.retainer).toBeUndefined();
  });
});
