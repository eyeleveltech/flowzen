import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { evaluateAgencyHealthRules } from '../workers/scanner.cron.js';

/**
 * A month with no fee (2026-10-16): work done for a client before their
 * retainer starts — Her Will's October — sits on a ₹0 month card. There is
 * nothing to bill, so nothing may ask for a proforma or an invoice for it.
 */

const p = prisma as any;
const BOSS = { id: 'usr-boss', preset: RolePreset.MANAGEMENT, permissions: [] as string[] };
const auth = `Bearer ${signJwt({ userId: BOSS.id, organizationId: 'org-1', email: 'boss@x', preset: BOSS.preset, permissions: [] } as never)}`;

const card = (over: Record<string, unknown> = {}) => ({
  id: 'mc-oct',
  month: '2026-10',
  status: 'OPEN',
  revenue: 0,
  invoiceId: null,
  invoice: null,
  retainer: { id: 'ret-hw', billing: 'IN_ADVANCE', gstPercent: null, status: 'ACTIVE', company: { id: 'co-hw', name: 'Her Will' } },
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T06:00:00Z'));
  p.user.findUnique.mockResolvedValue({ ...BOSS, organizationId: 'org-1', name: 'Akmal', email: 'boss@x', active: true, sessionsValidFrom: null });
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', fyStartMonth: 4 });
  p.proforma.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('a month with no fee', () => {
  it('raises neither "proforma not raised" nor "month not invoiced"', async () => {
    p.proposal.findMany.mockResolvedValue([]);
    for (const m of ['retainer', 'invoice', 'project', 'user', 'company', 'asset', 'assetMovement', 'assetMaintenance']) {
      p[m].findMany.mockResolvedValue([]);
    }
    p.task.findMany.mockResolvedValue([]);
    p.task.groupBy.mockResolvedValue([]);
    p.peopleAllocation.groupBy.mockResolvedValue([]);
    p.peopleAllocation.count.mockResolvedValue(0);
    p.monthCard.findMany.mockResolvedValue([]);

    await evaluateAgencyHealthRules('org-1');
    const wheres = p.monthCard.findMany.mock.calls.map((c: any) => c[0].where);
    // Both billing rules ask only about months that carry a fee.
    const closed = wheres.find((w: any) => w.status === 'CLOSED' && 'invoiceId' in w);
    const thisMonth = wheres.find((w: any) => w.month === '2026-10' && w.retainer?.billing === 'IN_ADVANCE');
    expect(closed.revenue).toEqual({ gt: 0 });
    expect(thisMonth.revenue).toEqual({ gt: 0 });
  });

  it('is not on the billing board', async () => {
    p.monthCard.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/invoices/retainer-billing?month=2026-10').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(p.monthCard.findMany.mock.calls[0][0].where.revenue).toEqual({ gt: 0 });
  });

  it("says there is nothing to bill on the retainer's own page; a month with a fee still asks for its proforma", async () => {
    p.monthCard.findMany.mockResolvedValue([card(), card({ id: 'mc-nov', month: '2026-11', revenue: 235000 })]);
    const res = await request(app).get('/api/invoices/retainer-billing?retainerId=ret-hw').set('Authorization', auth);
    expect(res.status).toBe(200);
    const step = (id: string) => res.body.rows.find((r: any) => r.monthCardId === id).step;
    expect(step('mc-oct')).toBe('NO_FEE');
    expect(step('mc-nov')).toBe('PROFORMA');
    expect(res.body.summary.toRaise).toBe(1);
  });

  it('is never "awaiting an invoice"', async () => {
    p.monthCard.findMany.mockResolvedValue([]);
    p.monthCard.count?.mockResolvedValue?.(0);
    p.milestone?.findMany?.mockResolvedValue?.([]);
    await request(app).get('/api/invoices/awaiting').set('Authorization', auth);
    expect(p.monthCard.findMany.mock.calls[0][0].where).toMatchObject({ invoiceId: null, revenue: { gt: 0 } });
  });
});
