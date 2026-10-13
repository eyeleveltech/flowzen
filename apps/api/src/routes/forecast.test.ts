import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * The cash-flow radar, and the surplus that was not there.
 *
 * The three inflow lines — retainers, weighted pipeline, project milestones —
 * were added into one total, and SURPLUS / DEFICIT was decided from it. Two
 * separate things were wrong:
 *
 *   1. Brief §8 reports committed revenue "split by Retainer and One time,
 *      never summed into a single figure", and this screen summed them.
 *   2. Weighted pipeline was in the same sum, so an unsigned conversation
 *      counted as cash — while the OUTFLOW side counted no pipeline at all.
 *
 * The month below is the shape of the bug: real commitments do not cover the
 * payroll, and the pipeline was large enough to hide that.
 */

const MANAGEMENT = {
  id: 'usr-boss',
  preset: RolePreset.MANAGEMENT,
  permissions: ['work.own', 'work.all', 'money.figures', 'reports.read', 'setup.admin'],
};
const EMPLOYEE = { id: 'usr-emp', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] };

const auth = (who: typeof MANAGEMENT | typeof EMPLOYEE) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: who.id,
      organizationId: 'org-1',
      email: 'x@eyelevel.local',
      preset: who.preset,
      permissions: [...who.permissions],
    })}`,
  ] as const;

/**
 * ₹50,00,000 sent and not yet answered -- the softest stage there is, now that
 * the softer one in front of it is gone. Proposal sent is where §14 starts
 * pricing a proposal, and where the board starts.
 */
const DEAL_VALUE = 5_000_000;
const DEAL_ID = 'prop-sent';

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const who = [MANAGEMENT, EMPLOYEE].find((p) => p.id === where.id);
    if (!who) return null;
    return {
      id: who.id,
      organizationId: 'org-1',
      name: 'Somebody',
      email: 'x@eyelevel.local',
      preset: who.preset,
      permissions: [...who.permissions],
      active: true,
      sessionsValidFrom: null,
    };
  });

  // Payroll ₹5,00,000 a month against ₹4,00,000 of retainer. The month is
  // short, and that is the point.
  (prisma.user.findMany as any).mockResolvedValue([
    { id: 'usr-1', name: 'Team', dept: 'DESIGN', monthlyCost: 500_000 },
  ]);
  (prisma.retainer.findMany as any).mockResolvedValue([
    { id: 'ret-1', monthlyValue: 400_000, startDate: new Date('2026-01-01'), renewalDate: null, company: { id: 'co-1', name: 'Suvai' } },
  ]);
  // No recurring costs and nothing owed, unless a test says otherwise.
  (prisma.cost.findMany as any).mockResolvedValue([]);
  (prisma.proposal.findMany as any).mockResolvedValue([
    {
      id: DEAL_ID,
      stage: 'PROPOSAL_SENT',
      probabilityOverride: null,
      company: { id: 'co-2', name: 'Maybe One Day' },
      versions: [{ value: DEAL_VALUE, n: 1 }],
    },
  ]);
  (prisma.project.findMany as any).mockResolvedValue([]);
});

const thisMonth = async (query = '') => {
  const res = await request(app)
    .get(`/api/forecast/3-month${query}`)
    .set(...auth(MANAGEMENT));
  expect(res.status).toBe(200);
  return res.body.forecast[0];
};

describe('what counts as money', () => {
  it('keeps retainer and one-off money on separate lines', () => {
    // Brief §8. They are added into a CASH figure below, which is a different
    // claim from adding them into a revenue figure — but the two components
    // have to survive the trip or the split is only in the UI.
    return thisMonth().then((m) => {
      expect(m.inflows).toHaveProperty('retainers');
      expect(m.inflows).toHaveProperty('projects');
    });
  });

  it('leaves weighted pipeline out of committed cash', async () => {
    const m = await thisMonth();
    expect(m.inflows.pipelineWeighted).toBeGreaterThan(0);
    expect(m.inflows.committed).toBe(
      m.inflows.retainers + m.inflows.projects + m.inflows.assumedWon,
    );
    expect(m.inflows.committed).toBe(400_000);
  });

  it('still reports the optimistic total, separately', async () => {
    const m = await thisMonth();
    expect(m.inflows.total).toBe(m.inflows.committed + m.inflows.pipelineWeighted);
  });
});

describe('the verdict', () => {
  it('calls a month short when only the pipeline would cover it', async () => {
    const m = await thisMonth();

    // Committed 4,00,000. Out: 5,00,000 payroll — and nothing guessed on top.
    expect(m.outflows.total).toBe(500_000);
    expect(m.netCashFlow).toBe(-100_000);
    expect(m.status).toBe('DEFICIT');

    // The old sum reaches a surplus on this exact data and says so. That
    // figure still exists — it is just no longer the verdict.
    //
    // It grew when TALKING was removed and this deal moved to Proposal sent:
    // §14 prices that at 30% against the 10% behind it, so the same ₹50,00,000
    // now weighs three times what it did. The point of the test is unchanged —
    // committed cash is short, and only hope covers it.
    expect(m.netCashFlowWithPipeline).toBe(650_000);
  });

  it('measures what is kept against committed cash, not against hope', async () => {
    const m = await thisMonth();
    // -100,000 of 400,000.
    expect(m.cashKeptPercent).toBe(-25);
    expect(m).not.toHaveProperty('grossMarginPercent');
  });
});

describe('what if this deal closes', () => {
  it('moves the deal into committed cash rather than the weighted line', async () => {
    const m = await thisMonth(`?assumeWon=${DEAL_ID}`);

    expect(m.inflows.assumedWon).toBe(DEAL_VALUE);
    expect(m.inflows.pipelineWeighted).toBe(0);
    expect(m.inflows.committed).toBe(400_000 + DEAL_VALUE);
  });

  it('takes off what we owe, not a share of the income', async () => {
    const m = await thisMonth(`?assumeWon=${DEAL_ID}`);
    // Money Plan 2, decision 9: the 15–20% "vendor and direct" guess is gone.
    // Outflows are salaries, recurring costs and costs owed — none of which a
    // won deal changes until its costs are entered.
    expect(m.outflows).toEqual({ payroll: 500_000, recurring: 0, committed: 0, total: 500_000 });
    expect(m.status).toBe('SURPLUS');
  });

  it('actually changes the number the panel reads', async () => {
    // The scenario panel shows `scenario.netCashFlow - base.netCashFlow`. With
    // the deal left in the weighted line — which no longer reaches
    // netCashFlow — picking a deal would have moved it by exactly nothing.
    const base = await thisMonth();
    const scenario = await thisMonth(`?assumeWon=${DEAL_ID}`);
    expect(scenario.netCashFlow - base.netCashFlow).toBe(DEAL_VALUE);
  });
});

// ── Money Plan 2, decision 9 ──
describe('a project deal, a retainer not started yet, and what goes out', () => {
  const PROJECT_DEAL = 'prop-film';

  it('counts a project deal once — in the first month — not in all three', async () => {
    (prisma.proposal.findMany as any).mockResolvedValue([
      { id: PROJECT_DEAL, kind: 'PROJECT', stage: 'VERBAL_YES', probabilityOverride: 100, company: { id: 'co-3', name: 'Film Co' }, versions: [{ value: 500_000, n: 1 }] },
    ]);
    const res = await request(app).get('/api/forecast/3-month').set(...auth(MANAGEMENT));
    const weighted = res.body.forecast.map((m: any) => m.inflows.pipelineWeighted);
    expect(weighted).toEqual([500_000, 0, 0]);

    const won = await request(app).get(`/api/forecast/3-month?assumeWon=${PROJECT_DEAL}`).set(...auth(MANAGEMENT));
    expect(won.body.forecast.map((m: any) => m.inflows.assumedWon)).toEqual([500_000, 0, 0]);
  });

  it('skips a retainer that starts next quarter', async () => {
    const res0 = await request(app).get('/api/forecast/3-month').set(...auth(MANAGEMENT));
    const months: string[] = res0.body.forecast.map((m: any) => m.monthKey);
    (prisma.retainer.findMany as any).mockResolvedValue([
      { id: 'ret-1', monthlyValue: 400_000, startDate: new Date('2026-01-01'), renewalDate: null, company: { id: 'co-1', name: 'Suvai' } },
      // Starts in the third month of the window.
      { id: 'ret-2', monthlyValue: 100_000, startDate: new Date(`${months[2]}-01T00:00:00Z`), renewalDate: null, company: { id: 'co-4', name: 'Later' } },
      // Starts after the window altogether.
      { id: 'ret-3', monthlyValue: 900_000, startDate: new Date('2099-01-01'), renewalDate: null, company: { id: 'co-5', name: 'Much later' } },
    ]);
    const res = await request(app).get('/api/forecast/3-month').set(...auth(MANAGEMENT));
    expect(res.body.forecast.map((m: any) => m.inflows.retainers)).toEqual([400_000, 400_000, 500_000]);
  });

  it('outflows: salaries + confirmed recurring costs + costs owed, salary-like ones left out', async () => {
    const res0 = await request(app).get('/api/forecast/3-month').set(...auth(MANAGEMENT));
    const [m1, m2] = res0.body.forecast.map((m: any) => m.monthKey);
    (prisma.cost.findMany as any)
      // The recurring rows (not their monthly copies), confirmed.
      .mockResolvedValueOnce([
        { category: 'Office rent', vendor: 'Landlord', amount: 65_000, incurredAt: new Date('2026-01-10') },
        { category: 'Salaries', vendor: 'Payroll', amount: 662_000, incurredAt: new Date('2026-01-10') },
        // Set up to start next month.
        { category: 'Software', vendor: 'Adobe', amount: 20_000, incurredAt: new Date(`${m2}-01T00:00:00Z`) },
      ])
      // Owed, not paid: one already past due, one due next month.
      .mockResolvedValueOnce([
        { category: 'Printing', vendor: 'Press', amount: 30_000, incurredAt: new Date('2026-01-20') },
        { category: 'Shoot', vendor: 'Crew', amount: 45_000, incurredAt: new Date(`${m2}-15T00:00:00Z`) },
      ]);
    const res = await request(app).get('/api/forecast/3-month').set(...auth(MANAGEMENT));
    const [first, second, third] = res.body.forecast;
    expect(first.outflows).toEqual({ payroll: 500_000, recurring: 65_000, committed: 30_000, total: 595_000 });
    expect(second.outflows).toEqual({ payroll: 500_000, recurring: 85_000, committed: 45_000, total: 630_000 });
    expect(third.outflows).toEqual({ payroll: 500_000, recurring: 85_000, committed: 0, total: 585_000 });
    expect(res.body.summary.monthlyRecurringCosts).toBe(65_000);
    expect(res.body.warnings).toContainEqual(expect.stringMatching(/^1 recurring or owed cost looks like salaries/));
    expect(m1).toBeTruthy();

    // The queries: the recurring rows themselves, confirmed; owed ones that are not recurring.
    const calls = (prisma.cost.findMany as any).mock.calls.slice(-2).map((c: any[]) => c[0].where);
    expect(calls[0]).toMatchObject({ recurring: true, recurringSourceId: null, confirmed: true, deletedAt: null });
    expect(calls[1]).toMatchObject({ committedNotPaid: true, recurring: false, recurringSourceId: null, deletedAt: null });
  });
});

describe('who may ask', () => {
  it('refuses somebody without reports.read', async () => {
    const res = await request(app)
      .get('/api/forecast/3-month')
      .set(...auth(EMPLOYEE));
    expect(res.status).toBe(403);
  });
});
