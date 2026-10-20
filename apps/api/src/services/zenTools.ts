import { prisma } from '../lib/prisma.js';
import type { AiTool } from './ai/types.js';
import { ZEN_LOOKUPS, isZenLookup, runZenLookup } from './zenLookups.js';
import { repeatLabel } from './taskRepeat.js';
import { companyLink, rawLinkFor, retainerMonthLink, taskLink } from '../utils/recordLink.js';
import { proposalProbability, STAGE_PROBABILITY_SELECT } from '../utils/stageProbability.js';
import { dealStaleness, nextStepState, studioToday } from './salesFollowUp.js';
import { ACTIVE_DEAL_WHERE } from './activeDeal.js';
import { BOARD_PERSON_SELECT, composeTeamBoard } from './teamBoard.js';
import { allDepartmentPeople, composeDepartmentOverview, composeDepartmentWork } from './departmentPage.js';

/**
 * What Zen may look up, and how.
 *
 * ─── Why functions rather than one big snapshot ─────────────────────────────
 *
 * Zen used to be handed a fixed block of figures on every question: this
 * month's fees and costs, overdue invoices, open proposals, task counts. That
 * works while the questions are about this month's money and stops working the
 * moment somebody asks about a client, an asset, or August.
 *
 * Making the block bigger is not the answer. Sixteen companies with their
 * people, every task and the whole proposal history costs more per question
 * than the answer is worth, and a model handed six irrelevant tables answers
 * less precisely than one handed two.
 *
 * So Zen is given a short orientation — what month it is, who the clients are,
 * who the team are, the month's totals — and these functions for everything
 * else. It asks for what the question needs.
 *
 * ─── The rules these follow ─────────────────────────────────────────────────
 *
 *   1. Read only. Nothing here writes. Writing is a separate surface with its
 *      own confirmation, because a mis-parsed sentence must not change a row.
 *   2. Scoped to the caller's organisation, always. Every `where` carries it;
 *      an organisationId that came from the model rather than the session would
 *      be a way to read another studio's books.
 *   3. No salaries. `User.monthlyCost` is exposed by nothing here. "Who is
 *      overloaded" is a task count; what somebody is paid would be sent to
 *      Google for no gain.
 *   4. Bounded. Every list takes a limit and caps it, because a model asking
 *      for "all tasks" should not be able to put four thousand rows on the
 *      wire.
 *   5. Linked. Every row carries a `link` to where it is in the app, built by
 *      utils/recordLink.ts like every other link — so an answer can link what
 *      it names without Zen ever making a link up.
 *
 * The lookups added later (alerts, approvals, outreach, proformas, a retainer
 * month, costs, the forecast, history, the brief) are in `zenLookups.ts`.
 */

const CAP = 50;
const limited = (n: unknown) => Math.min(Number(n) || 25, CAP);
const money = (v: unknown) => Number(v ?? 0);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
/**
 * A client named by the model — by name, or by the id it read off the page
 * they are on. Matching names alone, a question asked from a client's own page
 * ("what do they owe us?") came back empty.
 */
const clientMatch = (v: unknown) => ({
  OR: [{ id: String(v) }, { name: { contains: String(v), mode: 'insensitive' as const } }],
});

/** The shape Gemini is given. Names match the handlers below. */
export const ZEN_TOOLS = [
  {
    name: 'searchClients',
    description:
      'Find companies by name, or list them. Returns status (PROSPECT, CLIENT, PAST), vertical, city and owner. Use this to resolve a name somebody mentioned before asking for its detail.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of a company name. Omit to list all.' },
        status: { type: 'string', enum: ['PROSPECT', 'CLIENT', 'PAST'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getClient',
    description:
      'Everything about one company: its contacts, its retainer and monthly fee, its projects, and its open proposals. Takes the name or the id.',
    parameters: {
      type: 'object',
      properties: { client: { type: 'string', description: 'Company name or id.' } },
      required: ['client'],
    },
  },
  {
    name: 'getMonth',
    description:
      'The money for one month: every retainer\'s fee, cost and margin, and the totals. Use for "how did August go" or any comparison between months.',
    parameters: {
      type: 'object',
      properties: { month: { type: 'string', description: 'As 2026-09. Defaults to the current month.' } },
    },
  },
  {
    name: 'getTasks',
    description:
      'Tasks, with their titles and whether they repeat. Filter by client, by person, by month, or by status. Use for "what is on my plate", "what is Janani behind on", "what is late".',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Part of a task title, or a task id — for one task.' },
        client: { type: 'string' },
        person: { type: 'string', description: 'A team member\'s name.' },
        month: { type: 'string', description: 'As 2026-09.' },
        status: { type: 'string', enum: ['OPEN', 'LATE', 'DONE', 'ON_HOLD', 'IN_REVIEW', 'CANCELLED'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getPipeline',
    description:
      'Open proposals: client, kind, stage, value, how likely, the next step and its date, the last touch (last real contact), and whether it has gone stale. Use for "what is pending", "which deals have gone quiet", "which deals have no next step", "what is overdue".',
    parameters: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['PROSPECT', 'PROPOSAL_SENT', 'IN_NEGOTIATION', 'PROFORMA_ISSUED', 'VERBAL_YES'],
        },
        missingNextStep: { type: 'boolean', description: 'Only open deals with no next step written. A step written without a date is not missing; its date shows as not set.' },
        stale: { type: 'boolean', description: "Only deals whose last touch is past the org's going-stale threshold." },
        overdue: { type: 'boolean', description: 'Only deals whose next step date has passed.' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getInvoices',
    description:
      'Invoices. By default only the overdue ones, which is almost always the question. Set overdueOnly false for all of them.',
    parameters: {
      type: 'object',
      properties: {
        overdueOnly: { type: 'boolean' },
        client: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getProjects',
    description: 'One-off projects, with quoted value, dates and milestone progress.',
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        status: { type: 'string', enum: ['LIVE', 'DELIVERED', 'CANCELLED'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'getTeamLoad',
    description:
      'How much each department is carrying in a month: open, late and done task counts, by department. Also each person\'s "Now" (the task they said they are working on, or null) and "Next up" (the top of their own My Work list). Use for "who is on what", "what is Ravi working on". Never includes pay.',
    parameters: {
      type: 'object',
      properties: { month: { type: 'string', description: 'As 2026-09.' } },
    },
  },
  {
    name: 'getDepartment',
    description:
      "One department as its head sees it on My Department: each person's Now (what they said they are on) and Next up, their open, overdue, waiting, in-review and done-this-week counts, today's meetings and shoots and the gear they hold; what needs attention (overdue, on hold 3+ working days, stuck in review, urgent not started, gear overdue back, the time split unconfirmed after the 25th); and the client work and internal projects its people are on. Use for \"how is Development doing\", \"what is the video team on\". Never includes pay.",
    parameters: {
      type: 'object',
      properties: { department: { type: 'string', description: "The department's name, e.g. Development." } },
      required: ['department'],
    },
  },
  {
    name: 'getAssets',
    description: 'Equipment: tag, name, category, condition, and who is holding it.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        holder: { type: 'string', description: 'A team member\'s name.' },
        limit: { type: 'number' },
      },
    },
  },
  ...ZEN_LOOKUPS,
] as const satisfies readonly AiTool[];

export type ZenToolName = (typeof ZEN_TOOLS)[number]['name'];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Resolve a name the model typed to a real company, or null. */
async function findCompany(orgId: string, nameOrId: string) {
  return prisma.company.findFirst({
    where: {
      organizationId: orgId,
      OR: [{ id: nameOrId }, { name: { contains: nameOrId, mode: 'insensitive' } }],
    },
    select: { id: true, name: true, status: true, vertical: true, city: true },
  });
}

/**
 * Run one tool call.
 *
 * `organizationId` comes from the session and never from the model — an
 * argument the model could set would be a way to read another studio's books.
 * An unknown tool returns an error object rather than throwing, because the
 * model should be told it asked for something that does not exist and given a
 * chance to ask for something that does.
 */
export async function runZenTool(
  name: string,
  args: Record<string, unknown>,
  organizationId: string,
): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);

  switch (name) {
    case 'searchClients': {
      const rows = await prisma.company.findMany({
        where: {
          organizationId,
          ...(args.query ? { name: { contains: String(args.query), mode: 'insensitive' as const } } : {}),
          ...(args.status ? { status: String(args.status) as never } : {}),
        },
        select: {
          id: true,
          name: true,
          status: true,
          vertical: true,
          city: true,
          owner: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
        take: limited(args.limit),
      });
      return rows.map((c) => ({
        client: c.name,
        status: c.status,
        vertical: c.vertical,
        city: c.city,
        owner: c.owner?.name ?? null,
        link: companyLink(c.id),
      }));
    }

    case 'getClient': {
      const found = await findCompany(organizationId, String(args.client ?? ''));
      if (!found) return { error: `No company matching "${args.client}".` };
      const full = await prisma.company.findUnique({
        where: { id: found.id },
        select: {
          id: true,
          name: true,
          status: true,
          vertical: true,
          city: true,
          website: true,
          owner: { select: { name: true } },
          people: { select: { name: true, role: true, email: true, phone: true } },
          retainers: {
            select: { id: true, monthlyValue: true, startDate: true, termMonths: true, status: true },
          },
          projects: { where: { deletedAt: null }, select: { id: true, name: true, quotedValue: true, status: true, endDate: true } },
          proposals: {
            where: { deletedAt: null, stage: { notIn: ['WON', 'LOST', 'EXPIRED'] } },
            select: { kind: true, stage: true, versions: { orderBy: { n: 'desc' }, take: 1, select: { value: true } } },
          },
        },
      });
      if (!full) return { error: 'That company went away.' };
      return {
        client: full.name,
        status: full.status,
        vertical: full.vertical,
        city: full.city,
        website: full.website,
        owner: full.owner?.name ?? null,
        link: companyLink(full.id),
        contacts: full.people.map((p) => ({
          name: p.name,
          role: p.role,
          email: p.email,
          phone: p.phone,
          link: companyLink(full.id),
        })),
        retainers: full.retainers.map((r) => ({
          monthlyFee: money(r.monthlyValue),
          startedOn: day(r.startDate),
          termMonths: r.termMonths,
          status: r.status,
          link: rawLinkFor('Retainer', r.id),
        })),
        projects: full.projects.map((p) => ({
          name: p.name,
          quoted: money(p.quotedValue),
          status: p.status,
          endsOn: day(p.endDate),
          link: rawLinkFor('Project', p.id),
        })),
        openProposals: full.proposals.map((p) => ({
          kind: p.kind,
          stage: p.stage,
          value: money(p.versions[0]?.value),
          link: companyLink(full.id, 'PROPOSALS'),
        })),
      };
    }

    case 'getMonth': {
      const month = String(args.month ?? thisMonth());
      const cards = await prisma.monthCard.findMany({
        where: { month, retainer: { organizationId } },
        select: {
          status: true,
          revenue: true,
          retainerId: true,
          retainer: { select: { company: { select: { name: true } } } },
          // Nested, so the soft-delete default does not reach it: a cost
          // somebody deleted must not go on counting here.
          costs: { where: { deletedAt: null }, select: { amount: true, category: true, vendor: true } },
        },
      });
      const rows = cards.map((c) => {
        const fee = money(c.revenue);
        const cost = c.costs.length ? c.costs.reduce((s, x) => s + money(x.amount), 0) : null;
        return {
          client: c.retainer.company.name,
          fee,
          cost,
          profit: cost === null ? null : fee - cost,
          marginPercent: cost === null || fee === 0 ? null : Math.round(((fee - cost) / fee) * 1000) / 10,
          monthStatus: c.status,
          link: retainerMonthLink(c.retainerId, month),
        };
      });
      const fee = rows.reduce((s, r) => s + r.fee, 0);
      const costed = rows.filter((r) => r.cost !== null);
      const cost = costed.length ? costed.reduce((s, r) => s + (r.cost ?? 0), 0) : null;
      return {
        month,
        retainers: rows,
        totals: {
          fee,
          cost,
          profit: cost === null ? null : fee - cost,
          marginPercent: cost === null || fee === 0 ? null : Math.round(((fee - cost) / fee) * 1000) / 10,
        },
        note: [
          costed.length === rows.length
            ? null
            : 'Some retainers have no costs entered. Their profit is unknown, not the whole fee.',
          'Cost here is the costs entered only — people cost (time split × salaries) is not included, so profit can read higher than on Money.',
        ]
          .filter(Boolean)
          .join(' '),
      };
    }

    case 'getTasks': {
      const status = args.status ? String(args.status) : null;
      const rows = await prisma.task.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(args.month ? { monthCard: { month: String(args.month) } } : {}),
          ...(args.task
            ? { AND: [{ OR: [{ id: String(args.task) }, { title: { contains: String(args.task), mode: 'insensitive' as const } }] }] }
            : {}),
          ...(args.client
            ? {
                OR: [
                  { monthCard: { retainer: { company: clientMatch(args.client) } } },
                  { project: { company: clientMatch(args.client) } },
                  // A follow-up belongs to its client without a project or a month.
                  { company: clientMatch(args.client) },
                ],
              }
            : {}),
          ...(args.person
            ? { assignees: { some: { user: { name: { contains: String(args.person), mode: 'insensitive' as const } } } } }
            : {}),
          ...(status === 'OPEN' ? { status: { in: ['TODO', 'IN_PROGRESS'] as never } } : {}),
          ...(status === 'DONE' ? { status: 'DONE' as never } : {}),
          ...(status === 'ON_HOLD' ? { status: 'ON_HOLD' as never } : {}),
          // Sent for approval, waiting on an approver.
          ...(status === 'IN_REVIEW' ? { status: 'IN_REVIEW' as never } : {}),
          ...(status === 'CANCELLED' ? { status: 'CANCELLED' as never } : {}),
          ...(status === 'LATE'
            ? { status: { notIn: ['DONE', 'CANCELLED', 'IN_REVIEW'] as never }, dueDate: { lt: new Date(today) } }
            : {}),
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          repeat: { select: { frequency: true, weekday: true, dayOfMonth: true, stoppedAt: true } },
          monthCard: {
            select: { month: true, retainer: { select: { company: { select: { name: true } } } } },
          },
          project: { select: { name: true, company: { select: { name: true } } } },
          retainerProject: { select: { name: true } },
          assignees: { select: { user: { select: { name: true } } } },
        },
        orderBy: { dueDate: 'asc' },
        take: limited(args.limit),
      });
      return rows.map((t) => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        due: day(t.dueDate),
        late: t.status !== 'DONE' && t.status !== 'CANCELLED' && day(t.dueDate)! < today,
        client: t.monthCard?.retainer.company.name ?? t.project?.company?.name ?? null,
        partOf: t.retainerProject?.name ?? t.project?.name ?? 'Internal',
        month: t.monthCard?.month ?? null,
        assignedTo: t.assignees.map((a) => a.user.name),
        repeats: t.repeat ? (t.repeat.stoppedAt ? 'stopped repeating' : repeatLabel(t.repeat)) : null,
        link: taskLink(t.id),
      }));
    }

    case 'getPipeline': {
      // The organisation's own stage weights and each deal's override — the
      // same figure the Pipeline board shows, not a fixed copy of the defaults.
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { ...STAGE_PROBABILITY_SELECT, dealStaleDays: true },
      });
      const staleDays = org?.dealStaleDays ?? 25;
      const today = await studioToday(organizationId);
      const rows = await prisma.proposal.findMany({
        // Active deals only, by the rule every screen shares (QA19, F01); a
        // stage asked for narrows that, and a closed stage finds nothing.
        where: {
          organizationId,
          ...ACTIVE_DEAL_WHERE,
          ...(args.stage ? { AND: [{ stage: String(args.stage) as never }] } : {}),
        },
        select: {
          id: true,
          kind: true,
          stage: true,
          outcome: true,
          probabilityOverride: true,
          wonAt: true,
          verbalYesAt: true,
          createdAt: true,
          nextStep: true,
          nextStepDate: true,
          lastTouchedAt: true,
          companyId: true,
          company: { select: { name: true } },
          owner: { select: { name: true } },
          versions: { orderBy: { n: 'desc' }, select: { value: true, scopeSummary: true, sentAt: true } },
        },
        orderBy: { updatedAt: 'asc' },
        take: 500,
      });
      const deals = rows
        .map((p) => {
          // The same last touch, staleness and next step the board shows.
          const touch = dealStaleness(p, staleDays, today);
          const step = nextStepState({ nextStep: p.nextStep, date: p.nextStepDate }, true, today);
          return {
            client: p.company?.name ?? null,
            kind: p.kind,
            stage: p.stage,
            value: money(p.versions[0]?.value),
            scope: p.versions[0]?.scopeSummary ?? null,
            probability: proposalProbability(p, org),
            owner: p.owner?.name ?? null,
            nextStep: p.nextStep,
            nextStepDate: day(p.nextStepDate),
            noNextStep: step.missing,
            nextStepOverdue: step.overdue,
            lastTouched: day(touch.lastTouchAt),
            lastTouchRecorded: touch.touchRecorded,
            daysSinceTouch: touch.daysSinceTouch,
            stale: touch.stale,
            link: companyLink(p.companyId, 'PROPOSALS'),
          };
        })
        .filter((d) => (args.missingNextStep ? d.noNextStep : true))
        .filter((d) => (args.stale ? d.stale : true))
        .filter((d) => (args.overdue ? d.nextStepOverdue : true));
      return { staleAfterDays: staleDays, matching: deals.length, deals: deals.slice(0, limited(args.limit)) };
    }

    case 'getInvoices': {
      const overdueOnly = args.overdueOnly !== false;
      const rows = await prisma.invoice.findMany({
        where: {
          organizationId,
          // A cancelled invoice is owed by nobody, so it is never overdue.
          ...(overdueOnly ? { status: { notIn: ['PAID', 'CANCELLED'] as never }, dueAt: { lt: new Date() } } : {}),
          ...(args.client ? { company: clientMatch(args.client) } : {}),
        },
        select: {
          id: true,
          number: true,
          amount: true,
          status: true,
          dueAt: true,
          companyId: true,
          company: { select: { name: true } },
        },
        orderBy: { dueAt: 'asc' },
        take: limited(args.limit),
      });
      return rows.map((i) => ({
        number: i.number,
        client: i.company?.name ?? null,
        amount: money(i.amount),
        status: i.status,
        due: day(i.dueAt),
        daysLate: Math.max(0, Math.ceil((Date.now() - i.dueAt.getTime()) / 86_400_000)),
        // Money is where a payment is recorded; the client's page lists it with their other documents.
        link: rawLinkFor('Invoice', i.id),
        clientLink: companyLink(i.companyId, 'MONEY'),
      }));
    }

    case 'getProjects': {
      const rows = await prisma.project.findMany({
        where: {
          organizationId,
          // Every other query in this file filters; this one did not, so the
          // assistant would describe a deleted project in prose — with its
          // value and its status — which is the hardest place to spot a
          // phantom row.
          deletedAt: null,
          ...(args.status ? { status: String(args.status) as never } : {}),
          ...(args.client ? { company: clientMatch(args.client) } : {}),
        },
        select: {
          id: true,
          name: true,
          quotedValue: true,
          status: true,
          startDate: true,
          endDate: true,
          company: { select: { name: true } },
          owner: { select: { name: true } },
          milestones: { select: { label: true, percent: true, status: true } },
        },
        orderBy: { endDate: 'asc' },
        take: limited(args.limit),
      });
      return rows.map((p) => ({
        name: p.name,
        client: p.company?.name ?? null,
        quoted: money(p.quotedValue),
        status: p.status,
        starts: day(p.startDate),
        ends: day(p.endDate),
        owner: p.owner?.name ?? null,
        milestonesPaid: p.milestones.filter((m) => m.status === 'PAID').length,
        milestones: p.milestones.length,
        link: rawLinkFor('Project', p.id),
      }));
    }

    case 'getTeamLoad': {
      const month = String(args.month ?? thisMonth());
      const [rows, departments] = await Promise.all([
        prisma.task.findMany({
          where: { organizationId, deletedAt: null, monthCard: { month } },
          select: {
            status: true,
            dueDate: true,
            assignees: { select: { user: { select: { departmentId: true } } } },
          },
        }),
        prisma.department.findMany({
          where: { organizationId },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true },
        }),
      ]);
      // By department, as the description says — counted once per department
      // however many of its people are on a task.
      const by = new Map<string, { open: number; late: number; done: number }>();
      for (const t of rows) {
        // The app's "late": past due and not finished, and not waiting on an approver.
        const late = !['DONE', 'CANCELLED', 'IN_REVIEW'].includes(t.status) && day(t.dueDate)! < today;
        for (const id of new Set(t.assignees.map((a) => a.user.departmentId ?? ''))) {
          const d = by.get(id) ?? { open: 0, late: 0, done: 0 };
          if (t.status === 'DONE') d.done += 1;
          else if (t.status !== 'CANCELLED') d.open += 1;
          if (late) d.late += 1;
          by.set(id, d);
        }
      }
      const order = [...departments.map((d) => d.id), ''];
      // What each person said they are on now, and what is next on their own
      // list — the Team screen's Board, for everybody. Now is what they said,
      // so it carries no time.
      const people = await prisma.user.findMany({
        where: { organizationId, active: true },
        orderBy: [{ department: { sortOrder: 'asc' } }, { name: 'asc' }],
        select: BOARD_PERSON_SELECT,
      });
      const board = await composeTeamBoard(organizationId, people);
      const titleOf = (id: string | null) => (id ? (board.tasks[id]?.title ?? null) : null);
      return {
        month,
        departments: [...by.entries()]
          .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
          .map(([id, v]) => ({
            department: departments.find((d) => d.id === id)?.name ?? 'No department',
            ...v,
            // Its My Department page; the unplaced have none, so the Team screen.
            link: id ? `/my-department?department=${id}` : '/members',
          })),
        people: board.people.map((p) => ({
          name: p.name,
          department: p.department ?? 'No department',
          now: titleOf(p.nowTaskId),
          nowLink: p.nowTaskId ? taskLink(p.nowTaskId) : null,
          nextUp: titleOf(p.nextUpTaskId),
          nextUpLink: p.nextUpTaskId ? taskLink(p.nextUpTaskId) : null,
        })),
      };
    }

    case 'getDepartment': {
      const asked = String(args.department ?? '').trim();
      const found = asked
        ? await prisma.department.findFirst({
            where: { organizationId, archivedAt: null, name: { contains: asked, mode: 'insensitive' } },
            select: { id: true, name: true, headId: true, head: { select: { name: true } } },
          })
        : null;
      if (!found) return { error: `No department matching "${asked}".` };
      const department = { id: found.id, name: found.name, headId: found.headId, headName: found.head?.name ?? null };
      const people = await allDepartmentPeople(organizationId, found.id);
      const [overview, work] = await Promise.all([
        composeDepartmentOverview(organizationId, department, people),
        composeDepartmentWork(organizationId, department, people),
      ]);
      const titleOf = (id: string | null) => (id ? (overview.tasks[id]?.title ?? null) : null);
      return {
        department: found.name,
        head: department.headName,
        people: overview.people.map((p) => ({
          name: p.name,
          designation: p.designation,
          now: titleOf(p.nowTaskId),
          nextUp: titleOf(p.nextUpTaskId),
          open: p.lists.open.length,
          overdue: p.lists.overdue.length,
          waiting: p.lists.waiting.length,
          inReview: p.lists.inReview.length,
          doneThisWeek: p.lists.doneThisWeek.length,
          todayEvents: p.todayEvents.map((e) => (e.allDay ? e.title : `${e.title} ${e.time}`)),
          gearHeld: p.gear.length,
        })),
        needsAttention: overview.attention.map((a) =>
          a.kind === 'TASK'
            ? { task: titleOf(a.taskId), reasons: a.reasons, link: taskLink(a.taskId) }
            : a.kind === 'GEAR_OVERDUE'
              ? { gear: `${a.tag} ${a.name}`, with: a.holder.name, daysOverdue: a.daysOverdue }
              : { timeSplitNotConfirmed: a.month, people: a.people.map((p) => p.name) },
        ),
        clientWork: work.clients.map((c) => ({
          client: c.name,
          work: c.items.map((i) => ({
            name: i.kind === 'RETAINER' ? 'Retainer' : i.name,
            people: i.people.map((p) => p.name),
            open: i.open,
            overdue: i.overdue,
            nextDeadline: i.nextDeadline?.dueDate ?? null,
            link: i.href,
          })),
        })),
        internalProjects: work.internalProjects.map((p) => ({
          name: p.name,
          owner: p.owner?.name ?? null,
          percentDone: p.percentDone,
          daysLeft: p.daysLeft,
          open: p.open,
          overdue: p.overdue,
          link: p.href,
        })),
        link: `/my-department?department=${found.id}`,
      };
    }

    case 'getAssets': {
      const rows = await prisma.asset.findMany({
        where: {
          organizationId,
          ...(args.category ? { category: String(args.category).toUpperCase() as never } : {}),
        },
        select: {
          id: true,
          tag: true,
          name: true,
          category: true,
          status: true,
          condition: true,
          // The asset carries its holder directly; walking the movement log
          // to work out the same thing would be the same answer, slower.
          currentHolder: { select: { name: true } },
        },
        orderBy: { tag: 'asc' },
        take: limited(args.limit),
      });
      const mapped = rows.map((a) => ({
        tag: a.tag,
        name: a.name,
        category: a.category,
        status: a.status,
        condition: a.condition,
        heldBy: a.currentHolder?.name ?? null,
        link: rawLinkFor('Asset', a.id),
      }));
      return args.holder
        ? mapped.filter((a) => a.heldBy?.toLowerCase().includes(String(args.holder).toLowerCase()))
        : mapped;
    }

    default:
      if (isZenLookup(name)) return runZenLookup(name, args, organizationId);
      return { error: `There is no tool called "${name}".` };
  }
}
