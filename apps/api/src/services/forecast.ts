import { prisma } from '../lib/prisma.js';
import { stageProbabilities, STAGE_PROBABILITY_SELECT } from '../utils/stageProbability.js';

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

  const now = new Date();
  const months = [0, 1, 2].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const name = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    return { key, name, year, month, offset };
  });

  // 1. Fixed Team Payroll Outflows
  const teamMembers = await prisma.user.findMany({
    where: { organizationId: orgId, active: true },
    select: { id: true, name: true, designation: true, dept: true, monthlyCost: true },
  });
  const peoplePayroll = teamMembers.reduce((acc, m) => acc + Number(m.monthlyCost || 0), 0);
  // Nobody can be paid ₹0. A person with no monthly cost entered is a person
  // this payroll leaves out — said, rather than silently counted as free.
  const unpaidPeople = teamMembers.filter((m) => !(Number(m.monthlyCost) > 0)).length;

  // 1b. Company costs: overheads (rent, software…) and any salaries entered
  // as one company cost rather than per person.
  const company = await monthlyCompanyCosts(orgId, now);
  const overheads = company.overheads;
  /*
   * Salaries are counted once. Per person when entered there — the Salaries
   * company cost is then the same money and stays out; otherwise the Salaries
   * company cost, as one total.
   */
  const payrollBasis: 'people' | 'companyCost' | 'none' =
    peoplePayroll > 0 ? 'people' : company.salaries.monthly > 0 ? 'companyCost' : 'none';
  const monthlyPayroll = payrollBasis === 'people' ? peoplePayroll : company.salaries.monthly;

  // 2. Active Retainers (Recurring Base Inflows)
  const retainers = await prisma.retainer.findMany({
    where: { organizationId: orgId, status: 'ACTIVE' },
    include: { company: { select: { id: true, name: true } } },
  });

  // 3. Active Pipeline Proposals (Weighted Inflows)
  const proposals = await prisma.proposal.findMany({
    where: { organizationId: orgId, deletedAt: null, outcome: null },
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
  const firstMonthStart = new Date(months[0].year, months[0].month - 1, 1);

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
      const monthStart = new Date(m.year, m.month - 1, 1);
      const monthEnd = new Date(m.year, m.month, 0, 23, 59, 59);
      return proj.startDate <= monthEnd && proj.endDate >= monthStart;
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
    // A. Retainers Inflow for month m
    const activeForMonth = retainers.filter((r) => {
      if (!r.renewalDate) return true;
      const endKey = `${r.renewalDate.getFullYear()}-${String(r.renewalDate.getMonth() + 1).padStart(2, '0')}`;
      return endKey >= m.key;
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

    // D. Outflows: Fixed Payroll + Estimated Vendor & Direct Costs.
    // ~15-20% direct project/vendor spend. Assumed-won money is costed at
    // the project rate, because a deal that closes brings its direct spend
    // with it and a "what if" that counts the income without the cost is a
    // sales pitch rather than a forecast.
    const directVendorCosts = Math.round(
      retainersInflow * 0.15 + (projectsInflow + assumedWonInflow) * 0.2,
    );
    // Overheads were never here: payroll and a vendor estimate were the whole
    // of "cash out", so rent and software were spent nowhere on this screen.
    const totalOutflows = monthlyPayroll + overheads.monthly + directVendorCosts;

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
        overheads: overheads.monthly,
        vendorAndDirect: directVendorCosts,
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
  if (payrollBasis === 'none' && teamMembers.length > 0) {
    warnings.push(
      "No one's monthly cost is entered, so payroll is ₹0 and every month here shows more cash than there is. Enter each person's monthly cost on Team.",
    );
  } else if (payrollBasis === 'companyCost') {
    warnings.push(
      "Payroll is the Salaries company cost, as one total. Enter each person's monthly cost on Team so it can be shared out to clients.",
    );
  } else if (unpaidPeople > 0) {
    warnings.push(
      `${unpaidPeople} of ${teamMembers.length} people have no monthly cost entered, so payroll leaves them out. Enter it on Team.`,
    );
  }
  if (payrollBasis === 'people' && company.salaries.monthly > 0) {
    warnings.push(
      'Salaries are entered per person and as a company cost too. This uses the per-person figures and leaves the Salaries cost out, so they are not counted twice.',
    );
  }
  if (overheads.basis === 'none') {
    warnings.push(
      'No company overheads are entered (rent, software, utilities…), so none are taken off. Add them as company costs in Money — mark the monthly ones Recurring.',
    );
  }

  return {
    summary: {
      currentMrr: retainers.reduce((acc, r) => acc + Number(r.monthlyValue), 0),
      monthlyPayroll,
      /** Where payroll came from: each person's monthly cost, the Salaries company cost, or nothing entered. */
      payrollBasis,
      monthlyOverheads: overheads.monthly,
      /** Where the overheads figure came from: recurring costs, a 3-month average, or nothing entered. */
      overheadsBasis: overheads.basis,
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

/** A company cost that is salaries, by its category — "Salaries", "Salary advance"… */
export const isSalaryCost = (category: string) => /salar/i.test(category);

type Monthly = { monthly: number; basis: 'recurring' | 'average' | 'none' };

/**
 * A month of company costs, going forward, split into overheads and salaries.
 *
 * For each: the recurring company costs, when any are set up — they are what
 * the next months will actually be charged (the 1st-of-the-month job clones
 * them). Otherwise the average of the last three complete months, the best
 * guess there is from one-off entries. Capital spend is not an overhead and is
 * left out; so are client costs, which the vendor estimate stands for.
 */
export async function monthlyCompanyCosts(orgId: string, now: Date): Promise<{ overheads: Monthly; salaries: Monthly }> {
  const from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 1);
  const [recurring, recent] = await Promise.all([
    prisma.cost.findMany({
      where: { organizationId: orgId, type: 'COMPANY', recurring: true, recurringSourceId: null, deletedAt: null },
      select: { category: true, amount: true },
    }),
    prisma.cost.findMany({
      where: { organizationId: orgId, type: 'COMPANY', deletedAt: null, incurredAt: { gte: from, lt: to } },
      select: { category: true, amount: true },
    }),
  ]);
  const sum = (rows: { amount: unknown }[] | undefined) => Math.round((rows ?? []).reduce((acc, r) => acc + Number(r.amount ?? 0), 0));
  const of = (salary: boolean): Monthly => {
    const mine = (rows: { category: string; amount: unknown }[] | undefined) => (rows ?? []).filter((r) => isSalaryCost(r.category) === salary);
    const fixed = sum(mine(recurring));
    if (fixed > 0) return { monthly: fixed, basis: 'recurring' };
    const average = Math.round(sum(mine(recent)) / 3);
    return average > 0 ? { monthly: average, basis: 'average' } : { monthly: 0, basis: 'none' };
  };
  return { overheads: of(false), salaries: of(true) };
}
