import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';

/**
 * GET /calendar — one list of what is happening when, filtered per layer by
 * the permission of each item's own screen.
 *
 * The three things that matter: a layer the caller cannot see is dropped even
 * when asked for by name (and its table is never read); the window is capped;
 * and a moment (gear due back) lands on the organisation's calendar day, not
 * the server's.
 */

const PEOPLE = {
  employee: { id: 'usr-emp', preset: RolePreset.EMPLOYEE },
  head: { id: 'usr-head', preset: RolePreset.HEAD },
  management: { id: 'usr-boss', preset: RolePreset.MANAGEMENT },
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
    })}`,
  ] as const;

const ALL = 'mine,team,events,money,sales,work,equipment,holidays';
const ask = (who: Who, query: string) => request(app).get(`/api/calendar?${query}`).set(...auth(who));

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const who = Object.values(PEOPLE).find((p) => p.id === where.id);
    if (!who) return null;
    return {
      id: who.id,
      organizationId: 'org-1',
      name: 'Somebody',
      email: 'x@eyelevel.local',
      preset: who.preset,
      permissions: [...ROLE_PRESET_PERMISSIONS[who.preset]],
      active: true,
      sessionsValidFrom: null,
    };
  });
  (prisma.organization.findUnique as any).mockResolvedValue({
    timezone: 'Asia/Kolkata',
    holidays: ['2026-10-20', '2026-12-25'],
    workingDays: [1, 2, 3, 4, 5, 6],
  });
  for (const model of ['task', 'invoice', 'proforma', 'outreachEntry', 'project', 'retainer', 'retainerProject', 'assetMovement', 'calendarEvent'] as const) {
    ((prisma as any)[model].findMany as any).mockResolvedValue([]);
  }
});

describe('GET /calendar — layers', () => {
  it('gives an Employee only My tasks, Meetings & shoots, Equipment and Holidays, whatever they ask for', async () => {
    const res = await ask('employee', `from=2026-10-01&to=2026-10-31&layers=${ALL}`);

    expect(res.status).toBe(200);
    expect(res.body.available).toEqual(['mine', 'events', 'equipment', 'holidays']);
    // Never even read: the team's tasks, money, leads, projects.
    expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
    expect((prisma.task.findMany as any).mock.calls[0][0].where.assignees).toEqual({ some: { userId: 'usr-emp' } });
    for (const model of ['invoice', 'proforma', 'outreachEntry', 'project', 'retainer', 'retainerProject'] as const) {
      expect((prisma as any)[model].findMany, model).not.toHaveBeenCalled();
    }
    expect(res.body.items.map((i: any) => i.layer)).toEqual(['holidays']);
  });

  it('gives a Head Team tasks and Work too, invoices but not proformas, and no leads', async () => {
    const res = await ask('head', `from=2026-10-01&to=2026-10-31&layers=${ALL}`);

    expect(res.body.available).toEqual(['mine', 'team', 'events', 'money', 'work', 'equipment', 'holidays']);
    expect(prisma.task.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.project.findMany).toHaveBeenCalled();
    // money.status is the invoice list; proformas are Proposals' or Money's.
    expect(prisma.invoice.findMany).toHaveBeenCalled();
    expect(prisma.proforma.findMany).not.toHaveBeenCalled();
    expect(prisma.outreachEntry.findMany).not.toHaveBeenCalled();
  });

  it('gives Management every layer, with each item on its day and linked to its screen', async () => {
    (prisma.invoice.findMany as any).mockResolvedValue([
      { id: 'inv-1', number: 'INV-042', amount: 120000, dueAt: new Date('2026-10-15T00:00:00Z'), status: 'RAISED', company: { name: 'Acme' } },
    ]);
    (prisma.outreachEntry.findMany as any).mockResolvedValue([
      { id: 'lead-1', name: 'Pavilion Club', nextActionDate: new Date('2026-10-07T00:00:00Z') },
    ]);
    (prisma.task.findMany as any).mockResolvedValueOnce([
      { id: 't-1', title: 'Reel edit', dueDate: new Date('2026-10-09T00:00:00Z'), dueTime: '17:30', status: 'TODO', assignees: [] },
    ]);

    const res = await ask('management', `from=2026-10-01&to=2026-10-31&layers=${ALL}`);
    expect(res.body.available).toEqual(['mine', 'team', 'events', 'money', 'sales', 'work', 'equipment', 'holidays']);

    const byKind = Object.fromEntries(res.body.items.map((i: any) => [i.kind, i]));
    expect(byKind.invoice_due).toMatchObject({ date: '2026-10-15', link: '/money', title: 'INV-042 · Acme · ₹1,20,000 due', draggable: false });
    expect(byKind.lead_follow_up).toMatchObject({ date: '2026-10-07', link: '/outreach' });
    expect(byKind.task).toMatchObject({ date: '2026-10-09', time: '17:30', allDay: false, link: '/my-work?task=t-1', draggable: true });
  });

  it('keeps a layer that was not asked for out, even when allowed', async () => {
    const res = await ask('management', 'from=2026-10-01&to=2026-10-31&layers=holidays');
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(res.body.items).toEqual([expect.objectContaining({ kind: 'holiday', date: '2026-10-20' })]);
  });
});

describe('GET /calendar — the window', () => {
  it('answers 62 days and refuses 63', async () => {
    expect((await ask('employee', 'from=2026-10-01&to=2026-12-01')).status).toBe(200);
    const res = await ask('employee', 'from=2026-10-01&to=2026-12-02');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/62 days/);
  });

  it('refuses an end before the start, and a date that is not a date', async () => {
    expect((await ask('employee', 'from=2026-10-10&to=2026-10-01')).status).toBe(400);
    expect((await ask('employee', 'from=10/01/2026&to=2026-10-31')).status).toBe(400);
  });
});

describe('GET /calendar — dates on the organisation’s clock', () => {
  it('puts gear due back late on the 14th UTC on the 15th in Kolkata, red once it is past', async () => {
    (prisma.assetMovement.findMany as any).mockResolvedValue([
      // 20:00 UTC on the 14th is 01:30 on the 15th in India.
      { id: 'mv-1', assetId: 'as-1', dueAt: new Date('2026-10-14T20:00:00Z'), asset: { tag: 'EL/CAM/001', name: 'Sony A7 IV' }, user: { name: 'Dharshini' } },
      // Due back long ago: overdue.
      { id: 'mv-2', assetId: 'as-2', dueAt: new Date('2020-01-01T05:00:00Z'), asset: { tag: 'EL/LEN/002', name: '24-70mm' }, user: { name: 'Akmal' } },
    ]);

    const res = await ask('employee', 'from=2026-10-15&to=2026-10-15&layers=equipment');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      kind: 'gear_due_back',
      date: '2026-10-15',
      link: '/assets/as-1',
      title: 'EL/CAM/001 Sony A7 IV due back · Dharshini',
    });

    const old = await ask('employee', 'from=2019-12-01&to=2020-01-31&layers=equipment');
    expect(old.body.items[0]).toMatchObject({ date: '2020-01-01', overdue: true });
  });
});
