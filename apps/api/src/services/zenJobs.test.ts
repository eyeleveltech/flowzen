import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { runZenJob, type ZenCard } from './zenJobs.js';

/*
 * The clash check and the approver rule are tested where they live; here they
 * are stand-ins, so what is tested is what the jobs do with them.
 */
const findClashes = vi.fn(async (_opts: Record<string, unknown>) => [] as { message: string }[]);
vi.mock('./calendarEvents.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./calendarEvents.js')>();
  return { ...real, findClashes: (opts: Record<string, unknown>) => findClashes(opts) };
});
const approveRefusal = vi.fn(async () => null as string | null);
vi.mock('./taskApprovals.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./taskApprovals.js')>();
  return { ...real, approveRefusal: () => approveRefusal() };
});
vi.mock('../utils/mailer.js', () => ({ resolveMailConfig: vi.fn(async () => ({ host: 'x' })) }));

/**
 * Zen's jobs (Zen Plan 4): it prepares, the person clicks.
 *
 *   · words become ids, or come back as `needs` with real candidates;
 *   · each job keeps its rules — no "done" for a task that needs approval,
 *     feedback before sending work back, gear only on a shoot, no cancelling;
 *   · money documents are forms, never requests;
 *   · and nothing here writes a single row.
 */

const ORG = 'org-1';
const ME = 'u-boss';
const NOW = new Date('2026-10-02T09:00:00+05:30');
const p = prisma as any;
const run = (name: Parameters<typeof runZenJob>[0], args: Record<string, unknown>) => runZenJob(name, args, ORG, ME, NOW);
const plan = (out: { cards?: ZenCard[] }) => out.cards?.[0] as Extract<ZenCard, { type: 'plan' }>;

const TEAM = [
  { id: 'u-boss', name: 'Akmal', dept: 'Management' },
  { id: 'u-janani', name: 'Janani', dept: 'Design' },
  { id: 'u-ravi', name: 'Ravi', dept: 'Video' },
  { id: 'u-ravik', name: 'Ravi Kumar', dept: 'Video' },
];
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  title: 'Reel cut',
  status: 'TODO',
  dueDate: new Date('2026-10-03T00:00:00Z'),
  needsApproval: false,
  createdById: 'u-janani',
  taskType: 'VIDEO',
  repeat: null,
  assignees: [{ user: { id: 'u-janani', name: 'Janani' } }],
  monthCard: null,
  project: null,
  ...over,
});

beforeEach(() => {
  findClashes.mockClear();
  approveRefusal.mockReset();
  approveRefusal.mockResolvedValue(null);
  p.user.findMany.mockResolvedValue(TEAM);
  p.user.findUnique.mockResolvedValue({ name: 'Akmal' });
  p.organization.findUnique.mockResolvedValue({ name: 'EyeLevel', timezone: 'Asia/Kolkata', workingDays: [1, 2, 3, 4, 5, 6], holidays: [] });
  p.company.findFirst.mockResolvedValue(null);
  p.company.findMany.mockResolvedValue([{ id: 'co-1', name: 'Acme' }]);
});

/** Every write a job could reach for — none may ever be called. */
const WRITES = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];
const MODELS = ['task', 'taskReview', 'proposal', 'proforma', 'invoice', 'retainer', 'project', 'monthCard', 'calendarEvent', 'activity', 'alert', 'cost'];
const noWrites = () => {
  for (const m of MODELS) for (const w of WRITES) expect(p[m][w], `${m}.${w}`).not.toHaveBeenCalled();
};

describe('resolving words', () => {
  it('asks rather than guesses a date', async () => {
    const out = await run('prepareTaskChanges', { person: 'Janani', newDueDate: 'Monday' });
    expect(out.result).toMatchObject({ needs: ['newDueDate'] });
    expect(out.cards).toBeUndefined();
  });

  it('asks which person, with the real team, when a name matches two', async () => {
    p.task.findMany.mockResolvedValue([]);
    const out = await run('prepareTaskChanges', { person: 'Ravi', newDueDate: '2026-10-05' });
    // "Ravi" is exact for one person, so that one is taken…
    expect(out.result).not.toMatchObject({ needs: ['people'] });
    const two = await run('prepareTaskChanges', { person: 'Rav', newDueDate: '2026-10-05' });
    expect(two.result).toMatchObject({ needs: ['people'], candidates: { team: ['Ravi — Video', 'Ravi Kumar — Video'] } });
  });

  it('asks which client when the name is not one', async () => {
    p.company.findMany.mockResolvedValue([]);
    const out = await run('prepareMonthClose', { client: 'Zeta' });
    expect(out.result).toMatchObject({ needs: ['client'] });
  });
});

describe('task changes', () => {
  it('moves a set of tasks as one grouped step, one request each', async () => {
    p.task.findMany.mockResolvedValue([task(), task({ id: 't2', title: 'Poster' })]);
    const out = await run('prepareTaskChanges', { person: 'Janani', dueOn: '2026-10-03', newDueDate: '2026-10-05' });
    const steps = plan(out).steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'post', label: 'Move 2 tasks to Mon 5 Oct' });
    expect((steps[0] as any).items.map((i: any) => i.request)).toEqual([
      { method: 'PATCH', path: '/tasks/t1', body: { dueDate: '2026-10-05' } },
      { method: 'PATCH', path: '/tasks/t2', body: { dueDate: '2026-10-05' } },
    ]);
    noWrites();
  });

  it('never offers "done" for a task that needs approval', async () => {
    p.task.findMany.mockResolvedValue([task({ needsApproval: true })]);
    const out = await run('prepareTaskChanges', { task: 'Reel', setStatus: 'DONE' });
    expect(out.cards).toBeUndefined();
    expect(JSON.stringify(out.result)).toMatch(/needs approval/);
  });

  it('offers sending it for approval instead, to somebody on it', async () => {
    p.task.findMany.mockResolvedValue([task({ needsApproval: true, assignees: [{ user: { id: ME, name: 'Akmal' } }] })]);
    const out = await run('prepareTaskChanges', { task: 'Reel', setStatus: 'DONE' });
    const steps = plan(out).steps as any[];
    expect(steps.map((s) => s.items[0].request.path)).toEqual(['/tasks/t1/submit-review']);
  });

  it('leaves out a task waiting for approval', async () => {
    p.task.findMany.mockResolvedValue([task(), task({ id: 't2', title: 'Waiting one', status: 'IN_REVIEW' })]);
    const out = await run('prepareTaskChanges', { person: 'Janani', newDueDate: '2026-10-05' });
    expect((plan(out).steps[0] as any).items).toHaveLength(1);
    expect(plan(out).warnings?.[0]).toMatch(/Waiting one: waiting for approval/);
  });

  it('says only this copy of a repeating task moves', async () => {
    p.task.findMany.mockResolvedValue([task({ repeat: { stoppedAt: null, frequency: 'WEEKLY' } })]);
    const out = await run('prepareTaskChanges', { task: 'Reel', newDueDate: '2026-10-03' });
    expect((plan(out).steps[0] as any).items[0].detail).toBe('Only this copy moves; the repeat continues.');
  });

  it('stops a repeat with the field the task form uses', async () => {
    p.task.findMany.mockResolvedValue([task({ repeat: { stoppedAt: null, frequency: 'WEEKLY' } })]);
    const out = await run('prepareTaskChanges', { task: 'Reel', repeat: 'STOP' });
    expect((plan(out).steps[0] as any).items[0].request.body).toEqual({ repeat: null });
  });
});

describe('approvals', () => {
  beforeEach(() => {
    p.task.findMany.mockResolvedValue([task({ status: 'IN_REVIEW' })]);
    p.taskReview.findFirst.mockResolvedValue({ round: 1, submittedAt: new Date('2026-10-01'), escalatedAt: null, link: null, note: null, submittedBy: { name: 'Janani' } });
  });

  it('asks what to fix before sending work back', async () => {
    const out = await run('prepareApproval', { task: 'Reel', decision: 'REQUEST_CHANGES' });
    expect(out.result).toMatchObject({ needs: ['feedback'] });
  });

  it('sends the feedback with the request', async () => {
    const out = await run('prepareApproval', { task: 'Reel', decision: 'REQUEST_CHANGES', feedback: 'Trim the intro' });
    expect((plan(out).steps[0] as any).items[0].request).toEqual({ method: 'POST', path: '/tasks/t1/request-changes', body: { feedback: 'Trim the intro' } });
  });

  it('says so, with no card, when this person may not decide it', async () => {
    approveRefusal.mockResolvedValue("You're on this task, so you can't approve it.");
    const out = await run('prepareApproval', { task: 'Reel', decision: 'APPROVE' });
    expect(out.cards).toBeUndefined();
    expect(out.result).toMatchObject({ cannot: "You're on this task, so you can't approve it." });
  });
});

describe('follow-up messages', () => {
  beforeEach(() => {
    p.invoice.findMany.mockResolvedValue([
      { id: 'i1', number: 'INV/7', amount: 30000, dueAt: new Date('2026-09-06'), payments: [] },
    ]);
  });

  it('goes to the payer, names the invoice, and is never sent by Flowzen', async () => {
    p.person.findMany.mockResolvedValue([
      { name: 'Suhail Ahmed', role: 'APPROVER', phone: '9800000000', email: 's@acme.in' },
      { name: 'Meera Rao', role: 'PAYER', phone: '98765 43210', email: null },
    ]);
    const out = await run('prepareFollowUp', { about: 'INVOICE', client: 'Acme' });
    const msg = out.cards?.[0] as Extract<ZenCard, { type: 'message' }>;
    expect(msg.to?.name).toBe('Meera Rao');
    expect(msg.text).toContain('INV/7');
    expect(msg.text).toContain('₹30,000');
    expect(msg.text).toContain('Sun 6 Sept');
    expect(msg.whatsapp.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    expect(out.result).toMatchObject({ sentByFlowzen: false });
    noWrites();
  });

  it('asks which contact when there are two payers', async () => {
    p.person.findMany.mockResolvedValue([
      { name: 'Meera Rao', role: 'PAYER', phone: '9876543210', email: null },
      { name: 'Anil Rao', role: 'PAYER', phone: null, email: 'a@acme.in' },
    ]);
    const out = await run('prepareFollowUp', { about: 'INVOICE', client: 'Acme' });
    expect(out.result).toMatchObject({ needs: ['to'] });
  });
});

describe('sales steps', () => {
  beforeEach(() => {
    p.proposal.findMany.mockResolvedValue([
      {
        id: 'pr1',
        kind: 'RETAINER',
        stage: 'IN_NEGOTIATION',
        outcome: null,
        wonVersionId: null,
        versions: [
          { id: 'v2', n: 2, value: 45000, scopeSummary: 'Social, trimmed' },
          { id: 'v1', n: 1, value: 50000, scopeSummary: 'Social' },
        ],
      },
    ]);
    p.retainer.findMany.mockResolvedValue([]);
    p.project.findMany.mockResolvedValue([]);
  });

  it('marks won from the card, then opens the retainer form only once that is done', async () => {
    const out = await run('prepareSalesStep', { client: 'Acme', action: 'WON', version: 2 });
    const [win, form] = plan(out).steps as any[];
    expect(win.items[0].request).toEqual({ method: 'POST', path: '/proposals/pr1/win', body: { versionId: 'v2' } });
    expect(form).toMatchObject({ kind: 'form', after: [0], form: { name: 'retainer', values: { monthlyValue: 45000, sourceProposalId: 'pr1' } } });
    noWrites();
  });

  it('asks which version when there are several', async () => {
    const out = await run('prepareSalesStep', { client: 'Acme', action: 'WON' });
    expect(out.result).toMatchObject({ needs: ['version'] });
  });

  it('asks why it was lost, from the real list', async () => {
    const out = await run('prepareSalesStep', { client: 'Acme', action: 'LOST' });
    expect(out.result).toMatchObject({ needs: ['reason'] });
    expect((out.result as any).candidates.reasons).toContain('Price Too High');
  });

  it('only flags verbal yes once a proforma is issued', async () => {
    const out = await run('prepareSalesStep', { client: 'Acme', action: 'VERBAL_YES' });
    expect(out.cards).toBeUndefined();
    expect(JSON.stringify(out.result)).toMatch(/once a proforma has been issued/);
  });

  it('raises a proforma as a form, never a request', async () => {
    const out = await run('prepareSalesStep', { client: 'Acme', action: 'RAISE_PROFORMA' });
    expect(plan(out).steps[0]).toMatchObject({ kind: 'form', form: { name: 'proposalProforma', values: { proposalId: 'pr1', amount: 45000 } } });
  });
});

describe('closing a month', () => {
  beforeEach(() => {
    p.monthCard.findFirst.mockResolvedValue({
      id: 'mc-9',
      status: 'OPEN',
      closedAt: null,
      revenue: 30000,
      retainerId: 'r1',
      retainer: { billing: 'IN_ADVANCE' },
      invoice: null,
      costs: [],
      tasks: [task(), task({ id: 't2', title: 'Approval one', needsApproval: true }), task({ id: 't3', title: 'In review', status: 'IN_REVIEW' })],
    });
    p.proforma.findFirst.mockResolvedValue(null);
  });

  it('goes tasks, costs, proforma, invoice, close — in that order', async () => {
    const out = await run('prepareMonthClose', { client: 'Acme', month: '2026-10' });
    expect(plan(out).steps.map((s) => s.kind)).toEqual(['post', 'link', 'form', 'form', 'note']);
    noWrites();
  });

  it('offers no "done" for a task that needs approval, and leaves review to the approver', async () => {
    const out = await run('prepareMonthClose', { client: 'Acme', month: '2026-10' });
    const items = (plan(out).steps[0] as any).items;
    expect(items).toHaveLength(2);
    expect(items[1].options.map((o: any) => o.label)).not.toContain('Mark done');
    expect(plan(out).notes?.[0]).toMatch(/In review/);
  });

  it('only links to costs — Zen never enters one', async () => {
    const out = await run('prepareMonthClose', { client: 'Acme', month: '2026-10' });
    expect(plan(out).steps[1]).toMatchObject({ kind: 'link', href: '/retainers/r1?month=2026-10&tab=costs' });
  });

  it('has no close button to press: the month closes on the 1st', async () => {
    const out = await run('prepareMonthClose', { client: 'Acme', month: '2026-10' });
    expect((plan(out).steps.at(-1) as any).label).toMatch(/closes by itself on 1 November 2026/);
  });

  it('never moves a task into the past', async () => {
    const out = await run('prepareMonthClose', { client: 'Acme', month: '2026-09' });
    const move = (plan(out).steps[0] as any).items[0].options[0];
    expect(move.request.body.dueDate >= '2026-10-03').toBe(true);
  });
});

describe('meetings and shoots', () => {
  it('never cancels: it gives the link', async () => {
    p.calendarEvent.findMany.mockResolvedValue([
      { id: 'ev1', title: 'Acme review', kind: 'MEETING', startsAt: new Date(), endsAt: new Date(Date.now() + 3600e3), allDay: false, attendees: [], reservations: [] },
    ]);
    const out = await run('prepareEvent', { action: 'CANCEL', event: 'Acme review' });
    expect(out.cards).toBeUndefined();
    expect(out.result).toMatchObject({ link: '/calendar?event=ev1' });
  });

  it('books with the request the calendar form sends, and shows clashes before the click', async () => {
    p.person.findMany.mockResolvedValue([{ id: 'pe-rao', name: 'Mr Rao' }]);
    findClashes.mockResolvedValueOnce([{ message: 'Akmal is busy (Google Calendar) 10:00–10:30' }]);
    const out = await run('prepareEvent', {
      action: 'BOOK',
      kind: 'MEETING',
      title: 'Acme review',
      date: '2026-10-09',
      start: '10:00',
      people: ['Akmal'],
      client: 'Acme',
      contacts: ['Mr Rao'],
      place: 'Board room',
    });
    const c = plan(out);
    expect((c.steps[0] as any).items[0].request).toMatchObject({
      method: 'POST',
      path: '/calendar/events',
      body: { startsAt: '2026-10-09T10:00', endsAt: '2026-10-09T11:00', attendeeIds: ['u-boss'], companyId: 'co-1', contactIds: ['pe-rao'], location: 'Board room' },
    });
    expect(c.warnings).toEqual(['Akmal is busy (Google Calendar) 10:00–10:30']);
    // Busy only — the check is never asked as somebody who could see a title.
    expect(findClashes.mock.calls[0][0]).not.toHaveProperty('viewerId');
    noWrites();
  });

  it('takes gear only on a shoot', async () => {
    const out = await run('prepareEvent', { action: 'BOOK', kind: 'MEETING', title: 'x', date: '2026-10-09', start: '10:00', gear: ['A7'] });
    expect(out.result).toMatchObject({ needs: ['kind'] });
  });

  it('asks when a shoot ends', async () => {
    const out = await run('prepareEvent', { action: 'BOOK', kind: 'SHOOT', title: 'Zeta shoot', date: '2026-10-10', start: '09:00' });
    expect(out.result).toMatchObject({ needs: ['end'] });
  });
});
