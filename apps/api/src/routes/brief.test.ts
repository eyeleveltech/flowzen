import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { briefDetails, composeMondayBrief, forgetTrends, resolveWeek, trendsFor, weeksFor } from './brief.js';
import { generateBriefSummary } from '../services/briefSummary.js';
import { composeApprovalsReport } from '../services/approvalsReport.js';
import { sendMondayBriefs } from '../workers/brief.cron.js';
import { sendMail } from '../utils/mailer.js';
import { gemini } from '../services/ai/gemini.js';

/**
 * The Monday brief, against a hand-counted fortnight.
 *
 * "Now" is Wednesday 7 October 2026, 10:00 in Chennai. So last week is Monday
 * 28 September to Sunday 4 October, the week before is 21–27 September, and
 * coming up runs 7–14 October. Several fixtures sit a few minutes either side
 * of an IST midnight that is a different day in UTC, so a week cut in the
 * server's zone instead of the studio's gets them wrong.
 */

vi.mock('../services/approvalsReport.js', () => ({
  composeApprovalsReport: vi.fn(async (_org: string, range: { from: Date }) => ({
    byType: [
      {
        taskType: 'VIDEO',
        taskTypes: ['DESIGN', 'VIDEO'],
        allWork: true,
        // Last week decided 5, the week before 3.
        decided: range.from.toISOString() === '2026-09-27T18:30:00.000Z' ? 5 : 3,
        medianDecisionMinutes: 95,
        onTime: 4,
        escalated: 1,
      },
    ],
  })),
}));
vi.mock('../services/usageSummary.js', async (orig) => ({
  ...(await orig<object>()),
  notUsingLastWeek: vi.fn(async () => ({
    from: '2026-09-28',
    to: '2026-10-04',
    people: [{ id: 'u-s', name: 'Sneha', lastActiveAt: null, lastActive: null }],
    line: 'Sneha (never)',
  })),
}));
vi.mock('../utils/mailer.js', async (orig) => ({ ...(await orig<object>()), sendMail: vi.fn() }));

const NOW = new Date('2026-10-07T04:30:00Z'); // Wed 7 Oct, 10:00 IST
const ist = (local: string) => new Date(new Date(`${local}:00Z`).getTime() - 330 * 60_000);
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const ORG = {
  id: 'org-1',
  name: 'EyeLevel',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  departments: ['Design', 'Video', 'Development', 'Accounts'],
  aiProvider: 'GEMINI',
  aiApiKey: null as string | null,
  aiModel: 'gemini-2.5-flash',
  aiBaseUrl: null,
};

type Range = { gte?: Date; lt?: Date; lte?: Date };
const within = (d: Date | null | undefined, r?: Range) =>
  Boolean(d) && (!r?.gte || d! >= r.gte) && (!r?.lt || d! < r.lt) && (!r?.lte || d! <= r.lte);

/* ─── The fortnight ───────────────────────────────────────────────────── */

const paidOn = (id: string, number: string, client: string) => ({ id, number, company: { name: client } });
const PAYMENTS = [
  { id: 'pay-1', amount: 30000, receivedAt: day('2026-10-04'), invoice: paidOn('inv-a', 'INV-1', 'Acme') }, // Sunday — last week
  { id: 'pay-2', amount: 20000, receivedAt: day('2026-09-28'), invoice: paidOn('inv-b', 'INV-2', 'Beta') }, // Monday — last week
  { id: 'pay-3', amount: 99999, receivedAt: day('2026-10-05'), invoice: paidOn('inv-c', 'INV-3', 'Acme') }, // this week
  { id: 'pay-4', amount: 10000, receivedAt: day('2026-09-27'), invoice: paidOn('inv-d', 'INV-4', 'Gamma') }, // the week before
];
const RAISED = [
  { amount: 100000, raisedAt: day('2026-09-30'), status: 'RAISED' },
  { amount: 50000, raisedAt: day('2026-10-02'), status: 'CANCELLED' }, // never billed
  { amount: 40000, raisedAt: day('2026-09-25'), status: 'PAID' },
];
const version = (id: string, n: number, client: string) => ({ id, n, value: 50000 * n, proposal: { id: `p-${client}`, company: { name: client } } });
const SENT = [
  { ...version('v-1', 2, 'Acme'), sentAt: ist('2026-10-04T23:30') }, // Sunday night in Chennai — last week
  { ...version('v-2', 1, 'Beta'), sentAt: ist('2026-10-05T00:30') }, // Monday 00:30 IST — still Sunday in UTC, but this week
  { ...version('v-3', 1, 'Gamma'), sentAt: ist('2026-09-28T00:15') }, // Monday 00:15 IST — Sunday the 27th in UTC, but last week
  { ...version('v-4', 1, 'Delta'), sentAt: ist('2026-09-22T11:00') }, // the week before
];
const WON = [{ wonAt: ist('2026-10-01T10:30'), versions: [{ value: 250000 }] }];

/** The departments, as records, in Settings' order. */
const DEPARTMENTS = [
  { id: 'd-design', name: 'Design' },
  { id: 'd-video', name: 'Video' },
  { id: 'd-dev', name: 'Development' },
  { id: 'd-accounts', name: 'Accounts' },
];
const idOf = (name: string) => DEPARTMENTS.find((d) => d.name === name)!.id;
// A person's name rides along so the "no names" checks have something to catch.
const person = (dept: string, name: string) => ({ user: { departmentId: idOf(dept), name } });
const placed = (dept: string) => ({ departmentId: idOf(dept) });
const DONE = [
  // On time: finished the day before it was due.
  { completedAt: ist('2026-10-02T15:30'), dueDate: day('2026-10-03'), assignees: [person('Video', 'Ravi'), person('Video', 'Shyam')], assignee: placed('Video') },
  // On time: Sunday 23:30 IST, due that Sunday.
  { completedAt: ist('2026-10-04T23:30'), dueDate: day('2026-10-04'), assignees: [person('Design', 'Janani')], assignee: placed('Design') },
  // Late: 00:30 IST on the 30th for a task due the 29th — still the 29th in UTC.
  { completedAt: ist('2026-09-30T00:30'), dueDate: day('2026-09-29'), assignees: [person('Video', 'Ravi')], assignee: placed('Video') },
];
const OPEN = [
  // Overdue, two Video people on it — counted once for Video.
  { status: 'TODO', dueDate: day('2026-10-01'), waitingOn: null, assignees: [person('Video', 'Ravi'), person('Video', 'Shyam')], assignee: placed('Video') },
  // Past due but waiting on an approver: in review, NOT overdue.
  { status: 'IN_REVIEW', dueDate: day('2026-09-30'), waitingOn: null, assignees: [person('Video', 'Ravi')], assignee: placed('Video') },
  { status: 'ON_HOLD', dueDate: day('2026-10-20'), waitingOn: 'CLIENT', assignees: [person('Design', 'Janani')], assignee: placed('Design') },
  { status: 'IN_PROGRESS', dueDate: day('2026-10-09'), waitingOn: null, assignees: [person('Design', 'Janani')], assignee: placed('Design') },
  // No assignee rows: falls back to the task's own assignee.
  { status: 'TODO', dueDate: day('2026-10-10'), waitingOn: null, assignees: [], assignee: placed('Development') },
];

const ALERTS = [
  { id: 'a1', rule: 'INVOICE_OVERDUE', severity: 'MED', entityType: 'Invoice', entityId: 'inv-10', message: 'Invoice INV-10 for Acme is overdue (due date passed).', raisedAt: hoursAgo(4 * 24 + 2) },
  { id: 'a2', rule: 'INVOICE_AGING_60', severity: 'HIGH', entityType: 'Invoice', entityId: 'inv-70', message: 'Invoice INV-70 for Beta is overdue (>60 days).', raisedAt: hoursAgo(30 * 24) },
  { id: 'a3', rule: 'PROPOSAL_STALLED', severity: 'MED', entityType: 'Proposal', entityId: 'p-1', message: 'Proposal for Gamma has had no new version for 8 days.', raisedAt: hoursAgo(3 * 24) },
  { id: 'a4', rule: 'APPROVAL_ESCALATED', severity: 'HIGH', entityType: 'Task', entityId: 't-rev', message: '"Reel cut" has waited 2 days for approval with no answer — Round 1, by Ravi.', raisedAt: hoursAgo(10) },
  { id: 'a5', rule: 'PROJECT_BEHIND_SCHEDULE', severity: 'MED', entityType: 'Project', entityId: 'pr-1', message: 'Site for Acme is 60% through its timeline but only 20% of tasks are done.', raisedAt: hoursAgo(24) },
  { id: 'a6', rule: 'RETAINER_EXPIRING', severity: 'MED', entityType: 'Retainer', entityId: 'r-1', message: 'Retainer for Delta renewing in 20 days.', raisedAt: hoursAgo(24) },
  { id: 'a7', rule: 'CLIENT_QUIET', severity: 'LOW', entityType: 'Company', entityId: 'c-q', message: 'Quiet Co has had no task activity, contact logged, or invoice in 21 days.', raisedAt: hoursAgo(48) },
  // Not in the brief: the team block counts these, by department.
  { id: 'a8', rule: 'TASK_OVERDUE', severity: 'MED', entityType: 'Task', entityId: 't-x', message: 'Task "x" assigned to Ravi is overdue.', raisedAt: hoursAgo(5) },
];

const EVENTS = [
  { id: 'e1', kind: 'SHOOT', title: 'Product shoot', startsAt: ist('2026-10-09T10:00'), endsAt: ist('2026-10-09T14:00'), allDay: false, location: 'Studio B', deletedAt: null, company: { name: 'Acme' }, project: null, retainer: null, attendees: [{ user: { name: 'Ravi' } }, { user: { name: 'Janani' } }] },
  { id: 'e2', kind: 'OTHER', title: 'Team lunch', startsAt: ist('2026-10-08T13:00'), endsAt: ist('2026-10-08T14:00'), allDay: false, location: null, deletedAt: null, company: null, project: null, retainer: null, attendees: [] },
  { id: 'e3', kind: 'MEETING', title: 'Cancelled call', startsAt: ist('2026-10-08T11:00'), endsAt: ist('2026-10-08T12:00'), allDay: false, location: null, deletedAt: new Date(), company: null, project: null, retainer: null, attendees: [] },
  { id: 'e4', kind: 'MEETING', title: 'Too far out', startsAt: ist('2026-10-16T11:00'), endsAt: ist('2026-10-16T12:00'), allDay: false, location: null, deletedAt: null, company: null, project: null, retainer: null, attendees: [] },
];

/** The database, as far as the brief asks it. */
function seed() {
  const p = prisma as any;
  p.organization.findUnique.mockImplementation(async () => ORG);
  p.organization.findMany.mockResolvedValue([{ id: 'org-1', name: 'EyeLevel', timezone: 'Asia/Kolkata' }]);

  p.payment.findMany.mockImplementation(async ({ where }: any) => PAYMENTS.filter((x) => within(x.receivedAt, where.receivedAt)));
  p.proposalVersion.findMany.mockImplementation(async ({ where }: any) =>
    SENT.filter((x) => within(x.sentAt, where.sentAt)).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
  );
  p.payment.aggregate.mockImplementation(async ({ where }: any) => ({
    _sum: { amount: PAYMENTS.filter((x) => within(x.receivedAt, where.receivedAt)).reduce((s, x) => s + x.amount, 0) },
  }));
  p.invoice.aggregate.mockImplementation(async ({ where }: any) => {
    const rows = RAISED.filter((x) => within(x.raisedAt, where.raisedAt) && x.status !== where.status?.not);
    return { _sum: { amount: rows.reduce((s, x) => s + x.amount, 0) }, _count: { _all: rows.length } };
  });
  p.proposal.findMany.mockImplementation(async ({ where }: any) => {
    if (where.outcome === 'WON') return WON.filter((x) => within(x.wonAt, where.wonAt));
    return [{ id: 'p-1', company: { name: 'Gamma', owner: null }, owner: { name: 'Tanuja' }, versions: [{ value: 120000 }] }];
  });
  p.proposalVersion.count.mockImplementation(async ({ where }: any) => SENT.filter((x) => within(x.sentAt, where.sentAt)).length);
  p.task.findMany.mockImplementation(async ({ where }: any) => {
    if (where.status === 'DONE') return DONE.filter((x) => within(x.completedAt, where.completedAt));
    if (where.id) {
      return [
        {
          id: 't-rev',
          title: 'Reel cut',
          company: null,
          project: null,
          monthCard: { retainer: { company: { name: 'Acme' } } },
          reviews: [{ submittedAt: hoursAgo(50) }],
        },
      ];
    }
    return OPEN.filter((x) => where.status.in.includes(x.status));
  });
  p.peopleAllocation.groupBy.mockResolvedValue([
    { userId: 'u-video', _sum: { percent: 120 } },
    { userId: 'u-design', _sum: { percent: 80 } },
  ]);
  p.user.findMany.mockImplementation(async ({ where }: any) => {
    if (where.id) return [{ id: 'u-video', departmentId: 'd-video', name: 'Ravi' }].filter((u) => where.id.in.includes(u.id));
    return [
      { id: 'u-boss', email: 'boss@x', name: 'Akmal', preset: 'MANAGEMENT', permissions: [], active: true, organizationId: 'org-1' },
      { id: 'u-head', email: 'head@x', name: 'Charles', preset: 'HEAD', permissions: ['reports.read'], active: true, organizationId: 'org-1' },
    ];
  });

  p.alert.findMany.mockImplementation(async ({ where }: any) => ALERTS.filter((a) => where.rule.in.includes(a.rule)));
  p.invoice.findMany.mockImplementation(async ({ where }: any) => {
    // Raised in a range: the trend.
    if (where.raisedAt) return RAISED.filter((x) => within(x.raisedAt, where.raisedAt) && x.status !== where.status?.not);
    if (where.id) {
      return [
        {
          id: 'inv-10',
          amount: 50000,
          company: { name: 'Acme', owner: { name: 'Olga' } },
          payments: [{ amount: 10000 }],
          project: { owner: { name: 'Priya' } },
          monthCard: null,
        },
        {
          id: 'inv-70',
          amount: 30000,
          company: { name: 'Beta', owner: null },
          payments: [],
          project: null,
          monthCard: { retainer: { owner: { name: 'Rhea' } } },
        },
      ].filter((i) => where.id.in.includes(i.id));
    }
    // Coming up: due in the next seven days.
    return [
      { id: 'inv-due', number: 'INV-20', amount: 20000, dueAt: day('2026-10-09'), company: { name: 'Acme' }, payments: [] },
      { id: 'inv-paid', number: 'INV-21', amount: 5000, dueAt: day('2026-10-10'), company: { name: 'Beta' }, payments: [{ amount: 5000 }] },
    ].filter((i) => within(i.dueAt, where.dueAt));
  });
  p.project.findMany.mockImplementation(async ({ where }: any) => {
    if (where.id) return [{ id: 'pr-1', company: { name: 'Acme', owner: null }, owner: { name: 'Charles' } }];
    return [{ id: 'pr-end', name: 'Brand film', endDate: day('2026-10-12'), company: { name: 'Delta' }, owner: { name: 'Charles' } }].filter(
      (x) => within(x.endDate, where.endDate),
    );
  });
  p.retainer.findMany.mockResolvedValue([
    { id: 'r-1', monthlyValue: 80000, renewalDate: day('2026-10-27'), company: { name: 'Delta', owner: null }, owner: { name: 'Akmal' } },
  ]);
  p.company.findMany.mockResolvedValue([{ id: 'c-q', name: 'Quiet Co', owner: null }]);
  p.calendarEvent.findMany.mockImplementation(async ({ where }: any) =>
    EVENTS.filter((e) => where.kind.in.includes(e.kind) && e.deletedAt === null && within(e.startsAt, where.startsAt)),
  );
  p.weeklyBrief.findUnique.mockResolvedValue(null);
  p.department.findMany.mockResolvedValue(DEPARTMENTS);
  p.weeklyBrief.upsert.mockResolvedValue({});
  p.activity.create.mockResolvedValue({});
}

beforeEach(() => {
  ORG.aiApiKey = null;
  forgetTrends();
  seed();
});

const STAFF = ['Ravi', 'Shyam', 'Janani', 'Priya', 'Olga', 'Rhea', 'Tanuja', 'Charles', 'Akmal', 'Sneha'];

describe('the weeks', () => {
  it('are Monday to Sunday on the studio calendar', () => {
    expect(weeksFor('Asia/Kolkata', NOW)).toEqual({
      today: '2026-10-07',
      weekStart: '2026-10-05',
      last: { from: '2026-09-28', to: '2026-10-04' },
      before: { from: '2026-09-21', to: '2026-09-27' },
      comingUntil: '2026-10-14',
    });
    // Monday 00:30 IST is still Sunday in UTC — but it is already the new week.
    expect(weeksFor('Asia/Kolkata', ist('2026-10-05T00:30')).weekStart).toBe('2026-10-05');
  });
});

describe('composeMondayBrief', () => {
  it('adds up last week against the week before, cutting weeks at IST midnight', async () => {
    const brief = await composeMondayBrief('org-1', { now: NOW });
    const s = brief.scoreboard;
    expect(s.cashCollected).toEqual({ last: 50000, before: 10000 });
    expect(s.invoiced).toEqual({ last: { amount: 100000, count: 1 }, before: { amount: 40000, count: 1 } });
    expect(s.dealsWon).toEqual({ last: { count: 1, value: 250000 }, before: { count: 0, value: 0 } });
    expect(s.proposalsSent).toEqual({ last: 2, before: 1 });
    // Three done, two on time — the 00:30 IST finish is a day late.
    expect(s.tasksDone.last).toEqual({ count: 3, onTime: 2 });

    // Approvals from the approvals report, for exactly last week in IST.
    expect(s.approvals).toEqual([
      {
        group: 'All work',
        last: { decided: 5, medianDecisionMinutes: 95, onTime: 4, escalated: 1 },
        before: { decided: 3, medianDecisionMinutes: 95, onTime: 4, escalated: 1 },
      },
    ]);
    const ranges = vi.mocked(composeApprovalsReport).mock.calls.map((c) => [c[1].from.toISOString(), c[1].to.toISOString()]);
    expect(ranges).toContainEqual(['2026-09-27T18:30:00.000Z', '2026-10-04T18:29:59.999Z']);
  });

  it('groups the open alerts the way the bell has them, enriched in batches', async () => {
    const brief = await composeMondayBrief('org-1', { now: NOW });
    const groups = Object.fromEntries(brief.needsAction.map((g) => [g.group, g.items]));
    expect(Object.keys(groups)).toEqual(['Money to collect', 'Sales follow-ups', 'Stuck approvals']);

    // The invoice ten days late is there — the old brief only showed 30+.
    expect(groups['Money to collect']).toEqual([
      // Worst first, then the most money.
      expect.objectContaining({ alertId: 'a2', clientName: 'Beta', amount: 30000, ownerName: 'Rhea', severity: 'HIGH', link: '/money' }),
      expect.objectContaining({
        alertId: 'a1',
        clientName: 'Acme',
        title: 'Invoice INV-10 is overdue (due date passed).',
        amount: 40000,
        ownerName: 'Priya',
        flaggedDaysAgo: 4,
        link: '/money',
      }),
    ]);
    expect(groups['Sales follow-ups'][0]).toMatchObject({ clientName: 'Gamma', amount: 120000, ownerName: 'Tanuja', link: '/quotations' });

    // A stuck approval: the video, its client, how long — and never the editor.
    const stuck = groups['Stuck approvals'][0];
    expect(stuck).toMatchObject({ title: 'Reel cut — waiting 2 days', clientName: 'Acme', link: '/my-work?task=t-rev' });
    expect(stuck.ownerName).toBeUndefined();
    expect(JSON.stringify(brief.needsAction)).not.toContain('Ravi');

    expect(brief.risks).toEqual([
      { group: 'Delivery', items: [expect.objectContaining({ clientName: 'Acme', title: 'Site is 60% through its timeline but only 20% of tasks are done.', ownerName: 'Charles', link: '/projects/pr-1' })] },
      { group: 'Clients', items: [expect.objectContaining({ clientName: 'Quiet Co', link: '/companies/c-q' })] },
    ]);
    // TASK_OVERDUE is never asked for.
    expect((prisma.alert.findMany as any).mock.calls[0][0].where.rule.in).not.toContain('TASK_OVERDUE');
    // One query per kind of record, not one per row.
    expect((prisma.invoice.findMany as any).mock.calls.filter((c: any) => c[0].where.id)).toHaveLength(1);
  });

  it('looks seven days ahead: shoots and meetings, invoices due, projects ending, renewals', async () => {
    const { comingUp } = await composeMondayBrief('org-1', { now: NOW });
    // The OTHER event, the deleted meeting and the one nine days out are not here.
    expect(comingUp.events).toEqual([
      expect.objectContaining({
        kind: 'SHOOT',
        clientName: 'Acme',
        when: 'Fri 9 Oct 10:00–14:00',
        location: 'Studio B',
        people: ['Ravi', 'Janani'],
        link: '/calendar?event=e1',
      }),
    ]);
    expect(comingUp.invoicesDue).toEqual([
      { id: 'inv-due', clientName: 'Acme', number: 'INV-20', balance: 20000, dueAt: '2026-10-09', link: '/money' },
    ]);
    expect(comingUp.projectsEnding).toEqual([expect.objectContaining({ name: 'Brand film', clientName: 'Delta', endDate: '2026-10-12', link: '/projects/pr-end' })]);
    expect(comingUp.renewals).toEqual([
      expect.objectContaining({ clientName: 'Delta', renewalDate: '2026-10-27', monthlyValue: 80000, ownerName: 'Akmal', link: '/retainers/r-1' }),
    ]);
  });

  it('counts the team by department, with no names, and an approval wait is not overdue', async () => {
    const { team } = await composeMondayBrief('org-1', { now: NOW });
    expect(team).toEqual([
      {
        departmentId: 'd-design', dept: 'Design', active: 1, overdue: 0, dueThisWeek: 1, doneLastWeek: 1, waitingOnClient: 1, inReview: 0, overAllocatedPeople: 0,
        segments: { overdue: 0, onTrack: 1, inReview: 0, waitingOnClient: 1 },
      },
      // Overdue 1, not 2: the IN_REVIEW task past its date is in review, not overdue.
      {
        departmentId: 'd-video', dept: 'Video', active: 1, overdue: 1, dueThisWeek: 0, doneLastWeek: 2, waitingOnClient: 0, inReview: 1, overAllocatedPeople: 1,
        segments: { overdue: 1, onTrack: 0, inReview: 1, waitingOnClient: 0 },
      },
      {
        departmentId: 'd-dev', dept: 'Development', active: 1, overdue: 0, dueThisWeek: 1, doneLastWeek: 0, waitingOnClient: 0, inReview: 0, overAllocatedPeople: 0,
        segments: { overdue: 0, onTrack: 1, inReview: 0, waitingOnClient: 0 },
      },
      // Accounts has nothing, so it is left out.
    ]);
    for (const name of STAFF) expect(JSON.stringify(team)).not.toContain(name);
  });

  it('keeps "Not using Flowzen" for Management only', async () => {
    expect((await composeMondayBrief('org-1', { now: NOW, includeUsage: true })).notUsingFlowzen?.line).toBe('Sneha (never)');
    expect((await composeMondayBrief('org-1', { now: NOW })).notUsingFlowzen).toBeNull();
  });
});

describe('the summary', () => {
  it('is skipped, and nothing is saved, when AI is not set up', async () => {
    const complete = vi.spyOn(gemini, 'complete');
    const brief = await composeMondayBrief('org-1', { now: NOW });
    expect(await generateBriefSummary('org-1', brief)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(prisma.weeklyBrief.upsert).not.toHaveBeenCalled();
    complete.mockRestore();
  });

  it('is written from numbers and clients only — no staff, no usage block — and saved for the week', async () => {
    ORG.aiApiKey = 'key';
    const complete = vi.spyOn(gemini, 'complete').mockResolvedValue({ text: 'Cash in rose to ₹50,000.', calls: [], stop: 'end' });
    const brief = await composeMondayBrief('org-1', { now: NOW, includeUsage: true });
    const written = await generateBriefSummary('org-1', brief);
    const sent = complete.mock.calls[0][0].turns[0];
    complete.mockRestore();

    expect(written?.text).toBe('Cash in rose to ₹50,000.');
    const saved = (prisma.weeklyBrief.upsert as any).mock.calls[0][0];
    expect(saved.where.organizationId_weekStart.weekStart.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(saved.create.summaryInput.scoreboard.cashCollected).toEqual({ lastWeek: 50000, weekBefore: 10000 });
    for (const text of [JSON.stringify(sent), JSON.stringify(saved.create.summaryInput)]) {
      for (const name of STAFF) expect(text).not.toContain(name);
      expect(text).not.toContain('Not using');
    }
    // Clients are fine.
    expect(JSON.stringify(saved.create.summaryInput)).toContain('Acme');
  });
});

describe('GET /api/brief/monday', () => {
  const as = (preset: RolePreset, permissions: string[]) => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u-1', organizationId: 'org-1', name: 'Reader', email: 'r@x', preset, permissions, active: true, sessionsValidFrom: null,
    });
    return ['Authorization', `Bearer ${signJwt({ userId: 'u-1', organizationId: 'org-1', email: 'r@x', preset, permissions })}`] as const;
  };

  it('shows "Not using Flowzen" to Management and not to another reports.read reader', async () => {
    const boss = await request(app).get('/api/brief/monday').set(...as(RolePreset.MANAGEMENT, [...ROLE_PRESET_PERMISSIONS.MANAGEMENT]));
    expect(boss.status).toBe(200);
    expect(boss.body.notUsingFlowzen.line).toBe('Sneha (never)');
    expect(boss.body.needsAction.length).toBeGreaterThan(0);

    const head = await request(app).get('/api/brief/monday').set(...as(RolePreset.HEAD, ['work.own', 'reports.read']));
    expect(head.status).toBe(200);
    expect(head.body.notUsingFlowzen).toBeNull();
    // A link is only given where the reader can follow it: /money needs money.figures.
    expect(head.body.needsAction[0].items[0].link).toBeNull();
  });
});

describe('the Monday mail', () => {
  it('waits for 07:00 in Chennai, sends once, and not again', async () => {
    let mailed: unknown = null;
    (prisma.activity.findFirst as any).mockImplementation(async () => mailed);
    (prisma.activity.create as any).mockImplementation(async (args: unknown) => (mailed = args));

    // Monday 06:59 IST.
    expect(await sendMondayBriefs(ist('2026-10-05T06:59'))).toEqual({ sent: 0 });
    expect(sendMail).not.toHaveBeenCalled();

    // 07:00 IST: Management and the Head both get it; only Management sees who isn't using Flowzen.
    expect(await sendMondayBriefs(ist('2026-10-05T07:00'))).toEqual({ sent: 2 });
    const html = Object.fromEntries(vi.mocked(sendMail).mock.calls.map(([, m]: any) => [m.to, m.html as string]));
    expect(html['boss@x']).toContain('Not using Flowzen');
    expect(html['boss@x']).toContain('Sneha (never)');
    expect(html['head@x']).not.toContain('Not using Flowzen');
    expect(html['head@x']).toContain('Needs your action');
    expect(html['head@x']).toContain('/my-work?task=t-rev');

    // And an hour later, nothing more.
    expect(await sendMondayBriefs(ist('2026-10-05T08:00'))).toEqual({ sent: 0 });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});

describe('trends', () => {
  it('gives each figure for the 8 weeks ending at the shown one, cut at IST midnight', async () => {
    const t = await trendsFor('org-1', '2026-09-28', 'Asia/Kolkata', NOW);
    const weeks = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
    const values = (points: { weekStart: string; value: number | null }[]) => {
      expect(points.map((x) => x.weekStart)).toEqual(weeks);
      return points.map((x) => x.value);
    };
    expect(values(t.cashCollected)).toEqual([0, 0, 0, 0, 0, 0, 10000, 50000]);
    expect(values(t.invoiced)).toEqual([0, 0, 0, 0, 0, 0, 40000, 100000]);
    expect(values(t.dealsWon)).toEqual([0, 0, 0, 0, 0, 0, 0, 250000]);
    // Sunday 23:30 and Monday 00:15 IST both in the week of the 28th; Monday 5 Oct 00:30 IST in none of these.
    expect(values(t.proposalsSent)).toEqual([0, 0, 0, 0, 0, 0, 1, 2]);
    expect(values(t.tasksDone)).toEqual([0, 0, 0, 0, 0, 0, 0, 3]);
    expect(t.approvals).toEqual([{ group: 'All work', points: weeks.map((w) => ({ weekStart: w, value: 95 })) }]);

    // The last point is the scoreboard's own number.
    const brief = await composeMondayBrief('org-1', { now: NOW });
    expect(t.cashCollected.at(-1)!.value).toBe(brief.scoreboard.cashCollected.last);
    expect(t.tasksDone.at(-1)!.value).toBe(brief.scoreboard.tasksDone.last.count);
  });

  it('is asked once and then held for ten minutes', async () => {
    await trendsFor('org-1', '2026-09-28', 'Asia/Kolkata', NOW);
    await trendsFor('org-1', '2026-09-28', 'Asia/Kolkata', new Date(NOW.getTime() + 9 * 60_000));
    expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
    await trendsFor('org-1', '2026-09-28', 'Asia/Kolkata', new Date(NOW.getTime() + 11 * 60_000));
    expect(prisma.payment.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('the rows behind a number', () => {
  const lastWeek = { from: '2026-09-28', to: '2026-10-04' };

  it('lists exactly the payments that make up cash collected, each with a link', async () => {
    const brief = await composeMondayBrief('org-1', { now: NOW });
    const cash = await briefDetails('org-1', 'cash', lastWeek);
    expect(cash.rows).toEqual([
      { id: 'pay-1', date: '2026-10-04', clientName: 'Acme', number: 'INV-1', amount: 30000, link: '/money' },
      { id: 'pay-2', date: '2026-09-28', clientName: 'Beta', number: 'INV-2', amount: 20000, link: '/money' },
    ]);
    expect((cash.rows as { amount: number }[]).reduce((sum, r) => sum + r.amount, 0)).toBe(brief.scoreboard.cashCollected.last);

    const sent = await briefDetails('org-1', 'proposals', lastWeek);
    expect(sent.rows).toHaveLength(brief.scoreboard.proposalsSent.last);
    expect(sent.rows).toEqual([
      expect.objectContaining({ clientName: 'Gamma', version: 1, date: '2026-09-28', link: '/quotations' }),
      expect.objectContaining({ clientName: 'Acme', version: 2, date: '2026-10-04', link: '/quotations' }),
    ]);
  });

  it('gives tasks done by department only — no names, no task list', async () => {
    const tasks = await briefDetails('org-1', 'tasks', lastWeek);
    expect(tasks.rows).toEqual([
      { departmentId: 'd-design', dept: 'Design', done: 1, onTime: 1 },
      { departmentId: 'd-video', dept: 'Video', done: 2, onTime: 1 },
    ]);
    expect((tasks as { total: unknown }).total).toEqual({ done: 3, onTime: 2 });
    for (const name of STAFF) expect(JSON.stringify(tasks)).not.toContain(name);
  });
});

describe('the week switcher', () => {
  it('takes a Monday up to 26 weeks back, and nothing else', () => {
    const latest = weeksFor('Asia/Kolkata', NOW).last.from; // 2026-09-28
    expect(resolveWeek('Asia/Kolkata', NOW)).toMatchObject({ from: latest, current: true });
    expect(resolveWeek('Asia/Kolkata', NOW, '2026-03-30')).toMatchObject({ from: '2026-03-30', current: false }); // 26 back
    expect(resolveWeek('Asia/Kolkata', NOW, '2026-03-23')).toBeNull(); // 27 back
    expect(resolveWeek('Asia/Kolkata', NOW, '2026-10-05')).toBeNull(); // not finished yet
    expect(resolveWeek('Asia/Kolkata', NOW, '2026-09-29')).toBeNull(); // a Tuesday
    expect(resolveWeek('Asia/Kolkata', NOW, 'soon')).toBeNull();
  });

  it('shows a past week as its scoreboard and stored summary only', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u-1', organizationId: 'org-1', name: 'Reader', email: 'r@x', preset: 'MANAGEMENT', permissions: [...ROLE_PRESET_PERMISSIONS.MANAGEMENT], active: true, sessionsValidFrom: null,
    });
    const token = signJwt({ userId: 'u-1', organizationId: 'org-1', email: 'r@x', preset: RolePreset.MANAGEMENT, permissions: [...ROLE_PRESET_PERMISSIONS.MANAGEMENT] });
    const latest = weeksFor('Asia/Kolkata', new Date()).last.from;
    const past = addDaysTo(latest, -14);
    (prisma.weeklyBrief.findUnique as any).mockImplementation(async ({ where }: any) =>
      where.organizationId_weekStart.weekStart.toISOString().slice(0, 10) === addDaysTo(past, 7)
        ? { summary: 'That week, written then.', summaryModel: 'm', generatedAt: new Date() }
        : null,
    );

    const res = await request(app).get(`/api/brief/monday?week=${past}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.week).toMatchObject({ shown: past, current: false, latest });
    expect(res.body.summary.text).toBe('That week, written then.');
    expect(res.body.scoreboard.cashCollected).toBeDefined();
    expect(res.body.trends.cashCollected).toHaveLength(8);
    for (const now of ['needsAction', 'risks', 'comingUp', 'team', 'notUsingFlowzen']) expect(res.body[now]).toBeNull();

    const tooFar = await request(app).get(`/api/brief/monday?week=${addDaysTo(latest, -27 * 7)}`).set('Authorization', `Bearer ${token}`);
    expect(tooFar.status).toBe(400);
    const details = await request(app).get(`/api/brief/monday/details?metric=tasks&week=${latest}`).set('Authorization', `Bearer ${token}`);
    expect(details.status).toBe(200);
    expect((await request(app).get(`/api/brief/monday/details?metric=salaries`).set('Authorization', `Bearer ${token}`)).status).toBe(400);
  });
});

function addDaysTo(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
