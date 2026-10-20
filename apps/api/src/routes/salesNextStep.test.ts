import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset, OutreachStatus } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { evaluateAgencyHealthRules } from '../workers/scanner.cron.js';
import { dealStaleness, leadStaleness, stageEnteredAt } from '../services/salesFollowUp.js';
import { parseImportDay } from './outreach.js';

/**
 * Sales next step plan: every open deal and active lead has a next step; the
 * last touch is the last real contact; "going stale" counts from it.
 *
 * Today, throughout: 14 October 2026, in Chennai.
 */

const BD = {
  id: 'usr-bd',
  organizationId: 'org-1',
  name: 'Varsha',
  email: 'bd@x',
  preset: RolePreset.BD,
  permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write'],
  active: true,
  sessionsValidFrom: null,
};
const DESIGNER = { ...BD, id: 'usr-des', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] };
const tokenFor = (u: { id: string; email: string; preset: RolePreset; permissions: string[] }) =>
  `Bearer ${signJwt({ userId: u.id, organizationId: 'org-1', email: u.email, preset: u.preset, permissions: u.permissions } as never)}`;
const auth = tokenFor(BD);
const p = prisma as any;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T06:00:00Z'));
  p.user.findUnique.mockImplementation(async ({ where }: any) => [BD, DESIGNER].find((u) => u.id === where.id) ?? null);
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', dealStaleDays: 25, outreachStaleDays: 10 });
  p.activity.create.mockResolvedValue({});
  p.activity.createMany.mockResolvedValue({ count: 0 });
  p.$transaction.mockImplementation(async (fn: any) => fn(p));
});
afterEach(() => vi.useRealTimers());

const openDeal = (over: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  organizationId: 'org-1',
  companyId: 'co-1',
  ownerId: 'usr-bd',
  kind: 'RETAINER',
  stage: 'PROPOSAL_SENT',
  outcome: null,
  deletedAt: null,
  wonAt: null,
  verbalYesAt: null,
  createdAt: day('2026-08-01'),
  nextStep: null,
  nextStepDate: null,
  lastTouchedAt: null,
  company: { id: 'co-1', name: 'Carlton Hotels' },
  versions: [{ id: 'v1', n: 1, value: 100000, sentAt: day('2026-08-01'), scopeSummary: '' }],
  ...over,
});

// ── 1. A next step on every open deal ──
// Optional everywhere since 2026-10-16: nothing refuses a save without one,
// a deal or lead without one shows "No next step", and a date can't be past.
describe('the next step on a deal: optional, never in the past', () => {
  beforeEach(() => {
    p.proposal.findFirst.mockResolvedValue(openDeal());
    p.proposalVersion.create.mockResolvedValue({ id: 'v2', n: 2 });
    p.proposal.update.mockResolvedValue({});
  });

  it('a new version on a deal with no next step still saves', async () => {
    const res = await request(app).post('/api/proposals/prop-1/versions').set('Authorization', auth).send({ value: 90000 });
    expect(res.status).toBe(201);
    expect(p.proposalVersion.create).toHaveBeenCalled();
  });

  it('with one, it saves the step and moves the last touch — a version sent is contact', async () => {
    const res = await request(app)
      .post('/api/proposals/prop-1/versions')
      .set('Authorization', auth)
      .send({ value: 90000, nextStep: 'Call to walk through v2', nextStepDate: '2026-10-17' });
    expect(res.status).toBe(201);
    const data = p.proposal.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ stage: 'IN_NEGOTIATION', nextStep: 'Call to walk through v2' });
    expect(data.nextStepDate.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(data.lastTouchedAt).toBeInstanceOf(Date);
  });

  it('a next step dated in the past is refused', async () => {
    const res = await request(app)
      .post('/api/proposals/prop-1/versions')
      .set('Authorization', auth)
      .send({ value: 90000, nextStep: 'Call', nextStepDate: '2026-10-13' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't be in the past/);
  });

  it('verbal yes needs none either', async () => {
    p.proposal.findFirst.mockResolvedValue(openDeal({ stage: 'PROFORMA_ISSUED' }));
    p.proposal.update.mockResolvedValue({ ...openDeal({ stage: 'VERBAL_YES' }) });
    const res = await request(app).patch('/api/proposals/prop-1/stage').set('Authorization', auth).send({ stage: 'VERBAL_YES' });
    expect(res.status).toBe(200);
    expect(p.proposal.update.mock.calls[0][0].data).toMatchObject({ stage: 'VERBAL_YES' });
  });

  it('losing it needs none', async () => {
    p.proposal.findFirst.mockResolvedValue(openDeal());
    p.proposal.update.mockResolvedValue({ id: 'prop-1', stage: 'LOST' });
    p.company.update.mockResolvedValue({});
    p.proposal.count.mockResolvedValue(0);
    p.retainer.count.mockResolvedValue(0);
    p.project.count.mockResolvedValue(0);
    const res = await request(app).post('/api/proposals/prop-1/lose').set('Authorization', auth).send({ lostReason: 'Went with an in-house team' });
    expect(res.status).toBe(200);
    expect(p.proposal.update.mock.calls[0][0].data).toMatchObject({ stage: 'LOST', outcome: 'LOST' });
  });

  it('the proposal form does not need one: creating or editing a deal saves without it', async () => {
    // Optional on the proposal form since 2026-10-16 — a deal can be written
    // down before anybody knows what happens next.
    p.company.findFirst.mockResolvedValue({ id: 'co-1', organizationId: 'org-1', name: 'Carlton Hotels' });
    p.proposal.create.mockResolvedValue({ id: 'prop-new' });
    p.proposalVersion.create.mockResolvedValue({ id: 'v1', n: 1 });
    p.proposal.findUnique.mockResolvedValue({ ...openDeal({ id: 'prop-new' }) });
    const created = await request(app)
      .post('/api/proposals')
      .set('Authorization', auth)
      .send({ companyId: 'co-1', kind: 'RETAINER', initialValue: 100000 });
    expect(created.status).toBe(201);
    expect(created.body.code).toBeUndefined();

    p.proposal.findFirst.mockResolvedValue({ ...openDeal(), wonVersion: null });
    p.user.findFirst.mockResolvedValue({ id: 'usr-other' });
    p.proposal.update.mockResolvedValue({ ...openDeal(), ownerId: 'usr-other' });
    const edited = await request(app).patch('/api/proposals/prop-1').set('Authorization', auth).send({ ownerId: 'usr-other' });
    expect(edited.status).toBe(200);
    // An owner change is not contact.
    expect(p.proposal.update.mock.calls[0][0].data.lastTouchedAt).toBeUndefined();
  });

  it('a next step date given on the proposal form still cannot be in the past', async () => {
    p.company.findFirst.mockResolvedValue({ id: 'co-1', organizationId: 'org-1', name: 'Carlton Hotels' });
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', auth)
      .send({ companyId: 'co-1', kind: 'RETAINER', initialValue: 100000, nextStep: 'Call', nextStepDate: '2026-10-01' });
    expect(res.status).toBe(400);
    expect(p.proposal.create).not.toHaveBeenCalled();
  });
});

// ── 2. Logging a touch ──
describe('Log touch', () => {
  it('a WhatsApp touch moves the last touch, sets the next step, and is in the history', async () => {
    p.proposal.findFirst.mockResolvedValue(openDeal());
    p.proposal.update.mockResolvedValue({});
    const res = await request(app)
      .post('/api/proposals/prop-1/touch')
      .set('Authorization', auth)
      .send({ channel: 'WHATSAPP', note: 'Sent the case study', nextStep: 'Call Friday', nextStepDate: '2026-10-16' });
    expect(res.status).toBe(201);
    expect(p.proposal.update.mock.calls[0][0].data).toMatchObject({ nextStep: 'Call Friday' });
    expect(p.proposal.update.mock.calls[0][0].data.lastTouchedAt.toISOString()).toBe('2026-10-14T06:00:00.000Z');
    expect(p.activity.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'Proposal',
      verb: 'touch_logged',
      payload: { channel: 'WHATSAPP', note: 'Sent the case study', nextStep: 'Call Friday', nextStepDate: '2026-10-16' },
    });
  });

  it('needs a channel and a note; the next step is optional, and left out it stays as it was', async () => {
    p.proposal.findFirst.mockResolvedValue(openDeal({ nextStep: 'Call Friday', nextStepDate: day('2026-10-16') }));
    p.proposal.update.mockResolvedValue({});
    const ok = await request(app).post('/api/proposals/prop-1/touch').set('Authorization', auth).send({ channel: 'CALL', note: 'Spoke' });
    expect(ok.status).toBe(201);
    const { data } = p.proposal.update.mock.calls[0][0];
    expect(data.lastTouchedAt).toBeInstanceOf(Date);
    expect('nextStep' in data || 'nextStepDate' in data).toBe(false);

    const noNote = await request(app).post('/api/proposals/prop-1/touch').set('Authorization', auth).send({ channel: 'CALL' });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error).toBe('Add a short note — what was said');
  });

  it('a lead touch does the same', async () => {
    p.outreachEntry.findFirst.mockResolvedValue({ id: 'lead-1', name: 'Prestige', status: 'FOLLOW_UP', promotedCompanyId: null });
    p.outreachEntry.update.mockResolvedValue({ id: 'lead-1' });
    const res = await request(app)
      .post('/api/outreach/lead-1/touch')
      .set('Authorization', auth)
      .send({ channel: 'CALL', note: 'Asked for a deck', nextStep: 'Send deck', nextStepDate: '2026-10-15' });
    expect(res.status).toBe(201);
    const data = p.outreachEntry.update.mock.calls[0][0].data;
    expect(data.nextStep).toBe('Send deck');
    expect(data.nextActionDate.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(data.lastTouchedAt).toBeInstanceOf(Date);
  });
});

// ── 3. Going stale, from the last touch ──
describe('going stale counts from the last touch', () => {
  it('falls back to when the deal entered its stage, and a logged touch takes it out of the count', () => {
    const today = '2026-10-14';
    const untouched = openDeal();
    expect(stageEnteredAt(untouched)).toEqual(day('2026-08-01'));
    expect(dealStaleness(untouched, 25, today)).toMatchObject({ daysSinceTouch: 74, stale: true, touchRecorded: false });

    const touched = openDeal({ lastTouchedAt: new Date('2026-10-14T05:00:00Z') });
    expect(dealStaleness(touched, 25, today)).toMatchObject({ daysSinceTouch: 0, stale: false });

    // A closed deal is never stale.
    expect(dealStaleness(openDeal({ outcome: 'LOST' }), 25, today).stale).toBe(false);
  });

  it('a lead: active ones only, from the last touch or else the day it was added', () => {
    const today = '2026-10-14';
    expect(leadStaleness({ lastTouchedAt: null, importedAt: day('2026-09-24'), status: 'FOLLOW_UP' }, 10, today)).toMatchObject({ daysSinceTouch: 20, stale: true });
    expect(leadStaleness({ lastTouchedAt: day('2026-10-10'), importedAt: day('2026-09-24'), status: 'FOLLOW_UP' }, 10, today).stale).toBe(false);
    expect(leadStaleness({ lastTouchedAt: null, importedAt: day('2026-01-01'), status: 'NOT_CONTACTED' }, 10, today).stale).toBe(false);
  });

  it('the board counts it, with the org threshold, and flags the missing and overdue next steps', async () => {
    p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', dealStaleDays: 25 });
    p.proposal.findMany.mockResolvedValue([
      { ...openDeal({ id: 'quiet' }), owner: null },
      { ...openDeal({ id: 'chased', lastTouchedAt: new Date('2026-10-12T10:00:00Z'), nextStep: 'Call', nextStepDate: day('2026-10-13') }), owner: null },
    ]);
    p.proforma.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/proposals/pipeline').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ staleDays: 25, staleCount: 1 });
    const cards = res.body.columns.PROPOSAL_SENT;
    const quiet = cards.find((c: any) => c.id === 'quiet');
    const chased = cards.find((c: any) => c.id === 'chased');
    expect(quiet).toMatchObject({ stale: true, noNextStep: true, daysSinceTouch: 74 });
    expect(chased).toMatchObject({ stale: false, noNextStep: false, nextStepOverdue: true, daysSinceTouch: 2 });
  });

  it('PROPOSAL_STALLED counts from the last touch too', async () => {
    const quiet = { ...openDeal({ id: 'quiet' }), company: { id: 'co-1', name: 'Quiet Co' } };
    const chased = { ...openDeal({ id: 'chased', lastTouchedAt: new Date('2026-10-12T10:00:00Z') }), company: { id: 'co-2', name: 'Chased Co' } };
    p.proposal.findMany.mockResolvedValueOnce([quiet, chased]).mockResolvedValue([]);
    for (const m of ['proforma', 'retainer', 'invoice', 'project', 'user', 'company', 'monthCard', 'asset', 'assetMovement', 'assetMaintenance']) {
      p[m].findMany.mockResolvedValue([]);
    }
    p.task.findMany.mockResolvedValue([]);
    p.task.findFirst.mockResolvedValue({ id: 'existing-follow-up' });
    p.task.groupBy.mockResolvedValue([]);
    p.peopleAllocation.groupBy.mockResolvedValue([]);
    p.peopleAllocation.count.mockResolvedValue(0);

    const alerts = await evaluateAgencyHealthRules('org-1');
    const stalled = alerts.filter((a) => a.rule === 'PROPOSAL_STALLED');
    expect(stalled.map((a) => a.entityId)).toEqual(['quiet']);
    expect(stalled[0].message).toMatch(/no contact for 74 days/);
  });
});

// ── 4. Correcting imported dates ──
describe('Set last contact date', () => {
  it('in bulk: every selected deal, each with its own history row of what it replaced', async () => {
    p.proposal.findMany.mockResolvedValue([
      { id: 'a', lastTouchedAt: day('2026-10-01'), company: { name: 'A' } },
      { id: 'b', lastTouchedAt: null, company: { name: 'B' } },
    ]);
    p.proposal.updateMany.mockResolvedValue({ count: 2 });
    const res = await request(app)
      .post('/api/proposals/last-contact')
      .set('Authorization', auth)
      .send({ ids: ['a', 'b'], lastTouchedAt: '2026-08-20' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(p.proposal.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1' });
    expect(p.proposal.updateMany.mock.calls[0][0].data.lastTouchedAt.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(p.activity.createMany.mock.calls[0][0].data.map((d: any) => d.payload)).toEqual([
      { companyName: 'A', from: '2026-10-01', to: '2026-08-20' },
      { companyName: 'B', from: null, to: '2026-08-20' },
    ]);
  });

  it('refuses a date in the future', async () => {
    const res = await request(app).post('/api/outreach/last-contact').set('Authorization', auth).send({ ids: ['x'], lastTouchedAt: '2026-10-15' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't be in the future/);
  });

  it('the outreach import reads a "Last contacted" column', async () => {
    p.outreachEntry.findMany.mockResolvedValue([]);
    p.company.findMany.mockResolvedValue([]);
    p.outreachEntry.createMany.mockResolvedValue({ count: 1 });
    const csv = [
      'Name,Industry,Phone,Last contacted',
      'Prestige,Real Estate,9840011223,14/09/2026',
      'Casagrand,Real Estate,9840011224,31/02/2026',
      'Kauvery,Healthcare,9840011225,2026-11-01',
    ].join('\n');
    const res = await request(app).post('/api/outreach/import').set('Authorization', auth).send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => [r.name, r.action])).toEqual([
      ['Prestige', 'CREATED'],
      ['Casagrand', 'INVALID'],
      ['Kauvery', 'INVALID'],
    ]);
    expect(p.outreachEntry.createMany.mock.calls[0][0].data[0].lastTouchedAt.toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('reads the dates a spreadsheet writes', () => {
    expect(parseImportDay('2026-09-14')).toBe('2026-09-14');
    expect(parseImportDay('14/09/2026')).toBe('2026-09-14');
    expect(parseImportDay('4-9-2026')).toBe('2026-09-04');
    expect(parseImportDay('31/02/2026')).toBeNull();
    expect(parseImportDay('Sept 14')).toBeNull();
  });
});

// ── 5. Outreach statuses ──
describe("a lead's next step is optional; Dead clears it", () => {
  beforeEach(() => {
    p.outreachEntry.findFirst.mockResolvedValue({ id: 'lead-1', name: 'Prestige', status: 'FOLLOW_UP', promotedCompanyId: null, nextStep: 'Call', nextActionDate: day('2026-10-20') });
    p.outreachEntry.update.mockImplementation(async ({ data }: any) => ({ id: 'lead-1', ...data }));
  });

  it('Interested saves without a next step or a date; a callback still needs its date', async () => {
    const res = await request(app).patch('/api/outreach/lead-1/status').set('Authorization', auth).send({ status: 'INTERESTED' });
    expect(res.status).toBe(200);
    expect(p.outreachEntry.update.mock.calls[0][0].data).toMatchObject({ status: 'INTERESTED', nextStep: null });

    // Follow up was always its call-back date and the note — that has not changed.
    const callback = await request(app)
      .patch('/api/outreach/lead-1/status')
      .set('Authorization', auth)
      .send({ status: 'FOLLOW_UP', remarks: 'Call after Diwali' });
    expect(callback.status).toBe(400);
    expect(callback.body.error).toBe('When are you calling them back?');
  });

  it('Dead clears the next step, and the change is a touch', async () => {
    const res = await request(app).patch('/api/outreach/lead-1/status').set('Authorization', auth).send({ status: 'DEAD', remarks: 'Went elsewhere' });
    expect(res.status).toBe(200);
    const data = p.outreachEntry.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: OutreachStatus.DEAD, nextStep: null, nextActionDate: null });
    expect(data.lastTouchedAt).toBeInstanceOf(Date);
  });

  it('the list filters to the active leads with no next step', async () => {
    p.outreachEntry.findMany.mockResolvedValue([]);
    p.outreachEntry.count.mockResolvedValue(0);
    p.outreachEntry.groupBy.mockResolvedValue([]);
    await request(app).get('/api/outreach?missingNextStep=true').set('Authorization', auth);
    const where = p.outreachEntry.findMany.mock.calls[0][0].where;
    // Missing is nothing written: a step without a date is a step (QA19 fixes plan, F04).
    expect(where.AND[0]).toEqual({
      status: { in: ['FOLLOW_UP', 'MEETING', 'INTERESTED'] },
      OR: [{ nextStep: null }, { nextStep: '' }],
    });
  });
});

// ── 6. Follow-ups on My Work ──
describe('Follow-ups', () => {
  it("lists the owner's deals and leads due today, overdue, or tomorrow", async () => {
    p.proposal.findMany.mockResolvedValue([
      { id: 'd1', companyId: 'co-1', nextStep: 'Send v2', nextStepDate: day('2026-10-12'), company: { name: 'Carlton' } },
      { id: 'd2', companyId: 'co-2', nextStep: 'Call', nextStepDate: day('2026-10-15'), company: { name: 'Brigade' } },
    ]);
    p.outreachEntry.findMany.mockResolvedValue([{ id: 'l1', name: 'Prestige', nextStep: 'Meet', nextActionDate: day('2026-10-14') }]);
    const res = await request(app).get('/api/follow-ups').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => [i.name, i.date, i.overdue, i.dueToday])).toEqual([
      ['Carlton', '2026-10-12', true, false],
      ['Prestige', '2026-10-14', false, true],
      ['Brigade', '2026-10-15', false, false],
    ]);
    const where = p.proposal.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ ownerId: 'usr-bd', outcome: null });
    // Through the end of tomorrow.
    expect(where.nextStepDate.lt.toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  it('shows nothing someone is not allowed to open', async () => {
    const res = await request(app).get('/api/follow-ups').set('Authorization', tokenFor(DESIGNER));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(p.proposal.findMany).not.toHaveBeenCalled();
  });
});
