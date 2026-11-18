import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

/**
 * PATCH /api/profile/menu (Ease Plan 3, decisions 9–12): a person's pinned and
 * hidden sidebar items. Pins never grant access — only hrefs of items this
 * person is offered now are kept, by the sidebar's own rule.
 */

const p = prisma as any;
const ME = 'usr-me';

const as = (preset: RolePreset, permissions: string[] = [], userId = ME, organizationId = 'org-1') => {
  p.user.findUnique.mockResolvedValue({
    id: userId, organizationId, name: 'Me', email: 'me@eyelevel.local',
    preset, permissions, active: true, sessionsValidFrom: null,
  });
  p.user.updateMany.mockResolvedValue({ count: 1 });
  return ['Authorization', `Bearer ${signJwt({ userId, organizationId, email: 'me@eyelevel.local', preset, permissions: [] })}`] as const;
};

const save = (auth: readonly [string, string], body: unknown) =>
  request(app).patch('/api/profile/menu').set(...auth).send(body as object);

/** What was written to the row. */
const written = () => p.user.updateMany.mock.calls[0][0];

describe('pins never grant access', () => {
  it('an Employee cannot pin Money; what they can open is kept', async () => {
    const res = await save(as(RolePreset.EMPLOYEE), { pinned: ['/money', '/calendar'], hidden: ['/assets'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, pinned: ['/calendar'], hidden: ['/assets'] });
    expect(written().data).toEqual({ navPinned: ['/calendar'], navHidden: ['/assets'] });
  });

  it('Management can pin Money, in the order it was pinned', async () => {
    const res = await save(as(RolePreset.MANAGEMENT), { pinned: ['/money', '/calendar', '/logins'], hidden: ['/forecast'] });
    expect(res.body).toEqual({ success: true, pinned: ['/money', '/calendar', '/logins'], hidden: ['/forecast'] });
  });

  it('a permission granted on top of the preset counts, as the server enforces it', async () => {
    const res = await save(as(RolePreset.EMPLOYEE, ['money.figures']), { pinned: ['/money'], hidden: [] });
    expect(res.body.pinned).toEqual(['/money']);
  });

  it('refuses Management-only items to a setup.admin who is not Management', async () => {
    // setup.admin opens every permission gate — Setup and Money included — but not the preset gate.
    const res = await save(as(RolePreset.HEAD, ['setup.admin']), {
      pinned: ['/logins', '/subscriptions', '/settings', '/money'],
      hidden: ['/logins'],
    });
    expect(res.body).toEqual({ success: true, pinned: ['/settings', '/money'], hidden: [] });
  });

  it('refuses My department to somebody who heads nothing', async () => {
    p.department.findMany.mockResolvedValue([]);
    const res = await save(as(RolePreset.HEAD), { pinned: ['/my-department', '/members'], hidden: [] });
    expect(res.body.pinned).toEqual(['/members']);
    // Only active departments they head, in their own organisation.
    expect(p.department.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', headId: ME, archivedAt: null });
  });

  it('keeps My department for somebody who heads one', async () => {
    p.department.findMany.mockResolvedValue([{ id: 'd-dev', name: 'Development' }]);
    const res = await save(as(RolePreset.HEAD), { pinned: ['/my-department'], hidden: [] });
    expect(res.body.pinned).toEqual(['/my-department']);
  });

  it('does not read departments at all when nothing heads-only was sent', async () => {
    await save(as(RolePreset.HEAD), { pinned: ['/members'], hidden: [] });
    expect(p.department.findMany).not.toHaveBeenCalled();
  });
});

describe('what is kept', () => {
  it('drops unknown hrefs — screens that are not in the menu, and nonsense', async () => {
    const res = await save(as(RolePreset.MANAGEMENT), {
      pinned: ['/money', '/profile', '/projects/abc', 'https://evil.example', '/how-it-works'],
      hidden: ['/nope', '/forecast'],
    });
    expect(res.body).toEqual({ success: true, pinned: ['/money'], hidden: ['/forecast'] });
  });

  it('never hides My Work — it can still be pinned', async () => {
    const res = await save(as(RolePreset.EMPLOYEE), { pinned: [], hidden: ['/my-work', '/assets'] });
    expect(res.body.hidden).toEqual(['/assets']);
    const pinned = await save(as(RolePreset.EMPLOYEE), { pinned: ['/my-work'], hidden: [] });
    expect(pinned.body.pinned).toEqual(['/my-work']);
  });

  it('keeps each href once, and an href both pinned and hidden is pinned', async () => {
    const res = await save(as(RolePreset.MANAGEMENT), {
      pinned: ['/money', '/calendar', '/money'],
      hidden: ['/money', '/forecast', '/forecast'],
    });
    expect(res.body).toEqual({ success: true, pinned: ['/money', '/calendar'], hidden: ['/forecast'] });
  });

  it('empty lists clear the menu', async () => {
    const res = await save(as(RolePreset.EMPLOYEE), { pinned: [], hidden: [] });
    expect(res.body).toEqual({ success: true, pinned: [], hidden: [] });
    expect(written().data).toEqual({ navPinned: [], navHidden: [] });
  });

  it('refuses a body that is not two lists of hrefs, or far longer than the menu', async () => {
    const auth = as(RolePreset.EMPLOYEE);
    expect((await save(auth, { pinned: '/money' })).status).toBe(400);
    expect((await save(auth, { pinned: [1], hidden: [] })).status).toBe(400);
    expect((await save(auth, { pinned: Array(101).fill('/calendar'), hidden: [] })).status).toBe(400);
    expect(p.user.updateMany).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    const res = await request(app).patch('/api/profile/menu').send({ pinned: [], hidden: [] });
    expect(res.status).toBe(401);
  });
});

describe('only their own row', () => {
  it('writes the session’s own user in the session’s own organisation — a userId in the body is ignored', async () => {
    const res = await save(as(RolePreset.MANAGEMENT, [], 'usr-other-org', 'org-2'), {
      pinned: ['/money'],
      hidden: [],
      userId: ME,
      organizationId: 'org-1',
    });
    expect(res.status).toBe(200);
    expect(p.user.updateMany).toHaveBeenCalledTimes(1);
    expect(written().where).toEqual({ id: 'usr-other-org', organizationId: 'org-2' });
    expect(p.user.update).not.toHaveBeenCalled();
  });
});
