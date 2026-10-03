import { prisma } from '../lib/prisma.js';
import type { AiTool } from './ai/types.js';
import { composeApprovalsReport } from './approvalsReport.js';
import { composeForecast } from './forecast.js';
import { describe, resolveSubjects } from './activityLog.js';
import { CHASER_RULES } from './alertRules.js';
import { companyLink, rawLinkFor, retainerMonthLink, taskLink } from '../utils/recordLink.js';

/**
 * Zen's further lookups (Zen Plan 3): alerts, approvals, outreach, proformas,
 * one retainer month, costs, the forecast, history and the Monday brief.
 *
 * The same rules as `zenTools.ts`, which this extends:
 *
 *   - read only;
 *   - scoped to the caller's organisation, which comes from the session and
 *     never from the model;
 *   - no salaries and no cost rates — salary costs are summed into one line,
 *     a salary change in the history is left out, and a month's profit is
 *     counted without people cost;
 *   - at most 50 rows;
 *   - every row carries a `link`, built by utils/recordLink.ts like every
 *     other link in the app, so Zen never has to make one up.
 */

export const CAP = 50;
const limited = (n: unknown, fallback = 25) => Math.min(Math.max(1, Number(n) || fallback), CAP);
const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const daysSince = (d: Date, now = Date.now()) => Math.max(0, Math.floor((now - d.getTime()) / 86_400_000));
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
};
const insensitive = (v: unknown) => ({ contains: String(v), mode: 'insensitive' as const });

/** A salary is summed, never itemised: it names a person and what they are paid. */
const isSalary = (category: string) => /salar/i.test(category);

/** Where an alert, a history row or anything else about a record opens. */
export const linkTo = (entityType: string, entityId: string): string | null =>
  entityType === 'Task' ? taskLink(entityId) : rawLinkFor(entityType, entityId);

/** Resolve a name the model typed to a real company, or null. */
async function findCompany(orgId: string, nameOrId: string) {
  if (!nameOrId.trim()) return null;
  return prisma.company.findFirst({
    where: { organizationId: orgId, OR: [{ id: nameOrId }, { name: insensitive(nameOrId) }] },
    select: { id: true, name: true },
  });
}

/** Everything that belongs to one client, by kind — for alerts and history about them. */
async function clientScope(orgId: string, companyId: string) {
  const [proposals, proformas, projects, retainers, invoices, tasks] = await Promise.all([
    prisma.proposal.findMany({ where: { organizationId: orgId, companyId, deletedAt: undefined }, select: { id: true } }),
    prisma.proforma.findMany({ where: { organizationId: orgId, companyId }, select: { id: true } }),
    prisma.project.findMany({ where: { organizationId: orgId, companyId, deletedAt: undefined }, select: { id: true } }),
    prisma.retainer.findMany({
      where: { organizationId: orgId, companyId },
      select: { id: true, monthCards: { select: { id: true } } },
    }),
    prisma.invoice.findMany({ where: { organizationId: orgId, companyId }, select: { id: true } }),
    prisma.task.findMany({
      where: {
        organizationId: orgId,
        OR: [{ companyId }, { project: { companyId } }, { monthCard: { retainer: { companyId } } }],
      },
      select: { id: true },
      take: 500,
    }),
  ]);
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  return [
    { type: 'Company', ids: [companyId] },
    { type: 'Proposal', ids: ids(proposals) },
    { type: 'Proforma', ids: ids(proformas) },
    { type: 'Project', ids: ids(projects) },
    { type: 'Retainer', ids: ids(retainers) },
    { type: 'MonthCard', ids: retainers.flatMap((r) => ids(r.monthCards)) },
    { type: 'Invoice', ids: ids(invoices) },
    { type: 'Task', ids: ids(tasks) },
  ].filter((s) => s.ids.length > 0);
}

/* ─── Alerts ─────────────────────────────────────────────────────────────── */

/** Each rule in plain words, and what corner of the business it is about. */
const RULES: Record<string, { words: string; area: string }> = {
  PROPOSAL_STALLED: { words: 'Proposal stalled', area: 'sales' },
  VERBAL_NO_ADVANCE: { words: 'Verbal yes not moving', area: 'sales' },
  PROFORMA_EXPIRED: { words: 'Proforma past its valid-till date', area: 'money' },
  PROFORMA_UNPAID: { words: 'Proforma unpaid', area: 'money' },
  INVOICE_OVERDUE: { words: 'Invoice overdue', area: 'money' },
  INVOICE_AGING_60: { words: 'Invoice over 60 days late', area: 'money' },
  MONTH_CARD_NOT_INVOICED: { words: 'Closed month not invoiced', area: 'money' },
  RETAINER_PROFORMA_NOT_RAISED: { words: 'Retainer proforma not raised', area: 'money' },
  PROJECT_OVER_ESTIMATE: { words: 'Project heading for a loss', area: 'money' },
  ALLOCATIONS_UNCONFIRMED: { words: 'Time split not confirmed', area: 'money' },
  RETAINER_EXPIRING: { words: 'Retainer renewal coming up', area: 'work' },
  RETAINER_NO_CONTRACT: { words: 'Retainer with no contract term', area: 'work' },
  PROJECT_BEHIND_SCHEDULE: { words: 'Project behind schedule', area: 'work' },
  CLIENT_QUIET: { words: 'Client gone quiet', area: 'clients' },
  TASK_OVERDUE: { words: 'Task overdue', area: 'team' },
  TASK_AGING: { words: 'Task taking much longer than usual', area: 'team' },
  TASK_WAITING_HOLD: { words: 'Task waiting on the client', area: 'team' },
  MEMBER_OVERALLOCATED: { words: 'Person over-allocated', area: 'team' },
  APPROVAL_REMINDER: { words: 'Approval waiting', area: 'approvals' },
  APPROVAL_ESCALATED: { words: 'Approval escalated', area: 'approvals' },
  ASSET_OVERDUE: { words: 'Equipment late back', area: 'assets' },
  ASSET_HELD_BY_INACTIVE_USER: { words: 'Equipment held by a switched-off account', area: 'assets' },
  ASSET_REPAIR_STALE: { words: 'Equipment in repair over 14 days', area: 'assets' },
  ASSET_WARRANTY_EXPIRING: { words: 'Warranty ending soon', area: 'assets' },
  EVENT_TODAY: { words: 'Meeting or shoot today', area: 'calendar' },
  EVENT_UPDATE: { words: 'Meeting or shoot changed', area: 'calendar' },
};
const AREAS = ['money', 'sales', 'work', 'clients', 'team', 'approvals', 'assets', 'calendar'];

/* ─── The tools ──────────────────────────────────────────────────────────── */

export const ZEN_LOOKUPS = [
  {
    name: 'getAlerts',
    description:
      'Open alerts (the bell), grouped by rule, worst first. Filter by area (money, sales, work, clients, team, approvals, assets, calendar), by one rule, or by client. Use for "what needs attention", "what alerts are open about money".',
    parameters: {
      type: 'object',
      properties: {
        area: { type: 'string', enum: AREAS },
        rule: { type: 'string', description: 'One rule, e.g. INVOICE_OVERDUE.' },
        client: { type: 'string', description: 'Company name or id.' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getApprovals',
    description:
      'Work waiting for approval right now — what, whose, for how long, whether it was reminded or escalated — and the last 7 or 30 days: decisions, typical time, on time, escalations, each approver.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'number', enum: [7, 30], description: 'The period for the stats. Defaults to 7.' } },
    },
  },
  {
    name: 'getOutreach',
    description:
      'Outreach leads (cold names before they are companies): status, contact, owner, next follow-up date, and when they were last touched. Filter by status, owner, name, leads not touched for N days, or follow-ups now due.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['NOT_CONTACTED', 'FOLLOW_UP', 'MEETING', 'INTERESTED', 'DEAD'] },
        owner: { type: 'string', description: "A team member's name." },
        query: { type: 'string', description: 'Part of the lead name.' },
        notTouchedForDays: { type: 'number', description: 'Only leads with nothing recorded for at least this many days.' },
        followUpDue: { type: 'boolean', description: 'Only leads whose follow-up or meeting date has arrived or passed.' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getProformas',
    description:
      'Proformas: number, client, amount, status, raised date, valid-till, what it was for, and whether it has been invoiced. Filter by status (UNPAID, PAID, CANCELLED, or PAST_VALID for unpaid ones past valid-till) or client.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['UNPAID', 'PAID', 'CANCELLED', 'PAST_VALID'] },
        client: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getMonthCard',
    description:
      "One retainer month for one client: its fee, tasks, costs, proforma and invoice and what billing step is next, and its profit before people cost. Use for \"why is Acme's profit blank this month\" or \"has this month been billed\".",
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Company name or id.' },
        month: { type: 'string', description: 'As 2026-09. Defaults to the current month.' },
      },
      required: ['client'],
    },
  },
  {
    name: 'getCosts',
    description:
      'The cost register for a month: every cost with what it was, who was paid, the amount and what it was against, plus totals by category. Filter by client, category (e.g. Software), vendor, or kind. Salaries are only ever one summed line.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'As 2026-09. Defaults to the current month.' },
        client: { type: 'string' },
        category: { type: 'string' },
        vendor: { type: 'string' },
        kind: { type: 'string', enum: ['CLIENT', 'COMPANY', 'CAPITAL'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getForecast',
    description:
      'The 3-month cash forecast, exactly as the Forecast screen shows it: per month the committed cash in (retainers, project milestones), weighted pipeline kept apart, outflows, net cash flow and cash kept. Optionally as though one client\'s open deal had closed.',
    parameters: {
      type: 'object',
      properties: { assumeWonClient: { type: 'string', description: "A client whose open deal to treat as won — the screen's \"What if this deal closes?\"." } },
    },
  },
  {
    name: 'getHistory',
    description:
      'What changed and who did it, newest first, from the activity log: for one client (and everything under it), one project, one task, or the whole studio between two dates.',
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        project: { type: 'string', description: 'A project, retainer project or internal project, by name.' },
        task: { type: 'string', description: 'A task title or id.' },
        from: { type: 'string', description: 'YYYY-MM-DD. Defaults to 7 days ago.' },
        to: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getBrief',
    description:
      "This week's Monday brief: last week's scoreboard against the week before, what needs action, the week ahead, the risks and the team by department.",
    parameters: { type: 'object', properties: {} },
  },
] as const satisfies readonly AiTool[];

export type ZenLookupName = (typeof ZEN_LOOKUPS)[number]['name'];
export const isZenLookup = (name: string): name is ZenLookupName => ZEN_LOOKUPS.some((t) => t.name === name);

/** Take a salary out of a history row before it is described. */
function scrubSalary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSalary);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== 'monthlyCost')
        .map(([k, v]) => [k, scrubSalary(v)]),
    );
  }
  return value;
}

export async function runZenLookup(name: ZenLookupName, args: Record<string, unknown>, organizationId: string): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);

  switch (name) {
    case 'getAlerts': {
      const area = AREAS.includes(String(args.area)) ? String(args.area) : null;
      const rules = args.rule
        ? [String(args.rule).toUpperCase()]
        : area
          ? Object.keys(RULES).filter((r) => RULES[r].area === area)
          : null;
      let scope: { type: string; ids: string[] }[] | null = null;
      if (args.client) {
        const company = await findCompany(organizationId, String(args.client));
        if (!company) return { error: `No company matching "${args.client}".` };
        scope = await clientScope(organizationId, company.id);
      }
      const rows = await prisma.alert.findMany({
        where: {
          organizationId,
          resolvedAt: null,
          ...(rules ? { rule: { in: rules } } : {}),
          ...(scope ? { OR: scope.map((s) => ({ entityType: s.type, entityId: { in: s.ids } })) } : {}),
        },
        orderBy: [{ severity: 'asc' }, { raisedAt: 'desc' }],
        take: limited(args.limit, CAP),
        select: { rule: true, severity: true, message: true, entityType: true, entityId: true, raisedAt: true },
      });
      const groups = new Map<string, typeof rows>();
      for (const a of rows) groups.set(a.rule, [...(groups.get(a.rule) ?? []), a]);
      return {
        open: rows.length,
        byRule: [...groups.entries()].map(([rule, alerts]) => ({
          rule,
          means: RULES[rule]?.words ?? rule,
          area: RULES[rule]?.area ?? 'other',
          count: alerts.length,
          alerts: alerts.map((a) => ({
            message: a.message,
            severity: a.severity,
            raisedOn: day(a.raisedAt),
            // A stuck approval opens the task itself, where Approve is.
            link: CHASER_RULES.includes(a.rule) ? taskLink(a.entityId) : linkTo(a.entityType, a.entityId),
          })),
        })),
      };
    }

    case 'getApprovals': {
      const days = Number(args.days) === 30 ? 30 : 7;
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      const report = await composeApprovalsReport(organizationId, { from, to }, to);
      return {
        periodDays: days,
        link: '/members?tab=approvals',
        waitingNow: report.waitingNow.slice(0, CAP).map((w) => ({
          task: w.title,
          client: w.clientName,
          type: w.taskType,
          round: w.round,
          sentBy: w.editorName,
          sentOn: day(w.submittedAt),
          waitingMinutes: w.waitingMinutes,
          reminded: Boolean(w.remindedAt),
          escalated: Boolean(w.escalatedAt),
          link: taskLink(w.taskId),
        })),
        byGroup: report.byType.map((g) => ({
          types: g.allWork ? 'all work' : g.taskTypes.join(', '),
          approvers: g.approvers.map((a: { name: string }) => a.name),
          sent: g.submitted,
          decided: g.decided,
          approved: g.approved,
          sentBack: g.changesRequested,
          typicalMinutes: g.medianDecisionMinutes,
          decidedOnTime: g.onTime,
          escalated: g.escalated,
          waitingNow: g.waitingNow,
        })),
        byApprover: report.byPerson.map((p) => ({
          approver: p.user.name,
          approved: p.approved,
          sentBack: p.changesRequested,
          typicalMinutes: p.medianDecisionMinutes,
          afterEscalation: p.afterEscalation,
        })),
        onTimeMeans: `decided within ${report.onTimeMinutes} working minutes (the reminder time)`,
      };
    }

    case 'getOutreach': {
      const leads = await prisma.outreachEntry.findMany({
        where: {
          organizationId,
          deletedAt: null,
          // Promoted leads are companies now; they are answered by searchClients.
          promotedCompanyId: null,
          ...(args.status ? { status: String(args.status) as never } : { status: { not: 'DEAD' as never } }),
          ...(args.query ? { name: insensitive(args.query) } : {}),
          ...(args.owner ? { owner: { name: insensitive(args.owner) } } : {}),
        },
        select: {
          id: true,
          name: true,
          status: true,
          contactPersonName: true,
          vertical: true,
          source: true,
          remarks: true,
          nextActionDate: true,
          importedAt: true,
          owner: { select: { name: true } },
        },
        take: 500,
      });
      const touched = leads.length
        ? await prisma.activity.groupBy({
            by: ['entityId'],
            where: { organizationId, entityType: 'OutreachEntry', entityId: { in: leads.map((l) => l.id) } },
            _max: { at: true },
          })
        : [];
      const lastAt = new Map(touched.map((t) => [t.entityId, t._max.at]));
      const quiet = Number(args.notTouchedForDays) || 0;
      const rows = leads
        .map((l) => {
          const last = lastAt.get(l.id) ?? l.importedAt;
          return {
            lead: l.name,
            contact: l.contactPersonName,
            industry: l.vertical,
            source: l.source,
            status: l.status,
            owner: l.owner?.name ?? null,
            nextFollowUp: day(l.nextActionDate),
            followUpDue: Boolean(l.nextActionDate && day(l.nextActionDate)! <= today),
            lastTouched: day(last),
            daysSinceTouched: daysSince(last),
            remarks: l.remarks ? l.remarks.slice(0, 160) : null,
            link: '/outreach',
          };
        })
        .filter((r) => (quiet ? r.daysSinceTouched >= quiet : true))
        .filter((r) => (args.followUpDue ? r.followUpDue : true))
        .sort((a, b) => b.daysSinceTouched - a.daysSinceTouched);
      return { matching: rows.length, leads: rows.slice(0, limited(args.limit)) };
    }

    case 'getProformas': {
      const status = args.status ? String(args.status) : null;
      let companyId: string | undefined;
      if (args.client) {
        const company = await findCompany(organizationId, String(args.client));
        if (!company) return { error: `No company matching "${args.client}".` };
        companyId = company.id;
      }
      const rows = await prisma.proforma.findMany({
        where: {
          organizationId,
          ...(companyId ? { companyId } : {}),
          ...(status === 'PAST_VALID'
            ? { status: 'UNPAID' as never, validTill: { lt: new Date(today) } }
            : status
              ? { status: status as never }
              : { status: { not: 'CANCELLED' as never } }),
        },
        orderBy: { raisedAt: 'desc' },
        take: limited(args.limit),
        select: {
          id: true,
          number: true,
          amount: true,
          total: true,
          status: true,
          raisedAt: true,
          validTill: true,
          sourceType: true,
          sourceId: true,
          invoiceId: true,
          companyId: true,
          company: { select: { name: true } },
        },
      });
      // What each one was for, in words.
      const cards = await prisma.monthCard.findMany({
        where: { id: { in: rows.filter((r) => r.sourceType === 'MONTH_CARD').map((r) => r.sourceId) }, retainer: { organizationId } },
        select: { id: true, month: true },
      });
      const projects = await prisma.project.findMany({
        where: { id: { in: rows.filter((r) => r.sourceType === 'PROJECT').map((r) => r.sourceId) }, organizationId },
        select: { id: true, name: true },
      });
      return rows.map((p) => ({
        number: p.number,
        client: p.company.name,
        // The document's total with GST when it has one; the amount before tax otherwise.
        amount: money(p.total ?? p.amount),
        status: p.status,
        raised: day(p.raisedAt),
        validTill: day(p.validTill),
        pastValidTill: p.status === 'UNPAID' && day(p.validTill)! < today,
        daysSinceRaised: daysSince(p.raisedAt),
        for:
          p.sourceType === 'MONTH_CARD'
            ? `retainer month ${cards.find((c) => c.id === p.sourceId)?.month ?? ''}`.trim()
            : p.sourceType === 'PROJECT'
              ? `project ${projects.find((x) => x.id === p.sourceId)?.name ?? ''}`.trim()
              : 'a proposal',
        invoiced: Boolean(p.invoiceId),
        link: companyLink(p.companyId, 'MONEY'),
      }));
    }

    case 'getMonthCard': {
      const company = await findCompany(organizationId, String(args.client ?? ''));
      if (!company) return { error: `No company matching "${args.client}".` };
      const month = isMonth(args.month) ? args.month : thisMonth();
      const card = await prisma.monthCard.findFirst({
        where: { month, retainer: { organizationId, companyId: company.id } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          month: true,
          status: true,
          revenue: true,
          retainerId: true,
          invoice: { select: { number: true, amount: true, status: true, dueAt: true, payments: { select: { amount: true } } } },
          costs: {
            where: { deletedAt: null },
            select: { category: true, vendor: true, amount: true, incurredAt: true, confirmed: true },
            orderBy: { incurredAt: 'asc' },
          },
          tasks: {
            where: { deletedAt: null },
            orderBy: { dueDate: 'asc' },
            select: {
              id: true,
              title: true,
              status: true,
              dueDate: true,
              assignees: { select: { user: { select: { name: true } } } },
            },
          },
        },
      });
      if (!card) {
        return { error: `${company.name} has no retainer month for ${month}.`, link: companyLink(company.id, 'WORK') };
      }
      const proforma = await prisma.proforma.findFirst({
        where: { organizationId, sourceType: 'MONTH_CARD' as never, sourceId: card.id, status: { not: 'CANCELLED' as never } },
        orderBy: { raisedAt: 'desc' },
        select: { number: true, status: true, amount: true, total: true, validTill: true },
      });
      const fee = money(card.revenue);
      const visible = card.costs.filter((c) => !isSalary(c.category));
      const external = card.costs.reduce((s, c) => s + money(c.amount), 0);
      const paid = card.invoice ? card.invoice.payments.reduce((s, p) => s + money(p.amount), 0) : 0;
      const late = (t: (typeof card.tasks)[number]) =>
        !['DONE', 'CANCELLED', 'IN_REVIEW'].includes(t.status) && day(t.dueDate)! < today;
      return {
        client: company.name,
        month: card.month,
        monthStatus: card.status,
        fee,
        link: retainerMonthLink(card.retainerId, card.month),
        tasks: {
          total: card.tasks.length,
          done: card.tasks.filter((t) => t.status === 'DONE').length,
          open: card.tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS').length,
          late: card.tasks.filter(late).length,
          list: card.tasks.slice(0, CAP).map((t) => ({
            title: t.title,
            status: t.status,
            due: day(t.dueDate),
            late: late(t),
            assignedTo: t.assignees.map((a) => a.user.name),
            link: taskLink(t.id),
          })),
        },
        costs: {
          entered: card.costs.length,
          total: card.costs.length ? external : null,
          list: visible.slice(0, CAP).map((c) => ({
            what: c.category,
            paidTo: c.vendor,
            amount: money(c.amount),
            on: day(c.incurredAt),
            draft: !c.confirmed,
          })),
          link: retainerMonthLink(card.retainerId, card.month, 'costs'),
        },
        profitBeforePeopleCost: card.costs.length ? fee - external : null,
        profitNote: card.costs.length
          ? 'Fee minus the costs entered. People cost (time split × salaries) is not included — Zen never sees salaries; the retainer page and Money include it.'
          : 'No costs entered against this month, so its profit is not known yet — "not costed yet", not the whole fee.',
        proforma: proforma
          ? { number: proforma.number, status: proforma.status, amount: money(proforma.total ?? proforma.amount), validTill: day(proforma.validTill) }
          : null,
        invoice: card.invoice
          ? {
              number: card.invoice.number,
              amount: money(card.invoice.amount),
              status: card.invoice.status,
              due: day(card.invoice.dueAt),
              received: paid,
              balance: money(card.invoice.amount) - paid,
            }
          : null,
        nextBillingStep: card.invoice
          ? card.invoice.status === 'PAID'
            ? 'Paid'
            : 'Record payment'
          : proforma
            ? 'Enter invoice'
            : 'Raise proforma',
        billingLink: '/money?tab=billing',
      };
    }

    case 'getCosts': {
      const month = isMonth(args.month) ? args.month : thisMonth();
      let companyId: string | undefined;
      if (args.client) {
        const company = await findCompany(organizationId, String(args.client));
        if (!company) return { error: `No company matching "${args.client}".` };
        companyId = company.id;
      }
      const kind = args.kind === 'CLIENT' ? 'DIRECT' : args.kind === 'COMPANY' || args.kind === 'CAPITAL' ? String(args.kind) : null;
      const rows = await prisma.cost.findMany({
        where: {
          organizationId,
          deletedAt: null,
          incurredAt: monthRange(month),
          ...(kind ? { type: kind as never } : {}),
          ...(args.category ? { category: insensitive(args.category) } : {}),
          ...(args.vendor ? { vendor: insensitive(args.vendor) } : {}),
          ...(companyId
            ? { OR: [{ monthCard: { retainer: { companyId } } }, { project: { companyId } }] }
            : {}),
        },
        orderBy: { incurredAt: 'asc' },
        take: 2000,
        select: {
          category: true,
          vendor: true,
          amount: true,
          incurredAt: true,
          type: true,
          confirmed: true,
          recurring: true,
          monthCard: { select: { month: true, retainerId: true, retainer: { select: { company: { select: { name: true } } } } } },
          project: { select: { id: true, name: true, company: { select: { name: true } } } },
        },
      });
      const salaries = rows.filter((c) => isSalary(c.category));
      const itemised = rows.filter((c) => !isSalary(c.category));
      const byCategory = new Map<string, { amount: number; count: number }>();
      for (const c of rows) {
        const key = isSalary(c.category) ? 'Salaries' : c.category;
        const line = byCategory.get(key) ?? { amount: 0, count: 0 };
        line.amount += money(c.amount);
        line.count += 1;
        byCategory.set(key, line);
      }
      return {
        month,
        total: rows.reduce((s, c) => s + money(c.amount), 0),
        note: 'Amounts include GST. Salaries are one summed line and never itemised.',
        byCategory: [...byCategory.entries()]
          .map(([category, v]) => ({ category, amount: Math.round(v.amount), entries: v.count }))
          .sort((a, b) => b.amount - a.amount),
        salaries: salaries.length ? { amount: Math.round(salaries.reduce((s, c) => s + money(c.amount), 0)), entries: salaries.length } : null,
        link: '/money',
        costs: itemised.slice(0, limited(args.limit)).map((c) => ({
          what: c.category,
          paidTo: c.vendor,
          amount: money(c.amount),
          on: day(c.incurredAt),
          kind: c.type === 'DIRECT' ? 'client' : c.type.toLowerCase(),
          against: c.monthCard
            ? `${c.monthCard.retainer.company.name} retainer, ${c.monthCard.month}`
            : c.project
              ? `${c.project.name} (${c.project.company?.name ?? 'project'})`
              : null,
          draft: !c.confirmed,
          recurring: c.recurring,
          link: c.monthCard
            ? retainerMonthLink(c.monthCard.retainerId, c.monthCard.month, 'costs')
            : c.project
              ? `${rawLinkFor('Project', c.project.id)}?tab=costs`
              : '/money',
        })),
      };
    }

    case 'getForecast': {
      let assumeWonId: string | null = null;
      if (args.assumeWonClient) {
        const company = await findCompany(organizationId, String(args.assumeWonClient));
        if (!company) return { error: `No company matching "${args.assumeWonClient}".` };
        const deal = await prisma.proposal.findFirst({
          where: { organizationId, companyId: company.id, deletedAt: null, outcome: null },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        if (!deal) return { error: `${company.name} has no open deal to assume won.` };
        assumeWonId = deal.id;
      }
      const f = await composeForecast(organizationId, assumeWonId);
      return {
        link: '/forecast',
        currentMonthlyRetainers: f.summary.currentMrr,
        // The team's total only, as the screen shows it — never one person's.
        monthlyPayrollTotal: f.summary.monthlyPayroll,
        activeRetainers: f.summary.activeRetainersCount,
        openDeals: f.summary.activeDealsCount,
        assumedWon: assumeWonId ? String(args.assumeWonClient) : null,
        months: f.forecast.map((m) => ({
          month: m.monthName,
          cashIn: m.inflows.committed,
          fromRetainers: m.inflows.retainers,
          fromProjectMilestones: m.inflows.projects,
          fromAssumedWonDeal: m.inflows.assumedWon,
          pipelineWeightedNotCounted: m.inflows.pipelineWeighted,
          payroll: m.outflows.payroll,
          vendorAndDirect: m.outflows.vendorAndDirect,
          netCashFlow: m.netCashFlow,
          netCashFlowIfPipelineLands: m.netCashFlowWithPipeline,
          cashKeptPercent: m.cashKeptPercent,
          verdict: m.status,
        })),
        biggestDeals: f.deals.slice(0, 10).map((d) => ({
          client: d.companyName,
          stage: d.stage,
          value: d.value,
          link: companyLink(d.companyId, 'PROPOSALS'),
        })),
      };
    }

    case 'getHistory': {
      const scopes: { type: string; ids: string[] }[] = [];
      let about: string | null = null;
      if (args.client) {
        const company = await findCompany(organizationId, String(args.client));
        if (!company) return { error: `No company matching "${args.client}".` };
        scopes.push(...(await clientScope(organizationId, company.id)));
        about = company.name;
      } else if (args.project) {
        const q = insensitive(args.project);
        const [project, retainerProject, internal] = await Promise.all([
          prisma.project.findFirst({ where: { organizationId, name: q }, select: { id: true, name: true } }),
          prisma.retainerProject.findFirst({ where: { retainer: { organizationId }, name: q }, select: { id: true, name: true } }),
          prisma.internalProject.findFirst({ where: { organizationId, name: q }, select: { id: true, name: true } }),
        ]);
        const hit = project
          ? { type: 'Project', ...project, taskWhere: { projectId: project.id } }
          : retainerProject
            ? { type: 'RetainerProject', ...retainerProject, taskWhere: { retainerProjectId: retainerProject.id } }
            : internal
              ? { type: 'InternalProject', ...internal, taskWhere: { internalProjectId: internal.id } }
              : null;
        if (!hit) return { error: `No project matching "${args.project}".` };
        const tasks = await prisma.task.findMany({ where: { organizationId, ...hit.taskWhere }, select: { id: true }, take: 500 });
        scopes.push({ type: hit.type, ids: [hit.id] });
        if (tasks.length) scopes.push({ type: 'Task', ids: tasks.map((t) => t.id) });
        about = hit.name;
      } else if (args.task) {
        const task = await prisma.task.findFirst({
          where: { organizationId, OR: [{ id: String(args.task) }, { title: insensitive(args.task) }] },
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true },
        });
        if (!task) return { error: `No task matching "${args.task}".` };
        scopes.push({ type: 'Task', ids: [task.id] });
        about = task.title;
      }

      const fromDay = typeof args.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? new Date(args.from) : null;
      const toDay = typeof args.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.to) ? new Date(args.to) : null;
      // A record's whole history by default; the studio's last 7 days.
      const since = fromDay ?? (scopes.length ? null : new Date(Date.now() - 7 * 86_400_000));
      const rows = await prisma.activity.findMany({
        where: {
          organizationId,
          ...(scopes.length ? { OR: scopes.map((s) => ({ entityType: s.type, entityId: { in: s.ids } })) } : {}),
          ...(since || toDay
            ? { at: { ...(since ? { gte: since } : {}), ...(toDay ? { lt: new Date(toDay.getTime() + 86_400_000) } : {}) } }
            : {}),
        },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: limited(args.limit),
        include: { actor: { select: { id: true, name: true } } },
      });
      // A salary change is somebody's pay; it never leaves through Zen.
      const clean = rows.map((r) => ({ ...r, payload: scrubSalary(r.payload) }));
      const [subjects, team] = await Promise.all([
        resolveSubjects(organizationId, clean),
        prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      ]);
      const people = new Map(team.map((u) => [u.id, u.name]));
      return {
        about: about ?? 'the whole studio',
        changes: clean.map((r) => {
          const entry = describe(r, subjects, people);
          return {
            at: entry.at,
            who: entry.actor?.name ?? entry.nobody,
            did: entry.action,
            what: entry.subject ? [entry.subject.label, entry.subject.context].filter(Boolean).join(' · ') : null,
            detail: entry.detail,
            link: entry.subject?.href ?? linkTo(r.entityType, r.entityId),
          };
        }),
      };
    }

    case 'getBrief': {
      // Loaded when asked for: the brief's summary writer reaches back into
      // Zen's own settings, and a static import would make the two load each
      // other. Without the usage block — it names people, and it is not what
      // the brief is asked about.
      const { composeMondayBrief } = await import('../routes/brief.js');
      const brief = await composeMondayBrief(organizationId, { includeUsage: false });
      return {
        link: '/brief',
        lastWeek: brief.weeks.last,
        scoreboard: brief.scoreboard,
        needsAction: brief.needsAction,
        risks: brief.risks,
        comingUp: brief.comingUp,
        team: brief.team,
        summary: brief.summary?.text ?? null,
      };
    }
  }
}
