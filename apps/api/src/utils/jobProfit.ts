/**
 * Did we make money on that job?
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * Retainers have answered this per month card since Phase 5. Projects have
 * not. A project carried `actualCostTotal` — one merged number — and no
 * profit, no margin, and no way to tell an external invoice from the salary
 * cost of the people doing the work. So the brief's own success criterion
 * ("did we make money on that job", §1) was answerable for half the business
 * and not the other half, and the half it could not answer is the half that
 * ends: a retainer's bad month is next month's problem, a project's bad margin
 * is discovered when it is already delivered.
 *
 * ─── The formulas, from the brief §8 ────────────────────────────────────────
 *
 *   actualCost  = SUM(Cost on the project) + SUM(allocation% x monthlyCost)
 *   jobProfit   = revenue - directCost - peopleCost      overheads EXCLUDED
 *   jobMargin   = jobProfit / revenue
 *
 * Overheads are excluded on purpose and the brief says so twice. Rent and
 * software belong to the company's P&L, where salary is also counted exactly
 * once; pushing a share of them down into every job is how the same rupee ends
 * up subtracted twice and every job looks unprofitable.
 */

export type ProjectFinancials = {
  /** What the client agreed to pay. The revenue side of a project, entire. */
  quotedValue: number;
  /** What we thought it would cost, when somebody bothered to say. */
  estimatedCost: number | null;
  /** Vendor bills, ad spend, licences — money that left the company. */
  directCost: number;
  /** Allocated salary: the people, at the share of their month this had. */
  peopleCost: number;
};

export type JobProfit = {
  revenue: number;
  directCost: number;
  peopleCost: number;
  actualCost: number;
  profit: number;
  /** One decimal place. `null` when there is no revenue to be a share of. */
  marginPercent: number | null;
  estimatedCost: number | null;
  /** Actual against estimate. Positive means over. `null` with no estimate. */
  costVariance: number | null;
  costVariancePercent: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function jobProfit(f: ProjectFinancials): JobProfit {
  const revenue = f.quotedValue;
  const actualCost = round2(f.directCost + f.peopleCost);
  const profit = round2(revenue - actualCost);

  return {
    revenue,
    directCost: round2(f.directCost),
    peopleCost: round2(f.peopleCost),
    actualCost,
    profit,
    // A margin needs something to be a share OF. Returning 0 for a project
    // with no quoted value reads as "we broke even", which is a claim; null
    // reads as "there is nothing to divide by", which is the truth.
    marginPercent: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
    estimatedCost: f.estimatedCost,
    costVariance: f.estimatedCost === null ? null : round2(actualCost - f.estimatedCost),
    costVariancePercent:
      f.estimatedCost === null || f.estimatedCost === 0
        ? null
        : Math.round(((actualCost - f.estimatedCost) / f.estimatedCost) * 1000) / 10,
  };
}

/**
 * How far through the work is, by the only signal a project actually has.
 *
 * Milestones, not tasks. A milestone is a billing event somebody agreed to,
 * and it moves when the client accepts something; task counts move when
 * whoever is doing the work says so, and a project with 40 small tasks and one
 * enormous one would read as 97% done with the hard part untouched.
 *
 * Falls back to elapsed calendar time when a project has no milestones at all,
 * which is worse but not nothing — and is flagged as such by `basis`.
 */
export function percentComplete(input: {
  milestones: { status: string }[];
  startDate: Date;
  endDate: Date;
  now?: Date;
}): { percent: number; basis: 'milestones' | 'calendar' } {
  const done = input.milestones.filter((m) => m.status === 'PAID' || m.status === 'INVOICED').length;
  if (input.milestones.length > 0) {
    return { percent: Math.round((done / input.milestones.length) * 100), basis: 'milestones' };
  }

  const now = input.now ?? new Date();
  const span = input.endDate.getTime() - input.startDate.getTime();
  if (span <= 0) return { percent: 0, basis: 'calendar' };
  const elapsed = now.getTime() - input.startDate.getTime();
  return {
    percent: Math.max(0, Math.min(100, Math.round((elapsed / span) * 100))),
    basis: 'calendar',
  };
}

/**
 * Is this job going to lose money, while there is still time to do something?
 *
 * Brief §11.3 step 4: "System compares actual against estimate against percent
 * complete and raises an alert **while there is still time to act**." That last
 * clause is the whole feature. Comparing actual to estimate on its own only
 * tells you something on the last day; comparing it to how much work is
 * actually finished tells you in week two.
 *
 * The arithmetic: if a job is 25% done and has already spent 60% of its
 * estimate, its cost at this rate lands at 240% of estimate. That projection —
 * not today's spend — is what is worth an alert.
 *
 * Below 10% complete nothing is judged. Early spend is lumpy (a licence, a
 * deposit, the whole shoot up front) and an alert on day three trains people
 * to ignore alerts.
 */
export const MIN_COMPLETE_TO_JUDGE = 10;

export type CostRisk = {
  /** Where the cost lands if it carries on at this rate. Null when too early. */
  projectedCost: number | null;
  /** Projected cost against the quoted value, as profit. Null when too early. */
  projectedProfit: number | null;
  level: 'OK' | 'WATCH' | 'OVER' | 'LOSS';
  reason: string | null;
};

export function costRisk(input: {
  profit: JobProfit;
  percentComplete: number;
}): CostRisk {
  const { profit: p, percentComplete: pct } = input;

  if (pct < MIN_COMPLETE_TO_JUDGE) {
    return {
      projectedCost: null,
      projectedProfit: null,
      level: 'OK',
      reason: null,
    };
  }

  const projectedCost = round2(p.actualCost / (pct / 100));
  const projectedProfit = round2(p.revenue - projectedCost);

  // Order matters: losing money is worse than merely overspending, and a job
  // can be both. The worst true statement is the one worth showing.
  if (projectedProfit < 0) {
    return {
      projectedCost,
      projectedProfit,
      level: 'LOSS',
      // The clause stops at the FACTS. `level` already carries the verdict and
      // every caller appends the projected figure, so a trailing "at this rate
      // it finishes below cost" here produced "at this rate" twice in one
      // sentence on the project screen.
      reason: `${pct}% done with ${Math.round((p.actualCost / p.revenue) * 100)}% of the quote already spent.`,
    };
  }

  if (p.estimatedCost !== null && p.estimatedCost > 0) {
    const overBy = Math.round(((projectedCost - p.estimatedCost) / p.estimatedCost) * 100);
    if (overBy >= 25) {
      return {
        projectedCost,
        projectedProfit,
        level: 'OVER',
        reason: `${pct}% done and on course for ${overBy}% over the cost estimate.`,
      };
    }
    if (overBy >= 10) {
      return {
        projectedCost,
        projectedProfit,
        level: 'WATCH',
        reason: `${pct}% done and tracking ${overBy}% above the cost estimate.`,
      };
    }
  }

  // No estimate to judge against, so fall back to the margin itself. A job
  // heading for single-digit margin is worth a look even when nobody wrote
  // down what it was supposed to cost.
  if (p.revenue > 0 && projectedProfit / p.revenue < 0.1) {
    return {
      projectedCost,
      projectedProfit,
      level: 'WATCH',
      reason: `${pct}% done and heading for a margin under 10%.`,
    };
  }

  return { projectedCost, projectedProfit, level: 'OK', reason: null };
}
