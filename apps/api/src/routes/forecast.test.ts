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

/** ₹50,00,000 of "talking", the softest stage there is. */
const DEAL_VALUE = 5_000_000;
const DEAL_ID = 'prop-talking';

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
    { id: 'ret-1', monthlyValue: 400_000, renewalDate: null, company: { id: 'co-1', name: 'Suvai' } },
  ]);
  (prisma.proposal.findMany as any).mockResolvedValue([
    {
      id: DEAL_ID,
      stage: 'TALKING',
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

    // Committed 4,00,000. Out: 5,00,000 payroll + 15% vendor on the retainer.
    expect(m.outflows.total).toBe(560_000);
    expect(m.netCashFlow).toBe(-160_000);
    expect(m.status).toBe('DEFICIT');

    // The old sum reached +90,000 on this exact data and said SURPLUS. That
    // figure still exists — it is just no longer the verdict.
    expect(m.netCashFlowWithPipeline).toBe(90_000);
  });

  it('measures what is kept against committed cash, not against hope', async () => {
    const m = await thisMonth();
    // -160,000 of 400,000. Against the old total it flattered itself to +13%.
    expect(m.cashKeptPercent).toBe(-40);
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

  it('costs the won deal as well as banking it', async () => {
    const m = await thisMonth(`?assumeWon=${DEAL_ID}`);
    // 15% of the retainer plus 20% of the newly-won work. A scenario that
    // counts the income and not the spend is a sales pitch.
    expect(m.outflows.vendorAndDirect).toBe(60_000 + DEAL_VALUE * 0.2);
    expect(m.status).toBe('SURPLUS');
  });

  it('actually changes the number the panel reads', async () => {
    // The scenario panel shows `scenario.netCashFlow - base.netCashFlow`. With
    // the deal left in the weighted line — which no longer reaches
    // netCashFlow — picking a deal would have moved it by exactly nothing.
    const base = await thisMonth();
    const scenario = await thisMonth(`?assumeWon=${DEAL_ID}`);
    expect(scenario.netCashFlow - base.netCashFlow).toBe(DEAL_VALUE * 0.8);
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
