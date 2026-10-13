import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { applyCompanyStatusDerivation } from '../workers/scanner.cron.js';

/**
 * The four real bugs behind the production money audit (2026-10-05).
 *
 *   1. Salaries could not be entered, so everybody cost ₹0.
 *   2. The Forecast took no overheads off, and said SURPLUS with ₹0 payroll
 *      without a word.
 *   3. The Profit tab reported a month nobody had costed as 100% profit.
 *   4. A client with a live deal was filed under Past, because the rule never
 *      looked at the Pipeline.
 */

const ADMIN = {
  id: 'usr-admin',
  organizationId: 'org-1',
  name: 'Akmal',
  email: 'akmal@x',
  preset: RolePreset.MANAGEMENT,
  permissions: ['money.status', 'money.figures', 'reports.read', 'setup.admin'],
  active: true,
};
const auth = { Authorization: `Bearer ${signJwt({ userId: ADMIN.id, organizationId: 'org-1', email: ADMIN.email, preset: ADMIN.preset, permissions: ADMIN.permissions } as never)}` };
const p = prisma as any;

beforeEach(() => {
  p.user.findUnique.mockImplementation(async ({ where }: any) => (where.id === ADMIN.id ? ADMIN : null));
  p.activity.create.mockResolvedValue({});
});

// ── 1 ──
describe('1. a monthly cost can be entered', () => {
  it("an admin's edit saves it", async () => {
    p.user.findFirst.mockResolvedValue({ id: 'usr-ramya', name: 'Ramya', organizationId: 'org-1', active: true, monthlyCost: 0 });
    p.user.update.mockResolvedValue({ id: 'usr-ramya', name: 'Ramya', dept: 'Design', preset: 'EMPLOYEE', permissions: [], monthlyCost: 45000 });
    const res = await request(app).patch('/api/users/usr-ramya').set(auth).send({ monthlyCost: 45000 });
    expect(res.status).toBe(200);
    expect(p.user.update.mock.calls[0][0].data).toMatchObject({ monthlyCost: 45000 });
  });
});

// ── 2 ──
describe('2. the Forecast takes costs off, and says what it cannot see', () => {
  beforeEach(() => {
    p.organization.findUnique.mockResolvedValue({});
    p.retainer.findMany.mockResolvedValue([
      { id: 'r1', monthlyValue: 268000, status: 'ACTIVE', startDate: new Date('2026-01-01'), renewalDate: null, company: { id: 'c1', name: 'Acme' } },
    ]);
    p.proposal.findMany.mockResolvedValue([]);
    p.project.findMany.mockResolvedValue([]);
    p.milestone.findMany.mockResolvedValue([]);
  });
  const get = () => request(app).get('/api/forecast/3-month').set(auth);

  // The recurring rows, then the costs owed and not paid.
  const costs = (recurring: unknown[], owed: unknown[] = []) =>
    p.cost.findMany.mockResolvedValueOnce(recurring).mockResolvedValueOnce(owed);
  const rent = { category: 'Office rent', vendor: 'Landlord', amount: 65000, incurredAt: new Date('2026-01-05') };

  it('with nobody costed: payroll ₹0 is said, and no recurring costs is said', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u1', monthlyCost: 0 }, { id: 'u2', monthlyCost: 0 }]);
    costs([], []);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([
      expect.stringMatching(/^No one's monthly cost is entered, so payroll is ₹0/),
      expect.stringMatching(/^No recurring costs are set up/),
    ]);
    expect(res.body.summary).toMatchObject({ monthlyPayroll: 0, monthlyRecurringCosts: 0, peopleWithoutCost: 2 });
  });

  it('recurring costs are taken off every month', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u1', monthlyCost: 150000 }, { id: 'u2', monthlyCost: 0 }]);
    costs([rent, { category: 'Software', vendor: 'Adobe', amount: 27000, incurredAt: new Date('2026-01-05') }]);
    const res = await get();
    expect(res.body.summary).toMatchObject({ monthlyPayroll: 150000, monthlyRecurringCosts: 92000 });
    const first = res.body.forecast[0];
    expect(first.outflows).toEqual({ payroll: 150000, recurring: 92000, committed: 0, total: 242000 });
    expect(res.body.warnings).toEqual([expect.stringMatching(/^1 of 2 people have no monthly cost entered/)]);
  });

  it('a Salaries cost is never payroll — payroll is Team, and the cost is left out and said', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u1', monthlyCost: 150000 }]);
    costs([{ category: 'Salaries', vendor: 'Payroll', amount: 662000, incurredAt: new Date('2026-01-05') }, rent]);
    const res = await get();
    expect(res.body.summary).toMatchObject({ monthlyPayroll: 150000, monthlyRecurringCosts: 65000 });
    expect(res.body.forecast[0].outflows.total).toBe(150000 + 65000);
    expect(res.body.warnings).toEqual([expect.stringMatching(/^1 recurring or owed cost looks like salaries/)]);
  });
});

// ── 3 ──
describe('3. a month nobody has costed is not profit', () => {
  beforeEach(() => {
    p.monthCard.findMany.mockResolvedValue([
      { revenue: 40000, retainer: { company: { id: 'c1', name: 'Heaven’s ELIX' } }, costs: [], allocations: [] },
      { revenue: 100000, retainer: { company: { id: 'c2', name: 'Brigade' } }, costs: [{ amount: 20000 }], allocations: [] },
    ]);
    p.user.count.mockResolvedValueOnce(16).mockResolvedValueOnce(16);
    p.peopleAllocation.count.mockResolvedValueOnce(16).mockResolvedValueOnce(0);
  });

  it('says "not costed" instead of counting the fee, and keeps it out of the profit total', async () => {
    const res = await request(app).get('/api/retainers/profitability?month=2026-10').set(auth);
    expect(res.status).toBe(200);
    const elix = res.body.rows.find((r: any) => r.companyName.startsWith('Heaven'));
    expect(elix.costed).toBe(false);
    expect(res.body.rows[0].companyName).toBe('Brigade');
    expect(res.body.totals).toMatchObject({
      revenue: 140000,
      profit: 80000,
      costedRevenue: 100000,
      uncostedCount: 1,
      uncostedRevenue: 40000,
      marginPercent: 80,
    });
  });

  it('says when salaries are missing and the time split is not confirmed', async () => {
    const res = await request(app).get('/api/retainers/profitability?month=2026-10').set(auth);
    expect(res.body.warnings).toEqual([
      expect.stringMatching(/^No one's monthly cost is entered, so people cost is ₹0/),
      'The time split is not confirmed (0 of 16), so people cost uses the proposed split.',
    ]);
  });
});

// ── 4 ──
describe('4. a client with a live deal is never filed under Past', () => {
  const old = new Date('2026-01-01');
  const company = (over: Record<string, unknown> = {}) => ({
    id: 'co-rh',
    name: 'Right Hospitals',
    status: 'CLIENT',
    createdAt: old,
    retainers: [],
    projects: [],
    proposals: [],
    ...over,
  });

  beforeEach(() => {
    p.company.findMany.mockReset();
    p.company.update.mockReset();
    p.activity.findFirst.mockResolvedValue(null);
    p.activity.findMany.mockResolvedValue([]);
  });
  const madePast = () => p.company.update.mock.calls.some((c: any[]) => c[0].data.status === 'PAST');

  it('an open deal keeps it current, however quiet the client record is', async () => {
    p.company.findMany
      .mockResolvedValueOnce([company({ proposals: [{ id: 'pr-1', outcome: null, stage: 'PROPOSAL_SENT' }] })])
      .mockResolvedValueOnce([]);
    await applyCompanyStatusDerivation('org-1');
    expect(madePast()).toBe(false);
  });

  it('work on its proposals counts as contact', async () => {
    p.company.findMany
      .mockResolvedValueOnce([company({ proposals: [{ id: 'pr-1', outcome: 'LOST', stage: 'LOST' }] })])
      .mockResolvedValueOnce([]);
    p.activity.findFirst.mockResolvedValue({ at: new Date() });
    await applyCompanyStatusDerivation('org-1');
    expect(madePast()).toBe(false);
    expect(p.activity.findFirst.mock.calls[0][0].where.OR).toContainEqual({ entityType: 'Proposal', entityId: { in: ['pr-1'] } });
  });

  it('still files a client with nothing open and no contact in 90 days', async () => {
    p.company.findMany.mockResolvedValueOnce([company()]).mockResolvedValueOnce([]);
    await applyCompanyStatusDerivation('org-1');
    expect(madePast()).toBe(true);
  });

  it('puts back a client this rule moved to Past that has an open deal — to Client if it ever had work', async () => {
    p.company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'co-rh', proposals: [{ outcome: null }, { outcome: 'WON' }], retainers: [], projects: [] }]);
    p.activity.findMany.mockResolvedValue([{ verb: 'status_derived_past', payload: { reason: 'x' } }]);
    await applyCompanyStatusDerivation('org-1');
    expect(p.company.update).toHaveBeenCalledWith({ where: { id: 'co-rh' }, data: { status: 'CLIENT' } });
    expect(p.activity.create.mock.calls.at(-1)[0].data).toMatchObject({ verb: 'status_derived_back', payload: { status: 'CLIENT' } });
  });

  it('leaves alone one a person filed under Past by hand', async () => {
    p.company.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'co-x', proposals: [{ outcome: null }], retainers: [], projects: [] }]);
    p.activity.findMany.mockResolvedValue([
      { verb: 'company_updated', payload: { changed: { status: { from: 'CLIENT', to: 'PAST' } } } },
      { verb: 'status_derived_past', payload: {} },
    ]);
    await applyCompanyStatusDerivation('org-1');
    expect(p.company.update).not.toHaveBeenCalled();
  });
});
