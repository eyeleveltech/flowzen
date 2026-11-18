import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { gettingStartedFor } from './gettingStarted.js';
import * as google from './googleCalendar.js';
import * as push from './push.js';

/**
 * Getting started (Ease Plan 2): each step worked out from what already
 * exists, for one person or several, never outside their organisation.
 */

const p = prisma as any;

beforeEach(() => {
  p.user.findMany.mockResolvedValue([
    { id: 'u-new', phone: null, gettingStartedHiddenAt: null },
    { id: 'u-busy', phone: ' 98400 12345 ', gettingStartedHiddenAt: new Date('2026-11-10') },
  ]);
  p.pushSubscription.groupBy.mockResolvedValue([{ userId: 'u-busy' }]);
  p.task.groupBy.mockResolvedValue([{ createdById: 'u-busy' }]);
  p.taskAssignee.groupBy.mockResolvedValue([{ userId: 'u-busy' }]);
  p.usageDay.groupBy.mockResolvedValue([]);
  p.googleCalendarConnection.findMany.mockResolvedValue([{ userId: 'u-busy' }]);
  vi.spyOn(google, 'googleConfigured').mockReturnValue(false);
  // Phone notifications on: the server has the keys, the organisation's switch is on.
  vi.spyOn(push, 'pushConfigured').mockReturnValue(true);
  p.organization.findUnique.mockResolvedValue({ pushEnabled: true });
});

describe('each step', () => {
  it('a brand-new person has nothing done', async () => {
    const s = (await gettingStartedFor('org-1', ['u-new', 'u-busy'])).get('u-new')!;
    expect(s).toMatchObject({ hidden: false, done: 0, total: 5, complete: false });
    expect(s.steps.map((x) => x.key)).toEqual(['phone', 'phoneApp', 'firstTask', 'finishTask', 'howItWorks']);
    expect(s.steps.every((x) => !x.done)).toBe(true);
  });

  it('ticks what is already true for somebody who has been here a while', async () => {
    const s = (await gettingStartedFor('org-1', ['u-new', 'u-busy'])).get('u-busy')!;
    expect(Object.fromEntries(s.steps.map((x) => [x.key, x.done]))).toEqual({
      phone: true,
      phoneApp: true,
      firstTask: true,
      finishTask: true,
      howItWorks: false,
    });
    expect(s).toMatchObject({ done: 4, total: 5, complete: false, hidden: true });
  });

  it('a blank phone number does not count', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u-new', phone: '   ', gettingStartedHiddenAt: null }]);
    expect((await gettingStartedFor('org-1', ['u-new'])).get('u-new')!.steps[0]).toEqual({ key: 'phone', done: false });
  });

  it('reads each step from the right place', async () => {
    p.usageDay.groupBy.mockResolvedValue([{ userId: 'u-new' }]);
    await gettingStartedFor('org-1', ['u-new']);
    // A phone of theirs subscribed to notifications.
    expect(p.pushSubscription.groupBy.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', userId: { in: ['u-new'] } });
    // A task they wrote down — the scanner's follow-ups, made under their name, do not count.
    expect(p.task.groupBy.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      createdById: { in: ['u-new'] },
      OR: [{ workId: null }, { NOT: { workId: { startsWith: 'proposal_followup:' } } }],
    });
    // A task they are on that is Done — by the tick, the dropdown, the drawer or Zen alike.
    expect(p.taskAssignee.groupBy.mock.calls[0][0].where).toEqual({
      userId: { in: ['u-new'] },
      task: { organizationId: 'org-1', status: 'DONE', deletedAt: null },
    });
    // How it works opened at least once.
    expect(p.usageDay.groupBy.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', userId: { in: ['u-new'] }, screen: 'how-it-works' });
  });

  it('is complete once all five are done', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u-busy', phone: '9', gettingStartedHiddenAt: null }]);
    p.usageDay.groupBy.mockResolvedValue([{ userId: 'u-busy' }]);
    expect((await gettingStartedFor('org-1', ['u-busy'])).get('u-busy')).toMatchObject({ done: 5, complete: true });
  });
});

describe('the Google step', () => {
  it('is left out when this server has no Google keys', async () => {
    const s = (await gettingStartedFor('org-1', ['u-busy'])).get('u-busy')!;
    expect(s.steps.some((x) => x.key === 'google')).toBe(false);
    expect(p.googleCalendarConnection.findMany).not.toHaveBeenCalled();
  });

  it('is offered, optional and never counted, when it has them', async () => {
    vi.mocked(google.googleConfigured).mockReturnValue(true);
    const s = (await gettingStartedFor('org-1', ['u-new', 'u-busy'])).get('u-busy')!;
    expect(s.steps.at(-1)).toEqual({ key: 'google', done: true, optional: true });
    expect(s.total).toBe(5);
    expect((await gettingStartedFor('org-1', ['u-new'])).get('u-new')!.steps.at(-1)).toEqual({ key: 'google', done: false, optional: true });
  });
});

describe('the phone step', () => {
  it('is left out when this server has no push keys — nothing could ever tick it', async () => {
    vi.mocked(push.pushConfigured).mockReturnValue(false);
    const s = (await gettingStartedFor('org-1', ['u-new'])).get('u-new')!;
    expect(s.steps.map((x) => x.key)).toEqual(['phone', 'firstTask', 'finishTask', 'howItWorks']);
    expect(s.total).toBe(4);
    expect(p.pushSubscription.groupBy).not.toHaveBeenCalled();
  });

  it("is left out when the organisation's switch is off", async () => {
    p.organization.findUnique.mockResolvedValue({ pushEnabled: false });
    const s = (await gettingStartedFor('org-1', ['u-new'])).get('u-new')!;
    expect(s.steps.some((x) => x.key === 'phoneApp')).toBe(false);
    expect(s.total).toBe(4);
  });

  it('without it, the other four finish the card', async () => {
    p.organization.findUnique.mockResolvedValue({ pushEnabled: false });
    p.user.findMany.mockResolvedValue([{ id: 'u-busy', phone: '9', gettingStartedHiddenAt: null }]);
    p.usageDay.groupBy.mockResolvedValue([{ userId: 'u-busy' }]);
    expect((await gettingStartedFor('org-1', ['u-busy'])).get('u-busy')).toMatchObject({ done: 4, total: 4, complete: true });
  });
});

describe('one organisation only', () => {
  it('every read is narrowed to the organisation asked for', async () => {
    vi.mocked(google.googleConfigured).mockReturnValue(true);
    await gettingStartedFor('org-2', ['u-new']);
    expect(p.user.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-2', id: { in: ['u-new'] } });
    expect(p.organization.findUnique.mock.calls[0][0].where).toEqual({ id: 'org-2' });
    expect(p.pushSubscription.groupBy.mock.calls[0][0].where.organizationId).toBe('org-2');
    expect(p.task.groupBy.mock.calls[0][0].where.organizationId).toBe('org-2');
    expect(p.taskAssignee.groupBy.mock.calls[0][0].where.task.organizationId).toBe('org-2');
    expect(p.usageDay.groupBy.mock.calls[0][0].where.organizationId).toBe('org-2');
    expect(p.googleCalendarConnection.findMany.mock.calls[0][0].where.organizationId).toBe('org-2');
  });

  it('somebody not in that organisation gets no answer at all', async () => {
    p.user.findMany.mockResolvedValue([]);
    expect((await gettingStartedFor('org-2', ['u-new'])).has('u-new')).toBe(false);
  });
});

describe('the routes', () => {
  const as = () => {
    p.user.findUnique.mockResolvedValue({
      id: 'u-new', organizationId: 'org-1', name: 'New', email: 'new@eyelevel.local',
      preset: RolePreset.EMPLOYEE, permissions: [], active: true, sessionsValidFrom: null,
    });
    return ['Authorization', `Bearer ${signJwt({ userId: 'u-new', organizationId: 'org-1', email: 'new@eyelevel.local', preset: RolePreset.EMPLOYEE, permissions: [] })}`] as const;
  };

  it('GET answers for the caller alone', async () => {
    const res = await request(app).get('/api/me/getting-started').set(...as());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, hidden: false, done: 0, total: 5 });
    expect(p.user.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', id: { in: ['u-new'] } });
  });

  it('PATCH hides it and shows it again, on the caller’s own record only', async () => {
    p.user.updateMany.mockResolvedValue({ count: 1 });
    const hide = await request(app).patch('/api/me/getting-started').set(...as()).send({ hidden: true });
    expect(hide.status).toBe(200);
    expect(p.user.updateMany.mock.calls[0][0].where).toEqual({ id: 'u-new', organizationId: 'org-1' });
    expect(p.user.updateMany.mock.calls[0][0].data.gettingStartedHiddenAt).toBeInstanceOf(Date);
    await request(app).patch('/api/me/getting-started').set(...as()).send({ hidden: false });
    expect(p.user.updateMany.mock.calls[1][0].data).toEqual({ gettingStartedHiddenAt: null });
    expect((await request(app).patch('/api/me/getting-started').set(...as()).send({ hidden: 'yes' })).status).toBe(400);
  });
});
