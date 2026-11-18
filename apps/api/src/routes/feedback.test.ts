import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { resolvePermissions } from '../middleware/auth.js';
import { EXTERNAL_RULES } from '../services/alertRules.js';
import { closeOldFeedbackReplies, refreshFeedbackAlert } from '../services/feedback.js';
import { flagFor, raiseUsageReviews, screensReview } from '../services/usageReview.js';
import { MANAGEMENT_RULES, alertClausesFor } from './notifications.js';

/**
 * "Something confusing? Tell us" and the monthly usage review (Ease Plan 3).
 *
 *   · anybody signed in sends a note; only Management reads or handles them —
 *     not even a Head holding setup.admin;
 *   · ten a day, then a polite no; every read and change stays in the org;
 *   · Management's one "N new feedback notes" bell opens, moves and closes;
 *   · Done with a reply rings the sender once, about themselves;
 *   · the Screens view counts, flags, and closes the month's review bell,
 *     which is raised once, early in the studio's month;
 *   · all three rules are outside the scanner and reach the right people.
 */

const PEOPLE = {
  boss: { id: 'usr-boss', name: 'Akmal', preset: RolePreset.MANAGEMENT, permissions: [] as string[] },
  // A Head who runs Settings: setup.admin, but not Management.
  head: { id: 'usr-head', name: 'Janani', preset: RolePreset.HEAD, permissions: ['setup.admin'] },
  emp: { id: 'usr-emp', name: 'Ravi', preset: RolePreset.EMPLOYEE, permissions: [] as string[] },
} as const;
type Who = keyof typeof PEOPLE;

const auth = (who: Who) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: PEOPLE[who].id,
      organizationId: 'org-1',
      email: 'x@y',
      preset: PEOPLE[who].preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[PEOPLE[who].preset], ...PEOPLE[who].permissions] as never[],
    })}`,
  ] as const;

const session = (who: Who) => ({
  userId: PEOPLE[who].id,
  organizationId: 'org-1',
  email: 'x@y',
  name: PEOPLE[who].name,
  preset: PEOPLE[who].preset,
  permissions: resolvePermissions(PEOPLE[who].preset, PEOPLE[who].permissions as never[]),
  active: true,
});

beforeEach(() => {
  (prisma.organization.findUnique as any).mockResolvedValue({ timezone: 'Asia/Kolkata', financialYearStart: 4 });
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const p = Object.values(PEOPLE).find((x) => x.id === where.id);
    return p
      ? { id: p.id, organizationId: 'org-1', name: p.name, email: 'x@y', preset: p.preset, permissions: p.permissions, active: true, sessionsValidFrom: null }
      : null;
  });
  (prisma.feedback.count as any).mockResolvedValue(0);
  (prisma.feedback.create as any).mockResolvedValue({ id: 'fb-1' });
  (prisma.alert.findFirst as any).mockResolvedValue(null);
  (prisma.alert.create as any).mockResolvedValue({ id: 'al-1' });
  (prisma.alert.updateMany as any).mockResolvedValue({ count: 0 });
});

describe('sending a note', () => {
  it('anybody signed in can, with the page, its screen and the device', async () => {
    (prisma.feedback.count as any).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const res = await request(app)
      .post('/api/feedback')
      .set(...auth('emp'))
      .send({ message: '  Where do I see my leave?  ', path: '/calendar?view=week', device: 'PHONE' });
    expect(res.status).toBe(201);
    const data = (prisma.feedback.create as any).mock.calls[0][0].data;
    expect(data).toEqual({
      organizationId: 'org-1',
      userId: 'usr-emp',
      // The page, never its query; the screen by key.
      path: '/calendar',
      screen: 'calendar',
      device: 'PHONE',
      message: 'Where do I see my leave?',
    });
    // Management's bell opens.
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({
      organizationId: 'org-1',
      rule: 'FEEDBACK_NEW',
      severity: 'LOW',
      entityType: 'Feedback',
      entityId: 'org-1',
      message: '1 new feedback note',
    });
  });

  it('needs a message, and no more than 2,000 characters', async () => {
    const blank = await request(app).post('/api/feedback').set(...auth('emp')).send({ message: '   ', path: '/my-work' });
    expect(blank.status).toBe(400);
    const long = await request(app).post('/api/feedback').set(...auth('emp')).send({ message: 'x'.repeat(2001), path: '/my-work' });
    expect(long.status).toBe(400);
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it('the 11th in a studio day is refused politely', async () => {
    (prisma.feedback.count as any).mockResolvedValue(10);
    const res = await request(app).post('/api/feedback').set(...auth('emp')).send({ message: 'One more', path: '/money' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^Thank you/);
    expect(prisma.feedback.create).not.toHaveBeenCalled();
    // Counted for this person, in this org, since the studio's midnight (IST = 18:30 UTC the day before).
    const where = (prisma.feedback.count as any).mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: 'org-1', userId: 'usr-emp' });
    expect(where.createdAt.gte.toISOString()).toMatch(/T18:30:00\.000Z$/);
  });

  it('is not open to somebody signed out', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'Hi', path: '/' });
    expect(res.status).toBe(401);
  });
});

describe('reading and handling notes is Management only', () => {
  it.each(['emp', 'head'] as const)('%s cannot list or handle them — setup.admin included', async (who) => {
    const list = await request(app).get('/api/feedback').set(...auth(who));
    expect(list.status).toBe(403);
    const patch = await request(app).patch('/api/feedback/fb-1').set(...auth(who)).send({ status: 'SEEN' });
    expect(patch.status).toBe(403);
    expect(prisma.feedback.findMany).not.toHaveBeenCalled();
    expect(prisma.feedback.update).not.toHaveBeenCalled();
  });

  it('Management lists their own org, newest first, with name, department and the screen by name', async () => {
    (prisma.feedback.findMany as any).mockResolvedValue([
      {
        id: 'fb-1',
        message: 'Where do I see my leave?',
        path: '/calendar',
        screen: 'calendar',
        device: 'PHONE',
        status: 'NEW',
        note: null,
        createdAt: new Date('2026-11-18T05:00:00Z'),
        handledAt: null,
        user: { id: 'usr-emp', name: 'Ravi', department: { name: 'Design' } },
        handledBy: null,
      },
    ]);
    const res = await request(app).get('/api/feedback').set(...auth('boss'));
    expect(res.status).toBe(200);
    const args = (prisma.feedback.findMany as any).mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: 'org-1' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(res.body.notes[0]).toMatchObject({ screen: 'Calendar', path: '/calendar', device: 'PHONE', from: { name: 'Ravi', dept: 'Design' } });
  });

  it('another org’s note is not found', async () => {
    (prisma.feedback.findFirst as any).mockResolvedValue(null);
    const res = await request(app).patch('/api/feedback/fb-other').set(...auth('boss')).send({ status: 'SEEN' });
    expect(res.status).toBe(404);
    expect((prisma.feedback.findFirst as any).mock.calls[0][0].where).toEqual({ id: 'fb-other', organizationId: 'org-1' });
    expect(prisma.feedback.update).not.toHaveBeenCalled();
  });
});

describe('closing the loop', () => {
  const stored = (over: object = {}) => ({ id: 'fb-1', userId: 'usr-emp', screen: 'money', status: 'SEEN', note: null, handledAt: null, ...over });

  beforeEach(() => {
    (prisma.feedback.update as any).mockResolvedValue({ id: 'fb-1', status: 'DONE', note: 'x', handledAt: new Date(), handledBy: null });
  });

  it('Done with a note rings the sender once, about themselves', async () => {
    (prisma.feedback.findFirst as any).mockResolvedValue(stored());
    const res = await request(app)
      .patch('/api/feedback/fb-1')
      .set(...auth('boss'))
      .send({ status: 'DONE', note: 'Billing is the second tab now.' });
    expect(res.status).toBe(200);
    expect((prisma.feedback.update as any).mock.calls[0][0].data).toMatchObject({ status: 'DONE', note: 'Billing is the second tab now.', handledById: 'usr-boss' });
    const reply = (prisma.alert.create as any).mock.calls.map((c: any) => c[0].data).find((d: any) => d.rule === 'FEEDBACK_LOOKED_AT');
    expect(reply).toMatchObject({
      organizationId: 'org-1',
      severity: 'LOW',
      entityType: 'FeedbackReply',
      entityId: 'usr-emp',
      message: 'Thanks — your note about Money was looked at: Billing is the second tab now.',
    });
  });

  it('editing the reply while it stays Done does not ring again', async () => {
    (prisma.feedback.findFirst as any).mockResolvedValue(stored({ status: 'DONE', note: 'First answer' }));
    await request(app).patch('/api/feedback/fb-1').set(...auth('boss')).send({ status: 'DONE', note: 'Better answer' });
    const rules = (prisma.alert.create as any).mock.calls.map((c: any) => c[0].data.rule);
    expect(rules).not.toContain('FEEDBACK_LOOKED_AT');
  });

  it('Done without a note, or Seen with one, rings nobody', async () => {
    (prisma.feedback.findFirst as any).mockResolvedValue(stored());
    await request(app).patch('/api/feedback/fb-1').set(...auth('boss')).send({ status: 'DONE' });
    await request(app).patch('/api/feedback/fb-1').set(...auth('boss')).send({ status: 'SEEN', note: 'Looking into it' });
    const rules = (prisma.alert.create as any).mock.calls.map((c: any) => c[0].data.rule);
    expect(rules).not.toContain('FEEDBACK_LOOKED_AT');
  });

  it('the reply bells go after two weeks', async () => {
    (prisma.alert.updateMany as any).mockResolvedValue({ count: 2 });
    const now = new Date('2026-11-18T06:00:00Z');
    expect(await closeOldFeedbackReplies(now)).toBe(2);
    const { where } = (prisma.alert.updateMany as any).mock.calls[0][0];
    expect(where.rule).toBe('FEEDBACK_LOOKED_AT');
    expect(where.raisedAt.lt.toISOString()).toBe('2026-11-04T06:00:00.000Z');
  });
});

describe('Management’s one "N new feedback notes" bell', () => {
  it('moves with the count, and comes back unread', async () => {
    (prisma.feedback.count as any).mockResolvedValue(3);
    (prisma.alert.findFirst as any).mockResolvedValue({ id: 'al-1', message: '2 new feedback notes' });
    await refreshFeedbackAlert('org-1');
    expect((prisma.alert.update as any).mock.calls[0][0]).toMatchObject({ where: { id: 'al-1' }, data: { message: '3 new feedback notes' } });
    expect(prisma.alertRead.deleteMany).toHaveBeenCalledWith({ where: { alertId: 'al-1' } });
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('closes when none is New', async () => {
    (prisma.feedback.count as any).mockResolvedValue(0);
    (prisma.alert.findFirst as any).mockResolvedValue({ id: 'al-1', message: '1 new feedback note' });
    await refreshFeedbackAlert('org-1');
    expect((prisma.alert.updateMany as any).mock.calls[0][0].where).toEqual({ organizationId: 'org-1', rule: 'FEEDBACK_NEW', resolvedAt: null });
    expect((prisma.alert.updateMany as any).mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
  });

  it('Seen takes a note out of the count', async () => {
    (prisma.feedback.findFirst as any).mockResolvedValue({ id: 'fb-1', userId: 'usr-emp', screen: null, status: 'NEW', note: null, handledAt: null });
    (prisma.feedback.update as any).mockResolvedValue({ id: 'fb-1', status: 'SEEN', note: null, handledAt: new Date(), handledBy: null });
    (prisma.feedback.count as any).mockResolvedValue(0);
    (prisma.alert.findFirst as any).mockResolvedValue({ id: 'al-1', message: '1 new feedback note' });
    await request(app).patch('/api/feedback/fb-1').set(...auth('boss')).send({ status: 'SEEN' });
    expect((prisma.feedback.count as any).mock.calls[0][0].where).toEqual({ organizationId: 'org-1', status: 'NEW' });
    expect((prisma.alert.updateMany as any).mock.calls[0][0].where.rule).toBe('FEEDBACK_NEW');
  });
});

describe('the rules', () => {
  it('are raised outside the scanner, so it never closes them', () => {
    expect(EXTERNAL_RULES).toEqual(expect.arrayContaining(['FEEDBACK_NEW', 'FEEDBACK_LOOKED_AT', 'USAGE_REVIEW']));
    expect(MANAGEMENT_RULES).toEqual(expect.arrayContaining(['FEEDBACK_NEW', 'USAGE_REVIEW']));
  });

  it('reach Management, and the sender about themselves', async () => {
    (prisma.alert.findMany as any).mockResolvedValue([]);
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.internalProject.findMany as any).mockResolvedValue([]);
    (prisma.user.findMany as any).mockResolvedValue([]);
    const openRules = (clauses: any[]) => clauses.find((c) => c.rule && typeof c.rule === 'object' && 'in' in c.rule)?.rule.in ?? [];
    const boss = await alertClausesFor(session('boss'));
    const head = await alertClausesFor(session('head'));
    const emp = await alertClausesFor(session('emp'));
    expect(openRules(boss)).toEqual(expect.arrayContaining(['FEEDBACK_NEW', 'USAGE_REVIEW']));
    // setup.admin runs Settings, not Feedback or Usage.
    expect(openRules(head)).not.toContain('FEEDBACK_NEW');
    expect(openRules(head)).not.toContain('USAGE_REVIEW');
    expect(openRules(emp)).not.toContain('FEEDBACK_NEW');
    // "Your note was looked at" reaches its sender and only its sender.
    expect(emp).toContainEqual({ rule: 'FEEDBACK_LOOKED_AT', entityType: 'FeedbackReply', entityId: 'usr-emp' });
    expect(boss).toContainEqual({ rule: 'FEEDBACK_LOOKED_AT', entityType: 'FeedbackReply', entityId: 'usr-boss' });
    expect(JSON.stringify(boss)).not.toContain('"entityId":"usr-emp"');
  });
});

describe('the Screens view', () => {
  it('flags nobody, and under a third', () => {
    expect(flagFor(0, 5)).toBe('NOBODY');
    expect(flagFor(1, 4)).toBe('UNDER_A_THIRD');
    expect(flagFor(1, 3)).toBeNull();
    expect(flagFor(0, 0)).toBeNull();
  });

  it('counts the active people who opened it, out of those who can', async () => {
    (prisma.user.findMany as any).mockResolvedValue(
      Object.values(PEOPLE).map((p) => ({ id: p.id, email: 'x@y', name: p.name, preset: p.preset, permissions: p.permissions })),
    );
    (prisma.usageDay.groupBy as any).mockResolvedValue([
      { screen: 'my-work', userId: 'usr-emp' },
      { screen: 'my-work', userId: 'usr-boss' },
      { screen: 'my-work', userId: 'usr-gone' }, // switched off since: not counted
      { screen: 'calendar', userId: 'usr-emp' },
    ]);
    const { screens, from, to } = await screensReview('org-1', new Date('2026-11-18T06:00:00Z'));
    expect([from, to]).toEqual(['2026-10-20', '2026-11-18']);
    const row = (key: string) => screens.find((s) => s.key === key)!;
    expect(row('my-work')).toMatchObject({ openedBy: 2, canOpen: 3, flag: null });
    expect(row('calendar')).toMatchObject({ openedBy: 1, canOpen: 3, flag: null });
    // Money: Management, and the Head through setup.admin — nobody opened it.
    expect(row('money')).toMatchObject({ openedBy: 0, canOpen: 2, flag: 'NOBODY' });
    // Logins and Subscriptions are Management's by preset: setup.admin does not count.
    expect(row('logins')).toMatchObject({ canOpen: 1 });
    // Counts only: no names or ids in the answer.
    expect(JSON.stringify(screens)).not.toMatch(/usr-|Ravi|Akmal/);
  });

  it('is Management only, and opening it closes the review bell', async () => {
    (prisma.user.findMany as any).mockResolvedValue([]);
    (prisma.usageDay.groupBy as any).mockResolvedValue([]);
    const head = await request(app).get('/api/usage/screens').set(...auth('head'));
    expect(head.status).toBe(403);
    const boss = await request(app).get('/api/usage/screens').set(...auth('boss'));
    expect(boss.status).toBe(200);
    expect(boss.body.screens.length).toBeGreaterThan(10);
    expect((prisma.alert.updateMany as any).mock.calls[0][0].where).toEqual({ organizationId: 'org-1', rule: 'USAGE_REVIEW', resolvedAt: null });
  });
});

describe('the monthly review bell', () => {
  beforeEach(() => {
    (prisma.organization.findMany as any).mockResolvedValue([{ id: 'org-1', timezone: 'Asia/Kolkata' }]);
  });

  it('arrives on the studio’s 1st, for last month, and closes the one before', async () => {
    // 00:30 on 1 December in Chennai is still 30 November in UTC.
    const n = await raiseUsageReviews(new Date('2026-11-30T19:00:00Z'));
    expect(n).toBe(1);
    expect((prisma.alert.updateMany as any).mock.calls[0][0].where).toEqual({ organizationId: 'org-1', rule: 'USAGE_REVIEW', resolvedAt: null });
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({
      rule: 'USAGE_REVIEW',
      severity: 'LOW',
      entityType: 'UsageReview',
      entityId: 'org-1:2026-11',
      message: 'Usage review for November is ready',
    });
  });

  it('comes once a month, and not late in the month', async () => {
    (prisma.alert.findFirst as any).mockResolvedValue({ id: 'al-9' });
    expect(await raiseUsageReviews(new Date('2026-12-02T06:00:00Z'))).toBe(0);
    (prisma.alert.findFirst as any).mockResolvedValue(null);
    expect(await raiseUsageReviews(new Date('2026-11-18T06:00:00Z'))).toBe(0);
    expect(prisma.alert.create).not.toHaveBeenCalled();
    // January reviews December.
    expect(await raiseUsageReviews(new Date('2027-01-03T06:00:00Z'))).toBe(1);
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({ entityId: 'org-1:2026-12', message: 'Usage review for December is ready' });
  });
});
