import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { invoiceState } from '../utils/invoiceState.js';

/**
 * Money Plan 2, decisions 4, 5 and 6: the figures on /money come from the
 * server, over every row; company profit includes projects; overdue is one
 * rule, on the studio's clock.
 */

const ACCOUNTS = {
  id: 'usr-accounts',
  organizationId: 'org-1',
  name: 'Accounts',
  email: 'accounts@x',
  preset: RolePreset.ACCOUNTS,
  permissions: ['money.status', 'money.figures', 'cost.enter', 'company.read'],
  active: true,
};
const DESIGNER = { ...ACCOUNTS, id: 'usr-designer', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] };
const tokenFor = (u: { id: string; email: string; preset: RolePreset; permissions: string[] }) =>
  `Bearer ${signJwt({ userId: u.id, organizationId: 'org-1', email: u.email, preset: u.preset, permissions: u.permissions } as never)}`;
const p = prisma as any;

beforeEach(() => {
  p.user.findUnique.mockImplementation(async ({ where }: any) => [ACCOUNTS, DESIGNER].find((u) => u.id === where.id) ?? null);
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', financialYearStart: 4 });
  // 01:30 on 6 October in Chennai — still the 5th in UTC. Today is the 6th.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T20:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe('GET /money/summary', () => {
  // 250 invoices raised this year — more than one page of the list ever held.
  const raised = Array.from({ length: 250 }, (_, i) => ({
    amount: 1180,
    gstAmount: i < 240 ? 180 : null,
    workType: i % 2 ? 'MONTH_CARD' : 'PROJECT',
    projectId: i % 2 ? null : 'prj-1',
  }));
  const open = [
    // Due on the 5th: overdue in Chennai on the 6th, though the server's UTC day is still the 5th.
    { amount: 1180, dueAt: day('2026-10-05'), status: 'RAISED', workType: 'MONTH_CARD', projectId: null, payments: [{ amount: 180 }] },
    { amount: 2360, dueAt: day('2026-10-20'), status: 'RAISED', workType: 'PROJECT', projectId: 'prj-1', payments: [] },
  ];

  beforeEach(() => {
    p.invoice.findMany.mockImplementation(async ({ where }: any) => (where.raisedAt ? raised : open));
    p.payment.findMany.mockResolvedValue([
      { amount: 1180, invoice: { workType: 'MONTH_CARD', projectId: null } },
      { amount: 2360, invoice: { workType: 'PROJECT', projectId: 'prj-1' } },
    ]);
  });

  const get = (q = '?from=2026-04-01&to=2027-03-31') => request(app).get(`/api/money/summary${q}`).set('Authorization', tokenFor(ACCOUNTS));

  it('adds up every invoice, not a page of them — past 200', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.billed).toMatchObject({ amount: 295000, count: 250, retainers: 147500, projects: 147500, gst: 43200, gstUnknownCount: 10 });
    expect(res.body.includesGst).toBe(true);
    // Every row the query matched, with no page size on it.
    const raisedCall = p.invoice.findMany.mock.calls.find((c: any[]) => c[0].where.raisedAt)[0];
    expect(raisedCall.take).toBeUndefined();
  });

  it('billed leaves out cancelled invoices, and is for the period asked', async () => {
    await get();
    const where = p.invoice.findMany.mock.calls.find((c: any[]) => c[0].where.raisedAt)[0].where;
    expect(where.status).toEqual({ not: 'CANCELLED' });
    expect(where.raisedAt.gte.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    // "To" is included: the bound is the next day.
    expect(where.raisedAt.lt.toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });

  it('collected is money received in the period', async () => {
    const res = await get();
    expect(res.body.collected).toMatchObject({ amount: 3540, count: 2, retainers: 1180, projects: 2360 });
    const where = p.payment.findMany.mock.calls[0][0].where;
    expect(where.receivedAt.gte.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('outstanding and overdue are rupees owed today, overdue on the studio’s calendar', async () => {
    const res = await get();
    expect(res.body.today).toBe('2026-10-06');
    expect(res.body.outstanding).toMatchObject({ amount: 1000 + 2360, count: 2 });
    expect(res.body.overdue).toEqual({ amount: 1000, count: 1 });
  });

  it('a different period moves billed and collected', async () => {
    await get('?from=2026-10-01&to=2026-10-31');
    const where = p.invoice.findMany.mock.calls.find((c: any[]) => c[0].where.raisedAt)[0].where;
    expect(where.raisedAt.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where.raisedAt.lt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('is for money.figures only', async () => {
    const res = await request(app).get('/api/money/summary').set('Authorization', tokenFor(DESIGNER));
    expect(res.status).toBe(403);
  });
});

describe('GET /money/profit — company profit, retainers and projects', () => {
  beforeEach(() => {
    p.monthCard.findMany.mockResolvedValue([{ revenue: 100000, costs: [{ amount: 20000 }] }]);
    p.invoice.findMany.mockResolvedValue([
      // Settles a milestone: its amount, before GST.
      { amount: 118000, gstAmount: 18000, subtotal: null, milestone: { amount: 100000 } },
      // The GST was recorded: taken out.
      { amount: 59000, gstAmount: 9000, subtotal: null, milestone: null },
      // No GST recorded: counted whole, and said.
      { amount: 10000, gstAmount: null, subtotal: null, milestone: null },
    ]);
    p.cost.findMany.mockImplementation(async ({ where }: any) =>
      where.type === 'DIRECT'
        ? [
            { amount: 15000, projectId: 'prj-1' },
            { amount: 5000, projectId: null },
          ]
        : [
            { amount: 65000, category: 'Office rent', vendor: 'Landlord', confirmed: true },
            { amount: 662000, category: 'Salaries', vendor: 'Payroll', confirmed: false },
          ],
    );
    p.user.findMany.mockResolvedValue([{ monthlyCost: 150000 }, { monthlyCost: 50000 }]);
  });

  it('matches a hand count for the month', async () => {
    const res = await request(app).get('/api/money/profit?month=2026-10').set('Authorization', tokenFor(ACCOUNTS));
    expect(res.status).toBe(200);
    // Revenue: 1,00,000 retainer + (1,00,000 + 50,000 + 10,000) projects = 2,60,000, before GST.
    expect(res.body.revenue).toEqual({ retainers: 100000, projects: 160000, total: 260000, includesGst: false });
    // Direct: 20,000 on the card + 15,000 on the project + 5,000 other.
    expect(res.body.directCost).toEqual({ retainers: 20000, projects: 15000, other: 5000, total: 40000 });
    // People: the whole payroll.
    expect(res.body.peopleCost).toMatchObject({ total: 200000, people: 2, withoutCost: 0 });
    // Overheads: rent only — the Salaries cost is left out, payroll already counts it.
    expect(res.body.overheads).toMatchObject({ total: 65000, salaryLikeLeftOut: { count: 1, amount: 662000 } });
    // 2,60,000 − 40,000 − 2,00,000 − 65,000.
    expect(res.body.profit).toBe(-45000);
    expect(res.body.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/^1 project invoice has no GST recorded/), expect.stringMatching(/^1 company cost looks like salaries/)]),
    );
  });

  it('project invoices are those raised in the month, not cancelled', async () => {
    await request(app).get('/api/money/profit?month=2026-10').set('Authorization', tokenFor(ACCOUNTS));
    const where = p.invoice.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: 'CANCELLED' });
    expect(where.raisedAt.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where.raisedAt.lt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('a failure is an error, never a ₹0 profit', async () => {
    p.monthCard.findMany.mockRejectedValue(new Error('database gone'));
    const res = await request(app).get('/api/money/profit?month=2026-10').set('Authorization', tokenFor(ACCOUNTS));
    expect(res.status).toBe(500);
    expect(res.body.profit).toBeUndefined();
  });
});

describe('overdue, one rule everywhere', () => {
  it('the OVERDUE filter asks for open invoices due before today in Chennai', async () => {
    p.invoice.findMany.mockResolvedValue([]);
    p.invoice.count.mockResolvedValue(0);
    const res = await request(app).get('/api/invoices?status=OVERDUE').set('Authorization', tokenFor(ACCOUNTS));
    expect(res.status).toBe(200);
    const where = p.invoice.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['RAISED', 'OVERDUE'] });
    expect(where.dueAt.lt.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('the list and a client’s tab give the same badge for the same invoice', async () => {
    const row = {
      id: 'inv-1',
      number: 'EL/INV/26-27/001',
      companyId: 'co-1',
      amount: 1180,
      gstAmount: 180,
      status: 'RAISED',
      raisedAt: day('2026-09-20'),
      dueAt: day('2026-10-05'),
      paidAt: null,
      proformaId: null,
      subtotal: null,
      workType: null,
      workId: null,
      company: { id: 'co-1', name: 'Suvai', website: null },
      project: null,
      payments: [{ id: 'pay-1', amount: 500, receivedAt: day('2026-10-01'), mode: 'UPI', reference: null }],
    };
    p.invoice.findMany.mockResolvedValue([row]);
    p.invoice.count.mockResolvedValue(1);
    const list = await request(app).get('/api/invoices').set('Authorization', tokenFor(ACCOUNTS));
    expect(list.body.data[0]).toMatchObject({ state: 'OVERDUE', isOverdue: true, partPaid: true, agingDays: 1 });

    p.company.findFirst.mockResolvedValue({
      id: 'co-1',
      name: 'Suvai',
      tasks: [],
      people: [],
      proposals: [],
      proformas: [],
      retainers: [],
      projects: [],
      invoices: [row],
    });
    p.proposal.findMany.mockResolvedValue([]);
    p.project.findMany.mockResolvedValue([]);
    p.activity.findMany.mockResolvedValue([]);
    p.task.findMany.mockResolvedValue([]);
    const tab = await request(app).get('/api/companies/co-1').set('Authorization', tokenFor(ACCOUNTS));
    expect(tab.status).toBe(200);
    expect(tab.body.company.invoices[0]).toMatchObject({ state: 'OVERDUE', isOverdue: true, partPaid: true });
  });

  it('the rule itself', () => {
    const today = '2026-10-06';
    expect(invoiceState({ status: 'RAISED', dueAt: day('2026-10-06') }, today).state).toBe('RAISED');
    expect(invoiceState({ status: 'RAISED', dueAt: day('2026-10-05') }, today).state).toBe('OVERDUE');
    expect(invoiceState({ status: 'RAISED', dueAt: day('2026-10-30'), payments: [{ amount: 1 }] }, today).state).toBe('PART_PAID');
    expect(invoiceState({ status: 'PAID', dueAt: day('2026-01-01') }, today)).toEqual({ state: 'PAID', isOverdue: false, partPaid: false });
    expect(invoiceState({ status: 'CANCELLED', dueAt: day('2026-01-01') }, today).isOverdue).toBe(false);
  });
});
