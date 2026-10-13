import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { rollRecurringCosts } from './recurringCost.cron.js';

/**
 * Money Plan 2, decision 1: a recurring cost's monthly copy goes on the right
 * month, never in the template's own month, never comes back once deleted,
 * and carries its GST.
 */
const p = prisma as any;

const template = (over: Record<string, unknown> = {}) => ({
  id: 'tpl-rent',
  organizationId: 'org-1',
  type: 'COMPANY',
  workType: null,
  workId: null,
  monthCardId: null,
  monthCard: null,
  projectId: null,
  category: 'Office rent',
  vendor: 'Landlord',
  amount: 65000,
  gstPercent: 18,
  incurredAt: new Date('2026-09-22T00:00:00Z'),
  committedNotPaid: false,
  paidBy: 'Company',
  treatment: 'COMPANY_EXPENSE',
  enteredById: 'usr-1',
  recurring: true,
  notes: null,
  ...over,
});

beforeEach(() => {
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', financialYearStart: 4 });
  p.cost.findFirst.mockResolvedValue(null);
  p.cost.create.mockImplementation(async ({ data }: any) => ({ id: 'clone-1', ...data }));
  p.activity.create.mockResolvedValue({});
});

describe('rollRecurringCosts', () => {
  it('does not copy a cost into the month it was entered in', async () => {
    p.cost.findMany.mockResolvedValue([template()]);
    const res = await rollRecurringCosts('2026-09');
    expect(res.created).toBe(0);
    expect(p.cost.create).not.toHaveBeenCalled();
  });

  it("next month's copy is dated the 1st, has no card, and carries the GST rate", async () => {
    p.cost.findMany.mockResolvedValue([template()]);
    const res = await rollRecurringCosts('2026-10');
    expect(res.created).toBe(1);
    const data = p.cost.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ monthCardId: null, gstPercent: 18, recurring: false, recurringSourceId: 'tpl-rent', confirmed: false });
    expect(data.incurredAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('a deleted copy counts as rolled, so it is not made again', async () => {
    p.cost.findMany.mockResolvedValue([template()]);
    p.cost.findFirst.mockResolvedValue({ id: 'deleted-clone' });
    const res = await rollRecurringCosts('2026-10');
    expect(res.created).toBe(0);
    // The look-up includes deleted rows.
    const where = p.cost.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ recurringSourceId: 'tpl-rent', deletedAt: undefined });
    expect(where.incurredAt.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where.incurredAt.lt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it("a retainer cost goes on that retainer's card for the new month, not the template's old one", async () => {
    p.cost.findMany.mockResolvedValue([
      template({
        id: 'tpl-editor',
        type: 'DIRECT',
        workType: 'MONTH_CARD',
        workId: 'card-aug',
        monthCardId: 'card-aug',
        monthCard: { retainerId: 'ret-1' },
        incurredAt: new Date('2026-08-10T00:00:00Z'),
      }),
    ]);
    p.monthCard.findFirst.mockResolvedValue({ id: 'card-oct', status: 'OPEN' });
    const res = await rollRecurringCosts('2026-10');
    expect(res.created).toBe(1);
    expect(p.monthCard.findFirst.mock.calls[0][0].where).toEqual({ retainerId: 'ret-1', month: '2026-10' });
    expect(p.cost.create.mock.calls[0][0].data).toMatchObject({ monthCardId: 'card-oct', workId: 'card-oct' });
  });

  it("waits when the retainer's month is not open yet", async () => {
    p.cost.findMany.mockResolvedValue([
      template({ type: 'DIRECT', workType: 'MONTH_CARD', workId: 'card-aug', monthCardId: 'card-aug', monthCard: { retainerId: 'ret-1' }, incurredAt: new Date('2026-08-10T00:00:00Z') }),
    ]);
    p.monthCard.findFirst.mockResolvedValue(null);
    const res = await rollRecurringCosts('2026-10');
    expect(res).toEqual({ created: 0, waiting: 1 });
    expect(p.cost.create).not.toHaveBeenCalled();
  });

  it("'this month' is the studio's month: 00:30 on 1 Oct in Chennai is still 30 Sep in UTC", async () => {
    p.cost.findMany.mockResolvedValue([template()]);
    await rollRecurringCosts(undefined, new Date('2026-09-30T19:00:00Z'));
    expect(p.cost.create.mock.calls[0][0].data.incurredAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
