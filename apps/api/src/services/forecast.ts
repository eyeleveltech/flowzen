import { prisma } from '../lib/prisma.js';
import { stageProbabilities, STAGE_PROBABILITY_SELECT } from '../utils/stageProbability.js';
import { addMonths, moneyClock, monthBounds, monthOfDay, orgMonth } from '../utils/moneyDates.js';
import { looksLikeSalary } from '../utils/salaryCost.js';
import { ACTIVE_DEAL_WHERE } from './activeDeal.js';

/*
 * The weights this screen used to keep for itself — 10/30/60/80/90 — were a
 * third copy, and disagreed with both the Pipeline board (20/40/60/80/95) and
 * §14 (30/60/85/90). Two screens weighting the same deal differently is worse
 * than either being wrong: the board and the forecast could not be reconciled
 * by anyone looking at them side by side. They now read the org's own setting
 * through utils/stageProbability.ts.
 */

/**
 * The 3-month forward cash view — what GET /forecast/3-month answers, and
 * what Zen's getForecast reads, so the screen and the assistant can never
 * give two different forecasts.
 *
 * `assumeWonId` is §10's "what if per deal": one open proposal treated as
 * already closed — full value, every month — instead of weighted.
 */
export async function composeForecast(orgId: string, assumeWonId: string | null = null) {
  // The same setting the Pipeline board weights against (§14).
  const orgForWeights = await prisma.organization.findUnique({
    where: { id: orgId },
    select: STAGE_PROBABILITY_SELECT,
  });
  const stageWeights = stageProbabilities(orgForWeights);

  // The studio's months, not the server's (Money Plan 2, decision 8).
  const thisMonth = orgMonth((await moneyClock(orgId)).timezone);
  const months = [0, 1, 2].map((offset) => {
    const key = addMonths(thisMonth, offset);
    const [year, month] = key.split('-').map(Number);
    const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { key, name, year, month, offset };
  });

  // 1. Salaries — each active person's monthly cost, and only that (decision 3).
  const teamMembers = await prisma.user.findMany({
    where: { organizationId: orgId, active: true },
    select: { id: true, name: true, designation: true, dept: true, monthlyCost: true },
  });
  const monthlyPayroll = Math.round(teamMembers.reduce((acc, m) => acc + Number(m.monthlyCost || 0), 0));
  // Nobody can be paid ₹0. A person with no monthly cost entered is a person
  // this payroll leaves out — said, rather than silently counted as free.
  const unpaidPeople = teamMembers.filter((m) => !(Number(m.monthlyCost) > 0)).length;

  // 1b. The costs we know are coming: recurring ones, and ones owed but not paid.
  const costsOut = await forecastCosts(orgId, months.map((m) => m.key));

  // 2. Active Retainers (Recurring Base Inflows)
  const retainers = await prisma.retainer.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    include: { company: { select: { id: true, name: true } } },
  });

  // 3. Active Pipeline Proposals (Weighted Inflows) — the shared active-deal rule (QA19, F01).
  const proposals = await prisma.proposal.findMany({
    where: { organizationId: orgId, ...ACTIVE_DEAL_WHERE },
    include: {
      company: { select: { id: true, name: true } },
      versions: { orderBy: { n: 'desc' }, take: 1 },
    },
  });

  // 4. Live Projects (Expected Milestone Inflows & Vendor Costs)
  const projects = await prisma.project.findMany({
    // `deletedAt` was not filtered, so a project someone had thrown away
    // went on forecasting revenue from the trash.
    where: { organizationId: orgId, status: 'LIVE', deletedAt: null },
    include: {
      company: { select: { id: true, name: true } },
      milestones: { select: { amount: true, status: true } },
    },
  });

  // The "what if per deal" picker — every open proposal with a value, so
  // the frontend can offer "what if this one closes" without guessing
  // which ones are worth asking about.
  const deals = proposals
    .map((p) => ({ id: p.id, companyId: p.company.id, companyName: p.company.name, stage: p.stage, value: p.versions[0]?.value ? Number(p.versions[0].value) : 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  /**
   * What each project still expects to bill, and when.
   *
   * The old sum divided each project's value by the NUMBER OF PROJECTS and
   * then charged that same figure to all three months. With one live
   * project that counted its full value three times; with six it counted
   * half the book. Project count is not a unit of time, and nothing about
   * it said which month the money arrives.
   *
   * What is actually outstanding is the milestones not yet paid — the
   * schedule this business already keeps — spread across the months of the
   * project's own delivery window that fall inside the horizon.
   */
  const projectsByMonth = new Map<string, number>();
  const firstMonthStart = monthBounds(months[0].key).start;

  for (const proj of projects) {
    // Milestones are the truth when a project has them; `quotedValue` is
    // the fallback for one that predates the schedule.
    const outstanding = proj.milestones.length
      ? proj.milestones
          .filter((ms) => ms.status !== 'PAID')
          .reduce((acc, ms) => acc + Number(ms.amount), 0)
      : Number(proj.quotedValue || 0);

    if (outstanding <= 0) continue;

    let window = months.filter((m) => {
      const { start, end } = monthBounds(m.key);
      return proj.startDate < end && proj.endDate >= start;
    });

    // A project whose end date has already passed is not forecast revenue
    // spread over a window — it is money owed now.
    if (window.length === 0) {
      if (proj.endDate < firstMonthStart) window = [months[0]];
      else continue; // starts after the horizon; not this quarter's money
    }

    // The remainder lands on the last month so the parts sum to the whole.
    const perMonth = Math.round(outstanding / window.length);
    window.forEach((m, i) => {
      const share = i === window.length - 1
        ? outstanding - perMonth * (window.length - 1)
        : perMonth;
      projectsByMonth.set(m.key, (projectsByMonth.get(m.key) ?? 0) + Math.round(share));
    });
  }

  const forecastMonths = months.map((m, idx) => {
    // A. Retainers Inflow for month m — from the month a retainer starts
    // (one signed for next quarter is not this month's money), to its end.
    const activeForMonth = retainers.filter((r) => {
      if (monthOfDay(r.startDate) > m.key) return false;
      if (!r.renewalDate) return true;
      return monthOfDay(r.renewalDate) >= m.key;
    });
    const retainersInflow = activeForMonth.reduce((acc, r) => acc + Number(r.monthlyValue), 0);

    // B. Pipeline Weighted Inflow
    // Immediate month gets higher weight on later stages (Verbal Yes / Proforma / Negotiation)
    // Later months get more input from earlier stages
    let pipelineInflow = 0;
    // The one deal the caller asked to see as though it had already
    // closed. Kept apart from the weighted total because it is no longer
    // being weighted — see the branch below.
    let assumedWonInflow = 0;

    proposals.forEach((p) => {
      const rawVal = p.versions[0]?.value ? Number(p.versions[0].value) : 0;
      const baseWeight = p.probabilityOverride !== null && p.probabilityOverride !== undefined
        ? p.probabilityOverride / 100
        : (stageWeights[p.stage] ?? 0) / 100;

      /*
       * A PROJECT deal is one sum of money, arriving once — counted in its
       * expected month, and with no expected month on a deal, in the first.
       * It used to be added to all three months, so a ₹5L project forecast
       * ₹15L (decision 9). A retainer deal is a monthly fee, so it stays in
       * every month.
       */
      if (p.kind === 'PROJECT') {
        if (idx !== 0) return;
        if (assumeWonId && p.id === assumeWonId) {
          assumedWonInflow += rawVal;
          return;
        }
        const weightedOnce = Math.round(rawVal * baseWeight);
        if (weightedOnce > 0) pipelineInflow += weightedOnce;
        return;
      }

      // Apply distance decay for later months
      let effectiveWeight = baseWeight;
      if (idx === 0) {
        // Current month: High weight on near-closing stages
        effectiveWeight = ['VERBAL_YES', 'PROFORMA_ISSUED'].includes(p.stage) ? baseWeight : baseWeight * 0.5;
      } else if (idx === 1) {
        // Next month: In Negotiation / Proposal sent convert
        effectiveWeight = ['IN_NEGOTIATION', 'PROPOSAL_SENT'].includes(p.stage) ? baseWeight : baseWeight * 0.7;
      } else {
        // Month 3: Talking / Proposal sent convert
        effectiveWeight = baseWeight * 0.8;
      }
      // §10 "what if per deal": the picked proposal is not weighted at
      // all, it is treated as SIGNED — which is the question being asked.
      // It has to land in the committed column rather than the pipeline
      // one, because the scenario panel reads the net cash flow figure and
      // that figure no longer counts pipeline; left where it was, picking
      // a deal would have moved the number by nothing.
      if (assumeWonId && p.id === assumeWonId) {
        assumedWonInflow += rawVal;
        return;
      }

      const weightedVal = Math.round(rawVal * effectiveWeight);
      if (weightedVal > 0) pipelineInflow += weightedVal;
    });

    // C. Projects Milestone Inflow — what the schedule above says lands here.
    const projectsInflow = projectsByMonth.get(m.key) ?? 0;

    // ── Money that is committed, and money we are hoping for ───────────
    //
    // These three were added together and the sum WAS the forecast. Two
    // things are wrong with that, and the second is the one that matters.
    //
    // The brief (§8) reports committed revenue "split by Retainer and One
    // time, never summed into a single figure", and this screen summed
    // them. Read as REVENUE that is wrong — a monthly recurring value and
    // a whole contract are not the same kind of number. Read as CASH it is
    // fine: a retainer's value and a milestone falling due in the same
    // month are both simply money arriving that month, and a cash-flow
    // screen exists to add those up. So the two lines stay split, and what
    // is summed is labelled cash rather than revenue.
    //
    // The real defect is the third term. Weighted pipeline is not money —
    // it is a probability multiplied by a number nobody has signed. Folded
    // into the same total, a signed retainer and a 10%-likely first
    // conversation became indistinguishable, and SURPLUS / DEFICIT was
    // then decided from the result. A month could report a surplus that
    // existed only if deals landed, which is the one thing a cash-flow
    // warning must never do.
    //
    // And the outflow side never included pipeline: `directVendorCosts`
    // below is computed from retainers and projects alone. So the old
    // margin divided real costs into speculative income, flattering itself
    // from both ends at once.
    const committedInflow = retainersInflow + projectsInflow + assumedWonInflow;
    const totalInflows = committedInflow + pipelineInflow;

    /*
     * D. Outflows — money we know is going out (decision 9):
     *   · salaries: every active person's monthly cost
     *   · recurring costs: the ones set up to repeat (rent, software, a
     *     retainer's freelancer…), confirmed, from the month they start
     *   · committed, not paid: costs entered as owed, in the month they fall
     *     due (any already past due, in the first month)
     * It used to guess 15–20% of income as "vendor and direct" — a number
     * that moved with sales, not with anything we owe. Salary-like costs are
     * left out of both lists; salaries are the first line.
     */
    const recurringOut = costsOut.recurring.get(m.key) ?? 0;
    const committedOut = costsOut.committed.get(m.key) ?? 0;
    const totalOutflows = monthlyPayroll + recurringOut + committedOut;

    // The verdict is taken on committed money alone. It is the
    // conservative read and the only one that is a forecast of CASH: when
    // this says DEFICIT, the month is short unless something closes.
    const netCashFlow = committedInflow - totalOutflows;
    // The same month if every weighted deal lands. Reported beside the
    // verdict, never as it.
    const netCashFlowWithPipeline = totalInflows - totalOutflows;
    // Not a margin. This screen has no cost of sale, only cash out — it is
    // the share of committed cash still there after payroll and vendors,
    // and calling it "gross margin" invited it to be read as profit.
    const cashKeptPercent =
      committedInflow > 0 ? Math.round((netCashFlow / committedInflow) * 100) : 0;

    return {
      monthKey: m.key,
      monthName: m.name,
      inflows: {
        retainers: retainersInflow,
        projects: projectsInflow,
        assumedWon: assumedWonInflow,
        committed: committedInflow,
        pipelineWeighted: pipelineInflow,
        total: totalInflows,
      },
      outflows: {
        payroll: monthlyPayroll,
        recurring: recurringOut,
        committed: committedOut,
        total: totalOutflows,
      },
      netCashFlow,
      netCashFlowWithPipeline,
      cashKeptPercent,
      status: netCashFlow >= 0 ? 'SURPLUS' : 'DEFICIT',
      activeRetainersCount: activeForMonth.length,
      dealsInRadarCount: proposals.length,
    };
  });

  /*
   * What this forecast cannot see, said above it. A surplus worked out with
   * ₹0 of salaries is not a surplus, and the screen used to report one with
   * nothing to say why.
   */
  const warnings: string[] = [];
  if (teamMembers.length > 0 && monthlyPayroll === 0) {
    warnings.push(
      "No one's monthly cost is entered, so payroll is ₹0 and every month here shows more cash than there is. Enter each person's monthly cost on Team.",
    );
  } else if (unpaidPeople > 0) {
    warnings.push(
      `${unpaidPeople} of ${teamMembers.length} people have no monthly cost entered, so payroll leaves them out. Enter it on Team.`,
    );
  }
  if (costsOut.salaryLike > 0) {
    warnings.push(
      `${costsOut.salaryLike} recurring or owed ${costsOut.salaryLike === 1 ? 'cost looks' : 'costs look'} like salaries and ${costsOut.salaryLike === 1 ? 'is' : 'are'} left out — payroll already counts salaries, from Team.`,
    );
  }
  if ((costsOut.recurring.get(months[0].key) ?? 0) === 0) {
    warnings.push(
      'No recurring costs are set up (rent, software, utilities…), so none are taken off. Add them as costs in Money and mark the monthly ones Recurring.',
    );
  }

  return {
    summary: {
      currentMrr: retainers.reduce((acc, r) => acc + Number(r.monthlyValue), 0),
      /** Every active person's monthly cost. */
      monthlyPayroll,
      /** This month's recurring costs, salary-like ones left out. */
      monthlyRecurringCosts: costsOut.recurring.get(months[0].key) ?? 0,
      peopleWithoutCost: unpaidPeople,
      activeRetainersCount: retainers.length,
      activeDealsCount: proposals.length,
    },
    warnings,
    forecast: forecastMonths,
    deals,
    assumeWon: assumeWonId,
  };
}

export type Forecast = Awaited<ReturnType<typeof composeForecast>>;

/**
 * The costs the forecast takes off, month by month (decision 9).
 *
 *   · recurring: each confirmed recurring cost — the row it repeats from, not
 *     its monthly copies — in every month from the one it was entered for
 *   · committed: costs entered as owed and not yet paid (not recurring ones,
 *     which the line above already counts), in the month they fall in; any
 *     already past, in the first month, as they are owed now
 *
 * Salary-like rows are left out and counted, so the screen can say so.
 */
export async function forecastCosts(
  orgId: string,
  monthKeys: string[],
): Promise<{ recurring: Map<string, number>; committed: Map<string, number>; salaryLike: number }> {
  const [templates, owed] = await Promise.all([
    prisma.cost.findMany({
      where: { organizationId: orgId, recurring: true, recurringSourceId: null, confirmed: true, deletedAt: null },
      select: { category: true, vendor: true, amount: true, incurredAt: true },
    }),
    prisma.cost.findMany({
      where: { organizationId: orgId, committedNotPaid: true, recurring: false, recurringSourceId: null, deletedAt: null },
      select: { category: true, vendor: true, amount: true, incurredAt: true },
    }),
  ]);
  const salary = (c: { category: string; vendor: string | null }) => looksLikeSalary(c.category) || looksLikeSalary(c.vendor);
  const recurring = new Map<string, number>();
  const committed = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, amount: unknown) =>
    map.set(key, Math.round((map.get(key) ?? 0) + Number(amount ?? 0)));

  let salaryLike = 0;
  for (const c of templates ?? []) {
    if (salary(c)) {
      salaryLike++;
      continue;
    }
    for (const key of monthKeys) if (monthOfDay(c.incurredAt) <= key) add(recurring, key, c.amount);
  }
  for (const c of owed ?? []) {
    if (salary(c)) {
      salaryLike++;
      continue;
    }
    const due = monthOfDay(c.incurredAt);
    if (due < monthKeys[0]) add(committed, monthKeys[0], c.amount);
    else if (monthKeys.includes(due)) add(committed, due, c.amount);
  }
  return { recurring, committed, salaryLike };
}
