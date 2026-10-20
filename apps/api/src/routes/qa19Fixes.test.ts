import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { ACTIVE_DEAL_WHERE, activeDealTotals, isActiveDeal } from '../services/activeDeal.js';
import { isNextStepMissing, nextStepState } from '../services/salesFollowUp.js';
import { taskHasClient, waitingOnShown } from '../services/taskWaiting.js';
import { numbersChangedSince } from '../services/briefSummary.js';
import { taskSearchContext } from './search.js';

/**
 * QA19 fixes plan — one focused test per server rule the black-box QA of
 * 19 Oct 2026 found broken. Today, throughout: 19 October 2026, in Chennai.
 */

const PEOPLE = {
  boss: { id: 'usr-boss', preset: RolePreset.MANAGEMENT },
  emp: { id: 'usr-emp', preset: RolePreset.EMPLOYEE },
} as const;
type Who = keyof typeof PEOPLE;
const auth = (who: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[who].id,
      organizationId: 'org-1',
      email: 'x@eyelevel.local',
      preset: PEOPLE[who].preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[PEOPLE[who].preset]],
    } as never)}`,
  ] as const;

const p = prisma as any;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T06:00:00Z'));
  p.user.findUnique.mockImplementation(async ({ where }: any) => {
    const who = Object.values(PEOPLE).find((u) => u.id === where.id);
    return who
      ? {
          id: who.id,
          organizationId: 'org-1',
          name: who.id === 'usr-boss' ? 'Akmal' : 'Ramya',
          email: 'x@eyelevel.local',
          preset: who.preset,
          permissions: [...ROLE_PRESET_PERMISSIONS[who.preset]],
          active: true,
          sessionsValidFrom: null,
        }
      : null;
  });
  p.organization.findUnique.mockResolvedValue({
    timezone: 'Asia/Kolkata',
    dealStaleDays: 25,
    holidays: [],
    workingDays: [1, 2, 3, 4, 5, 6],
  });
  p.activity.create.mockResolvedValue({});
  p.user.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => vi.useRealTimers());

// ── F01: active deals ────────────────────────────────────────────────────────

const deal = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organizationId: 'org-1',
  companyId: `co-${id}`,
  ownerId: 'usr-boss',
  kind: 'RETAINER',
  stage: 'PROPOSAL_SENT',
  outcome: null,
  deletedAt: null,
  probabilityOverride: null,
  wonAt: null,
  verbalYesAt: null,
  createdAt: day('2026-10-01'),
  updatedAt: day('2026-10-01'),
  nextStep: null,
  nextStepDate: null,
  lastTouchedAt: null,
  company: { id: `co-${id}`, name: `Client ${id}`, vertical: 'Retail', city: 'Chennai' },
  owner: { id: 'usr-boss', name: 'Akmal' },
  versions: [{ id: `v-${id}`, n: 1, value: 130000, sentAt: day('2026-10-01'), scopeSummary: '' }],
  ...over,
});

describe('F01 — an active deal is one rule, everywhere', () => {
  it('no outcome and not in a closed stage; deleted deals never', () => {
    expect(isActiveDeal({ outcome: null, stage: 'IN_NEGOTIATION' })).toBe(true);
    expect(isActiveDeal({ outcome: 'LOST', stage: 'LOST' })).toBe(false);
    // A row where only one of the two moved is not live either.
    expect(isActiveDeal({ outcome: null, stage: 'LOST' })).toBe(false);
    expect(isActiveDeal({ outcome: 'WON', stage: 'VERBAL_YES' })).toBe(false);
    expect(isActiveDeal({ outcome: null, stage: 'PROSPECT', deletedAt: new Date() })).toBe(false);
    expect(ACTIVE_DEAL_WHERE).toEqual({ deletedAt: null, outcome: null, stage: { notIn: ['WON', 'LOST', 'EXPIRED'] } });
    expect(
      activeDealTotals([
        { outcome: null, stage: 'PROPOSAL_SENT', value: 100000, probability: 30 },
        { outcome: 'LOST', stage: 'LOST', value: 900000, probability: 0 },
      ]),
    ).toEqual({ count: 1, value: 100000, weighted: 30000 });
  });

  it('the Pipeline headline: 8 open and 2 lost shows 8, at the open-only value', async () => {
    const open = Array.from({ length: 8 }, (_, i) => deal(`open-${i}`));
    const lost = [
      deal('lost-1', { stage: 'LOST', outcome: 'LOST', versions: [{ id: 'vl1', n: 1, value: 500000, sentAt: day('2026-09-01'), scopeSummary: '' }] }),
      deal('lost-2', { stage: 'LOST', outcome: 'LOST', versions: [{ id: 'vl2', n: 1, value: 700000, sentAt: day('2026-09-01'), scopeSummary: '' }] }),
    ];
    p.proposal.findMany.mockResolvedValue([...open, ...lost]);
    p.proforma.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/proposals/pipeline').set(...auth('boss'));

    expect(res.status).toBe(200);
    expect(res.body.headline.activeDeals).toBe(8);
    expect(res.body.headline.value).toBe(1040000);
    // Weighted from the active cards alone — the Lost column adds nothing.
    const cards = res.body.columns.PROPOSAL_SENT;
    expect(res.body.headline.weighted).toBe(Math.round(cards.reduce((s: number, c: any) => s + c.quotedValue * (c.probability / 100), 0)));
    // Lost keeps its own column.
    expect(res.body.columns.LOST).toHaveLength(2);
  });

  it('the Proposals list splits on the same rule and counts the whole register', async () => {
    p.proposal.findMany.mockImplementation(async ({ where }: any) =>
      where.stage?.notIn
        ? // The tiles' query: active deals only, by the shared rule.
          Array.from({ length: 8 }, () => ({ versions: [{ value: 130000 }] }))
        : [
            { ...deal('a'), documents: [], wonVersion: null },
            // Won stage with no outcome written: not active, so not in Active.
            { ...deal('b', { stage: 'WON' }), documents: [], wonVersion: null },
          ],
    );
    p.proposal.count.mockResolvedValue(2);
    p.proforma.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/proposals').set(...auth('boss'));

    expect(res.status).toBe(200);
    expect(res.body.active).toEqual({ count: 8, value: 1040000 });
    expect(res.body.proposals.map((x: any) => [x.id, x.active])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    const tiles = p.proposal.findMany.mock.calls.find(([a]: any) => a.where.stage?.notIn)[0];
    expect(tiles.where).toMatchObject(ACTIVE_DEAL_WHERE);
  });
});

// ── F02: a new lead's industry is chosen ─────────────────────────────────────

describe('F02 — a new lead needs an industry', () => {
  beforeEach(() => {
    p.outreachEntry.create.mockImplementation(async ({ data }: any) => ({ id: 'lead-1', ...data }));
  });

  it('refuses one without, in words', async () => {
    for (const vertical of [undefined, '', '   ']) {
      const res = await request(app)
        .post('/api/outreach')
        .set(...auth('boss'))
        .send({ name: 'Acme', phone: '98400 11223', ...(vertical === undefined ? {} : { vertical }) });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Choose an industry for this lead.');
    }
    expect(p.outreachEntry.create).not.toHaveBeenCalled();
  });

  it('still takes a legacy code from an import, saved as its name', async () => {
    const res = await request(app)
      .post('/api/outreach')
      .set(...auth('boss'))
      .send({ name: 'Acme', phone: '98400 11223', vertical: 'HEALTHCARE' });
    expect(res.status).toBe(201);
    expect(p.outreachEntry.create.mock.calls[0][0].data).toMatchObject({ vertical: 'Healthcare & Wellness', source: 'Cold Outreach' });
  });
});

// ── F04: missing means nothing written ───────────────────────────────────────

describe('F04 — a next step without a date is a next step', () => {
  it('missing is no words; a date alone does not make one', () => {
    expect(isNextStepMissing({ nextStep: 'Send the revised scope' })).toBe(false);
    expect(isNextStepMissing({ nextStep: '   ' })).toBe(true);
    expect(nextStepState({ nextStep: 'Send the revised scope', date: null }, true, '2026-10-19')).toEqual({
      missing: false,
      overdue: false,
      dueToday: false,
    });
    expect(nextStepState({ nextStep: null, date: day('2026-10-25') }, true, '2026-10-19').missing).toBe(true);
  });

  it('the pipeline card with words and no date is not "No next step"', async () => {
    p.proposal.findMany.mockResolvedValue([deal('worded', { nextStep: 'Call on Monday' }), deal('blank')]);
    p.proforma.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/proposals/pipeline').set(...auth('boss'));
    const cards = res.body.columns.PROPOSAL_SENT;
    expect(cards.find((c: any) => c.id === 'worded')).toMatchObject({ noNextStep: false, nextStep: 'Call on Monday', nextStepDate: null });
    expect(cards.find((c: any) => c.id === 'blank').noNextStep).toBe(true);
  });
});

// ── F05: what "Just me" shows ────────────────────────────────────────────────

describe('F05 — an event I booked is on my calendar', () => {
  beforeEach(() => {
    for (const model of ['task', 'invoice', 'proforma', 'outreachEntry', 'project', 'retainer', 'retainerProject', 'assetMovement', 'externalBusyBlock'] as const) {
      p[model].findMany.mockResolvedValue([]);
    }
  });

  it('booked for the boss, not attending: in Just me, marked Booked by you', async () => {
    const ev = (id: string, createdById: string, attendees: string[]) => ({
      id,
      kind: 'MEETING',
      title: id,
      startsAt: new Date('2026-10-20T05:30:00Z'),
      endsAt: new Date('2026-10-20T06:30:00Z'),
      allDay: false,
      location: null,
      createdById,
      createdBy: { name: createdById === 'usr-emp' ? 'Ramya' : 'Akmal' },
      attendees: attendees.map((userId) => ({ userId })),
    });
    p.calendarEvent.findMany.mockResolvedValue([
      ev('for-the-boss', 'usr-emp', ['usr-boss']),
      ev('i-am-on', 'usr-boss', ['usr-emp']),
      ev('not-mine', 'usr-boss', ['usr-boss']),
    ]);

    const res = await request(app).get('/api/calendar?from=2026-10-19&to=2026-10-25&layers=events').set(...auth('emp'));

    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.items.filter((i: any) => i.layer === 'events').map((i: any) => [i.title, i]));
    expect(by['for-the-boss']).toMatchObject({ isMine: false, justMe: true, bookedByYou: true });
    expect(by['i-am-on']).toMatchObject({ isMine: true, justMe: true, bookedByYou: false });
    expect(by['not-mine']).toMatchObject({ isMine: false, justMe: false, bookedByYou: false });
  });
});

// ── F06: what a task on hold waits on ────────────────────────────────────────

describe('F06 — on hold asks what it is waiting on', () => {
  const internal = { id: 't-1', organizationId: 'org-1', status: 'TODO', monthCardId: null, projectId: null, companyId: null };

  beforeEach(() => {
    p.task.findFirst.mockResolvedValue(internal);
    p.task.update.mockImplementation(async ({ data }: any) => ({ ...internal, ...data }));
  });

  it('an internal task with no client cannot wait on the client', async () => {
    const res = await request(app).post('/api/tasks/t-1/wait').set(...auth('boss')).send({ waitingOn: 'CLIENT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no client to wait on/);
    expect(p.task.update).not.toHaveBeenCalled();
  });

  it('just on hold — null or left out — pauses with nothing to wait on', async () => {
    for (const body of [{ waitingOn: null }, {}]) {
      p.task.update.mockClear();
      const res = await request(app).post('/api/tasks/t-1/wait').set(...auth('boss')).send(body);
      expect(res.status).toBe(200);
      expect(p.task.update.mock.calls[0][0].data).toMatchObject({ status: 'ON_HOLD', waitingOn: null });
      expect(p.task.update.mock.calls[0][0].data.waitingSince).toBeInstanceOf(Date);
    }
  });

  it('someone else, on any task; the client, on a task that has one', async () => {
    let res = await request(app).post('/api/tasks/t-1/wait').set(...auth('boss')).send({ waitingOn: 'ANOTHER_PERSON' });
    expect(res.status).toBe(200);
    p.task.findFirst.mockResolvedValue({ ...internal, monthCardId: 'mc-1' });
    res = await request(app).post('/api/tasks/t-1/wait').set(...auth('boss')).send({ waitingOn: 'CLIENT' });
    expect(res.status).toBe(200);
  });

  it('an old internal "client" hold shows as plain On hold — the row is not rewritten', () => {
    expect(taskHasClient({ monthCardId: null, projectId: null, companyId: null })).toBe(false);
    expect(taskHasClient({ companyId: 'co-1' })).toBe(true);
    expect(waitingOnShown({ waitingOn: 'CLIENT', monthCardId: null, projectId: null, companyId: null })).toBeNull();
    expect(waitingOnShown({ waitingOn: 'CLIENT', projectId: 'pr-1' })).toBe('CLIENT');
    expect(waitingOnShown({ waitingOn: 'ANOTHER_PERSON' })).toBe('ANOTHER_PERSON');
  });
});

// ── F07: what search says a task belongs to ─────────────────────────────────

describe('F07 — every task in search says what it belongs to', () => {
  it('client and work, internal project, or Internal — no project; never empty', () => {
    expect(taskSearchContext({ project: { name: 'Website build', company: { name: 'Acme' } } })).toBe('Acme · Website build');
    expect(
      taskSearchContext({ monthCard: { retainer: { company: { name: 'Acme' } } }, retainerProject: { name: 'Monthly delivery' } }),
    ).toBe('Acme · Monthly delivery');
    expect(taskSearchContext({ monthCard: { retainer: { company: { name: 'Acme' } } } })).toBe('Acme · Retainer');
    expect(taskSearchContext({ internalProject: { name: 'Office move' } })).toBe('Internal · Office move');
    expect(taskSearchContext({})).toBe('Internal — no project');
  });

  it('the search route sends it', async () => {
    for (const model of ['company', 'proposal', 'project', 'proforma', 'invoice'] as const) p[model].findMany.mockResolvedValue([]);
    p.task.findMany.mockResolvedValue([
      { id: 't-1', title: 'Renew the Wi-Fi', projectId: null, project: null, monthCard: null, retainerProject: null, internalProject: null, company: null },
    ]);
    const res = await request(app).get('/api/search?q=wi').set(...auth('boss'));
    expect(res.status).toBe(200);
    expect(res.body.tasks[0].context).toBe('Internal — no project');
  });
});

// ── The brief: snapshot against live ─────────────────────────────────────────

describe('the brief says when its numbers have moved since the summary', () => {
  const saved = {
    needsAction: [{ group: 'Invoices to chase', count: 3, top: [] }],
    risks: [],
    comingUp: { invoicesDue: { count: 1, total: 5000 }, projectsEnding: 0, renewals: 0, shoots: 1, meetings: 2 },
  };
  const live = (chase: number) => ({
    needsAction: chase ? [{ group: 'Invoices to chase', items: Array(chase).fill({}) }] : [],
    risks: [],
    comingUp: {
      invoicesDue: [{}],
      projectsEnding: [],
      renewals: [],
      events: [{ kind: 'SHOOT' }, { kind: 'MEETING' }, { kind: 'MEETING' }],
    },
  });

  it('unchanged while the lists still say what it saw; changed once a count moves', () => {
    expect(numbersChangedSince(saved, live(3))).toBe(false);
    expect(numbersChangedSince(saved, live(1))).toBe(true);
    expect(numbersChangedSince(saved, live(0))).toBe(true);
    // An old row with nothing to compare never raises the line.
    expect(numbersChangedSince(null, live(1))).toBe(false);
  });
});
