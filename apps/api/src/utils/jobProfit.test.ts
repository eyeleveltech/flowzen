import { describe, it, expect } from 'vitest';
import { jobProfit, percentComplete, costRisk } from './jobProfit.js';

/**
 * The arithmetic a project's final profit figure rests on.
 *
 * The cases that matter are the ones where a plausible shortcut gives a
 * confident wrong answer: a margin on zero revenue, a projection made on day
 * three, and an over-budget job that is still profitable.
 */

// A ₹4,50,000 build, estimated at ₹2,00,000 to deliver.
const base = { quotedValue: 450_000, estimatedCost: 200_000, directCost: 60_000, peopleCost: 90_000 };

describe('job profit', () => {
  it('is revenue less both kinds of cost', () => {
    const p = jobProfit(base);
    expect(p.actualCost).toBe(150_000);
    expect(p.profit).toBe(300_000);
    expect(p.marginPercent).toBe(66.7);
  });

  it('keeps external spend and salary apart', () => {
    // The merged `actualCostTotal` the project page used to show could not
    // answer "did we overspend on vendors or overstaff it", which is the
    // question that changes what you do next time.
    const p = jobProfit(base);
    expect(p.directCost).toBe(60_000);
    expect(p.peopleCost).toBe(90_000);
  });

  it('reports no margin at all on a project with no quoted value', () => {
    // Not 0 — that reads as "we broke even", which is a claim about a job
    // nobody has priced.
    expect(jobProfit({ ...base, quotedValue: 0 }).marginPercent).toBeNull();
  });

  it('goes negative rather than clamping when a job loses money', () => {
    const p = jobProfit({ ...base, directCost: 400_000, peopleCost: 200_000 });
    expect(p.profit).toBe(-150_000);
    expect(p.marginPercent).toBe(-33.3);
  });

  it('compares against the estimate when there is one', () => {
    const p = jobProfit({ ...base, directCost: 150_000, peopleCost: 100_000 });
    expect(p.costVariance).toBe(50_000);
    expect(p.costVariancePercent).toBe(25);
  });

  it('says nothing about variance when nobody estimated', () => {
    const p = jobProfit({ ...base, estimatedCost: null });
    expect(p.costVariance).toBeNull();
    expect(p.costVariancePercent).toBeNull();
  });
});

describe('percent complete', () => {
  const dates = { startDate: new Date('2026-01-01'), endDate: new Date('2026-03-01') };

  it('counts milestones that have been billed or paid', () => {
    const r = percentComplete({
      ...dates,
      milestones: [{ status: 'PAID' }, { status: 'INVOICED' }, { status: 'PENDING' }, { status: 'PENDING' }],
    });
    expect(r).toEqual({ percent: 50, basis: 'milestones' });
  });

  it('falls back to the calendar when a project has no milestones, and says so', () => {
    const r = percentComplete({ ...dates, milestones: [], now: new Date('2026-02-01') });
    expect(r.basis).toBe('calendar');
    expect(r.percent).toBeGreaterThan(45);
    expect(r.percent).toBeLessThan(55);
  });

  it('never reports past 100 on an overrunning project', () => {
    const r = percentComplete({ ...dates, milestones: [], now: new Date('2026-09-01') });
    expect(r.percent).toBe(100);
  });
});

describe('cost risk — the warning that arrives in time to matter', () => {
  it('judges nothing in the first tenth of a job', () => {
    // Early spend is lumpy: a licence, a deposit, the whole shoot up front.
    // An alert on day three teaches people to ignore alerts.
    const p = jobProfit({ ...base, directCost: 100_000, peopleCost: 20_000 });
    const r = costRisk({ profit: p, percentComplete: 5 });
    expect(r.level).toBe('OK');
    expect(r.projectedCost).toBeNull();
  });

  it('projects from the rate of spend, not from today total', () => {
    // 25% done having spent ₹1,50,000 → ₹6,00,000 at this rate, on a
    // ₹4,50,000 job. Today's spend alone looks comfortable and is not.
    const p = jobProfit(base);
    const r = costRisk({ profit: p, percentComplete: 25 });
    expect(r.projectedCost).toBe(600_000);
    expect(r.projectedProfit).toBe(-150_000);
    expect(r.level).toBe('LOSS');
  });

  it('calls a job that is over budget but still profitable OVER, not LOSS', () => {
    // ₹90,000 spent at 50% done → ₹1,80,000 projected against a ₹1,20,000
    // estimate: 50% over, and still ₹2,70,000 of profit. Both true; only one
    // is worth the loudest word.
    const p = jobProfit({ ...base, estimatedCost: 120_000, directCost: 40_000, peopleCost: 50_000 });
    const r = costRisk({ profit: p, percentComplete: 50 });
    expect(r.level).toBe('OVER');
    expect(r.projectedProfit).toBeGreaterThan(0);
  });

  it('is quiet about a job running to plan', () => {
    const p = jobProfit({ ...base, directCost: 40_000, peopleCost: 60_000 });
    const r = costRisk({ profit: p, percentComplete: 50 });
    expect(r.level).toBe('OK');
    expect(r.reason).toBeNull();
  });

  it('still notices a thin margin when nobody wrote down an estimate', () => {
    const p = jobProfit({ ...base, estimatedCost: null, directCost: 120_000, peopleCost: 90_000 });
    const r = costRisk({ profit: p, percentComplete: 50 });
    expect(r.level).toBe('WATCH');
    expect(r.reason).toMatch(/margin under 10%/);
  });
});
