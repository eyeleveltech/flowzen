import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, type AuthRequest, hasPermission, requirePermission } from '../middleware/auth.js';
import { ProposalStage } from '@prisma/client';

export const forecastRouter = Router();

forecastRouter.use(authenticate);

const STAGE_WEIGHTS: Record<ProposalStage, number> = {
  TALKING: 0.1,
  PROPOSAL_SENT: 0.3,
  IN_NEGOTIATION: 0.6,
  PROFORMA_ISSUED: 0.8,
  VERBAL_YES: 0.9,
  WON: 1.0,
  LOST: 0.0,
  EXPIRED: 0.0,
};

/**
 * GET /api/forecast/3-month — 3-Month Forward Cash Flow Radar
 */
forecastRouter.get(
  '/3-month',
  // `reports.read` — the switch whose own label reads "Reports and brief" — was
  // granted to Management and then enforced on nothing, while this route asked
  // for `money.figures` instead. That let Accounts, who legitimately needs
  // figures, into the management reports as well. The narrower switch is the
  // one that was meant to guard this.
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      // §10 Forecast: "what if per deal" — pass the id of one open proposal
      // to see the forecast as though it had already closed (full value,
      // every month, instead of its stage-weighted contribution).
      const assumeWonId = typeof req.query.assumeWon === 'string' ? req.query.assumeWon : null;

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
      const monthlyPayroll = teamMembers.reduce((acc, m) => acc + Number(m.monthlyCost || 0), 0);

      // 2. Active Retainers (Recurring Base Inflows)
      const retainers = await prisma.retainer.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        include: { company: { select: { id: true, name: true } } },
      });

      // 3. Active Pipeline Proposals (Weighted Inflows)
      const proposals = await prisma.proposal.findMany({
        where: { organizationId: orgId, outcome: null },
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
        .map((p) => ({ id: p.id, companyName: p.company.name, stage: p.stage, value: p.versions[0]?.value ? Number(p.versions[0].value) : 0 }))
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
            : (STAGE_WEIGHTS[p.stage] ?? 0.2);

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
        const totalOutflows = monthlyPayroll + directVendorCosts;

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

      res.json({
        success: true,
        summary: {
          currentMrr: retainers.reduce((acc, r) => acc + Number(r.monthlyValue), 0),
          monthlyPayroll,
          activeRetainersCount: retainers.length,
          activeDealsCount: proposals.length,
        },
        forecast: forecastMonths,
        deals,
        assumeWon: assumeWonId,
      });
    } catch (e) {
      next(e);
    }
  },
);
