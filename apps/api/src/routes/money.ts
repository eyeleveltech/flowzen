import { Router, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, type AuthRequest } from '../middleware/auth.js';
import {
  asStoredDay,
  dayKey,
  financialYearBounds,
  isOverdueOn,
  moneyClock,
  monthBounds,
  orgMonth,
  orgToday,
} from '../utils/moneyDates.js';
import { sumPaise, toPaise } from '../utils/paise.js';
import { invoiceState } from '../utils/invoiceState.js';
import { looksLikeSalary } from '../utils/salaryCost.js';

/**
 * The money screen's figures, worked out on the server (Money Plan 2).
 *
 * `/money` used to fetch the invoice and cost lists and add them up in the
 * browser — and both lists stop at 200 rows, so past 200 every tile was
 * quietly wrong. Totals now come from here, over every row, for a period.
 *
 * GST, said every time: invoice and payment amounts INCLUDE GST; fees,
 * proformas and profit revenue are BEFORE GST. The two are never added
 * together.
 */
export const moneyRouter = Router();
moneyRouter.use(authenticate);

const rupees = (paise: number) => paise / 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Kind = 'retainers' | 'projects' | 'other';
const kindOf = (inv: { workType: string | null; projectId: string | null }): Kind =>
  inv.workType === 'MONTH_CARD' ? 'retainers' : inv.workType === 'PROJECT' || inv.projectId ? 'projects' : 'other';
const emptySplit = () => ({ retainers: 0, projects: 0, other: 0 });

/**
 * GET /api/money/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Billed and collected are for the period (both days included). Outstanding
 * and overdue are a balance, not a flow: what is owed today, on every invoice,
 * whatever period is picked — an old unpaid invoice must not vanish from
 * "who owes us" because the picker moved.
 *
 * Without dates: this financial year.
 */
moneyRouter.get('/summary', requirePermission('money.figures'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { timezone, fyStartMonth } = await moneyClock(orgId);
    const today = orgToday(timezone);

    const fy = financialYearBounds(today, fyStartMonth);
    const from = typeof req.query.from === 'string' && DAY.test(req.query.from) ? req.query.from : dayKey(fy.start);
    const to =
      typeof req.query.to === 'string' && DAY.test(req.query.to)
        ? req.query.to
        : dayKey(new Date(fy.end.getTime() - 86400000));
    if (from > to) {
      res.status(400).json({ success: false, error: 'The period starts after it ends.' });
      return;
    }
    const start = asStoredDay(from);
    const endExclusive = new Date(asStoredDay(to).getTime() + 86400000);

    const [raised, received, open] = await Promise.all([
      // Billed: everything raised in the period except what was cancelled.
      prisma.invoice.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, raisedAt: { gte: start, lt: endExclusive } },
        select: { amount: true, gstAmount: true, workType: true, projectId: true },
      }),
      // Collected: money that arrived in the period, whichever invoice it settled.
      prisma.payment.findMany({
        where: { invoice: { organizationId: orgId }, receivedAt: { gte: start, lt: endExclusive } },
        select: { amount: true, invoice: { select: { workType: true, projectId: true } } },
      }),
      // Outstanding: every invoice still open, today.
      prisma.invoice.findMany({
        where: { organizationId: orgId, status: { in: ['RAISED', 'OVERDUE'] } },
        select: { amount: true, dueAt: true, status: true, workType: true, projectId: true, payments: { select: { amount: true } } },
      }),
    ]);

    const billed = { amount: 0, count: raised.length, gst: 0, gstUnknownCount: 0, ...emptySplit() };
    for (const inv of raised) {
      const p = toPaise(inv.amount);
      billed.amount += p;
      billed[kindOf(inv)] += p;
      if (inv.gstAmount === null) billed.gstUnknownCount++;
      else billed.gst += toPaise(inv.gstAmount);
    }

    const collected = { amount: 0, count: received.length, ...emptySplit() };
    for (const pay of received) {
      const p = toPaise(pay.amount);
      collected.amount += p;
      collected[kindOf(pay.invoice)] += p;
    }

    const outstanding = { amount: 0, count: 0, ...emptySplit() };
    const overdue = { amount: 0, count: 0 };
    for (const inv of open) {
      const balance = Math.max(0, toPaise(inv.amount) - sumPaise(inv.payments));
      if (balance === 0) continue;
      outstanding.amount += balance;
      outstanding.count++;
      outstanding[kindOf(inv)] += balance;
      if (isOverdueOn(inv, today)) {
        overdue.amount += balance;
        overdue.count++;
      }
    }

    const inRupees = <T extends Record<string, number>>(o: T, keep: string[] = ['count', 'gstUnknownCount']) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, keep.includes(k) ? v : rupees(v)])) as T;

    res.json({
      success: true,
      period: { from, to },
      today,
      /** Invoice and payment amounts: GST included. */
      includesGst: true,
      billed: inRupees(billed),
      collected: inRupees(collected),
      outstanding: inRupees(outstanding),
      overdue: inRupees(overdue),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/money/profit?month=YYYY-MM — company profit for one month.
 *
 *   retainer fees + project revenue − direct costs − people cost − overheads
 *
 *   · Retainer fees: the month cards' fees (before GST).
 *   · Project revenue: project invoices raised in the month, before GST — the
 *     milestone's amount when the invoice settles one, else the invoice's own
 *     pre-tax figure. Revenue is counted when it is invoiced, as Tally does.
 *   · Direct costs: costs on the month's retainer cards, and other client
 *     costs dated in the month.
 *   · People cost: the whole payroll — every active person's monthly cost.
 *     Time nobody put against a client is still paid for.
 *   · Overheads: company costs dated in the month, except any that look like
 *     salaries; payroll already counts those (decision 3).
 *
 * Was worked out in the browser, from retainers only, and showed ₹0 when a
 * load failed. A failure is an error now, and the screen says so.
 */
moneyRouter.get('/profit', requirePermission('money.figures'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { timezone } = await moneyClock(orgId);
    const thisMonth = orgMonth(timezone);
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : thisMonth;
    const { start, end } = monthBounds(month);

    const [cards, projectInvoices, otherDirect, overheadRows, people] = await Promise.all([
      prisma.monthCard.findMany({
        where: { month, retainer: { organizationId: orgId } },
        select: { revenue: true, costs: { where: { deletedAt: null }, select: { amount: true } } },
      }),
      prisma.invoice.findMany({
        where: {
          organizationId: orgId,
          status: { not: 'CANCELLED' },
          raisedAt: { gte: start, lt: end },
          OR: [{ workType: 'PROJECT' }, { projectId: { not: null } }],
        },
        select: { amount: true, gstAmount: true, subtotal: true, milestone: { select: { amount: true } } },
      }),
      prisma.cost.findMany({
        where: { organizationId: orgId, type: 'DIRECT', monthCardId: null, deletedAt: null, incurredAt: { gte: start, lt: end } },
        select: { amount: true, projectId: true },
      }),
      prisma.cost.findMany({
        where: { organizationId: orgId, type: 'COMPANY', deletedAt: null, incurredAt: { gte: start, lt: end } },
        select: { amount: true, category: true, vendor: true, confirmed: true },
      }),
      prisma.user.findMany({ where: { organizationId: orgId, active: true }, select: { monthlyCost: true } }),
    ]);

    const warnings: string[] = [];

    const retainerFees = cards.reduce((s, c) => s + toPaise(c.revenue), 0);
    let projectRevenue = 0;
    let projectGuessed = 0;
    for (const inv of projectInvoices) {
      if (inv.milestone) projectRevenue += toPaise(inv.milestone.amount);
      else if (inv.subtotal !== null) projectRevenue += toPaise(inv.subtotal);
      else if (inv.gstAmount !== null) projectRevenue += toPaise(inv.amount) - toPaise(inv.gstAmount);
      else {
        // No way to take the GST out: counted whole, and said.
        projectRevenue += toPaise(inv.amount);
        projectGuessed++;
      }
    }
    if (projectGuessed > 0) {
      warnings.push(
        `${projectGuessed} project ${projectGuessed === 1 ? 'invoice has' : 'invoices have'} no GST recorded, so ${projectGuessed === 1 ? 'it is' : 'they are'} counted at the full amount. Edit the invoice to add its GST.`,
      );
    }

    const retainerDirect = cards.reduce((s, c) => s + sumPaise(c.costs), 0);
    const projectDirect = sumPaise(otherDirect.filter((c) => c.projectId));
    const otherDirectTotal = sumPaise(otherDirect.filter((c) => !c.projectId));

    const payroll = people.reduce((s, u) => s + toPaise(u.monthlyCost), 0);
    const withoutCost = people.filter((u) => toPaise(u.monthlyCost) <= 0).length;
    if (people.length > 0 && withoutCost === people.length) {
      warnings.push("No one's monthly cost is entered, so people cost is ₹0 and profit is too high. Enter each person's monthly cost on Team.");
    } else if (withoutCost > 0) {
      warnings.push(`${withoutCost} of ${people.length} people have no monthly cost entered, so they cost nothing here. Enter it on Team.`);
    }
    if (month !== thisMonth) warnings.push("People cost uses today's monthly costs; salary history comes later.");

    const salaryLike = overheadRows.filter((c) => looksLikeSalary(c.category) || looksLikeSalary(c.vendor));
    const overheads = overheadRows.filter((c) => !salaryLike.includes(c));
    if (salaryLike.length > 0) {
      warnings.push(
        `${salaryLike.length} company ${salaryLike.length === 1 ? 'cost looks' : 'costs look'} like salaries (${rupeesText(sumPaise(salaryLike))}) and ${salaryLike.length === 1 ? 'is' : 'are'} left out — people cost already counts salaries.`,
      );
    }
    const drafts = overheads.filter((c) => !c.confirmed).length;

    const revenue = retainerFees + projectRevenue;
    const direct = retainerDirect + projectDirect + otherDirectTotal;
    const overheadTotal = sumPaise(overheads);
    const profit = revenue - direct - payroll - overheadTotal;

    res.json({
      success: true,
      month,
      /** Revenue is before GST. Costs are what left the account. */
      revenue: { retainers: rupees(retainerFees), projects: rupees(projectRevenue), total: rupees(revenue), includesGst: false },
      directCost: { retainers: rupees(retainerDirect), projects: rupees(projectDirect), other: rupees(otherDirectTotal), total: rupees(direct) },
      peopleCost: { total: rupees(payroll), people: people.length, withoutCost },
      overheads: {
        total: rupees(overheadTotal),
        count: overheads.length,
        drafts,
        salaryLikeLeftOut: { count: salaryLike.length, amount: rupees(sumPaise(salaryLike)) },
      },
      profit: rupees(profit),
      marginPercent: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
      warnings,
    });
  } catch (e) {
    next(e);
  }
});

const rupeesText = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

/**
 * GET /api/money/milestones — project milestones to bill, for Accounts.
 *
 * Milestone billing lived only on the project page, behind `work.all`, which
 * Accounts does not hold — so the person who raises invoices could not bill a
 * project (decision 11). This lists, on live and delivered projects that are
 * not sample work:
 *
 *   · the next milestone not yet billed on each project (raise its proforma),
 *   · every milestone with a proforma out (record its invoice),
 *   · every milestone invoiced and not yet paid (record the payment).
 */
moneyRouter.get('/milestones', requirePermission('money.figures'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { timezone } = await moneyClock(orgId);
    const today = orgToday(timezone);

    const milestones = await prisma.milestone.findMany({
      where: {
        status: { in: ['PENDING', 'PROFORMA_RAISED', 'INVOICED'] },
        project: { organizationId: orgId, deletedAt: null, isSample: false, status: { in: ['LIVE', 'DELIVERED'] } },
      },
      orderBy: [{ projectId: 'asc' }, { order: 'asc' }],
      select: {
        id: true,
        label: true,
        percent: true,
        amount: true,
        status: true,
        order: true,
        project: { select: { id: true, name: true, status: true, company: { select: { id: true, name: true } } } },
        proformas: {
          where: { status: { in: ['UNPAID', 'PAID', 'EXPIRED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, number: true, status: true, amount: true, total: true, validTill: true },
        },
        invoices: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { raisedAt: 'desc' },
          take: 1,
          select: { id: true, number: true, amount: true, gstAmount: true, status: true, dueAt: true, payments: { select: { amount: true } } },
        },
      },
    });

    const firstPending = new Set<string>();
    const seen = new Set<string>();
    for (const m of milestones) {
      if (m.status === 'PENDING' && !seen.has(m.project.id)) {
        firstPending.add(m.id);
        seen.add(m.project.id);
      }
    }

    const rows = milestones
      .filter((m) => m.status !== 'PENDING' || firstPending.has(m.id))
      .map((m) => {
        const inv = m.invoices[0] ?? null;
        const pf = m.proformas[0] ?? null;
        return {
          id: m.id,
          label: m.label,
          percent: m.percent,
          /** Before GST. */
          amount: Number(m.amount),
          status: m.status,
          next: m.status === 'PENDING' ? 'PROFORMA' : m.status === 'PROFORMA_RAISED' ? 'INVOICE' : 'PAYMENT',
          project: { id: m.project.id, name: m.project.name, status: m.project.status },
          company: m.project.company,
          proforma: pf
            ? { id: pf.id, number: pf.number, status: pf.status, amount: Number(pf.total ?? pf.amount), validTill: pf.validTill }
            : null,
          invoice: inv
            ? {
                id: inv.id,
                number: inv.number,
                /** GST included. */
                amount: Number(inv.amount),
                gstAmount: inv.gstAmount === null ? null : Number(inv.gstAmount),
                status: inv.status,
                dueAt: inv.dueAt,
                balanceDue: Math.max(0, toPaise(inv.amount) - sumPaise(inv.payments)) / 100,
                ...invoiceState(inv, today),
              }
            : null,
        };
      });

    res.json({ success: true, rows });
  } catch (e) {
    next(e);
  }
});
