import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * The months nobody has billed for.
 *
 * ─── Why this list had nowhere to live ──────────────────────────────────────
 *
 * Raising the invoices is ACCOUNTS' job, and ACCOUNTS holds `money.figures`
 * and not `work.all`. So she could raise one — the form asks for a company and
 * what to bill against, and it works — and had no way to see WHICH months were
 * waiting: /live-work, /retainers/:id and /projects/:id are all behind
 * `work.all` and bounce her to My Work. The alert that would have told her,
 * MONTH_CARD_NOT_INVOICED, reaches her correctly on `money.status` and then
 * links to /live-work, which she cannot open.
 *
 * ─── What counts as waiting ─────────────────────────────────────────────────
 *
 * Every uninvoiced month card, split by whether it can be billed yet. A month
 * that has ended is owed for now; so is a card closed early because somebody
 * stopped the retainer part way through. One still running is the forward
 * view, and showing it is what makes this a work list rather than a rebuke.
 */

const auth = (preset: RolePreset, permissions: string[]) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: 'usr-1',
      organizationId: 'org-1',
      email: 'x@eyelevel.local',
      preset,
      permissions,
    })}`,
  ] as const;

const ACCOUNTS = auth(RolePreset.ACCOUNTS, ['work.own', 'company.read', 'money.status', 'money.figures', 'cost.enter']);
const HEAD = auth(RolePreset.HEAD, ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter']);

const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const lastMonth = (() => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

const card = (id: string, month: string, status: string, over: Partial<{ closedAt: Date; stopped: boolean }> = {}) => ({
  id,
  month,
  revenue: 30000,
  status,
  closedAt: over.closedAt ?? null,
  retainer: {
    status: over.stopped ? 'STOPPED' : 'ACTIVE',
    company: { id: 'co-1', name: 'Right Hospitals' },
  },
});

beforeEach(() => {
  (prisma.user.findUnique as any).mockResolvedValue({
    id: 'usr-1',
    organizationId: 'org-1',
    name: 'Priya',
    email: 'x@eyelevel.local',
    preset: RolePreset.ACCOUNTS,
    permissions: ['work.own', 'company.read', 'money.status', 'money.figures', 'cost.enter'],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.monthCard.findMany as any).mockResolvedValue([]);
});

const get = (who = ACCOUNTS) => request(app).get('/api/invoices/awaiting').set(...who);

describe('the months waiting for an invoice', () => {
  it('asks only for cards with no invoice against them', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { where } = (prisma.monthCard.findMany as any).mock.calls.at(-1)[0];
    expect(where.invoiceId).toBeNull();
    expect(where.retainer).toEqual({ organizationId: 'org-1' });
  });

  it('counts a month that has ended as owed', async () => {
    (prisma.monthCard.findMany as any).mockResolvedValue([card('mc-1', lastMonth, 'OPEN')]);
    const res = await get();
    expect(res.body.rows[0].due).toBe(true);
    expect(res.body.dueCount).toBe(1);
    expect(res.body.dueTotal).toBe(30000);
  });

  it('counts a closed card as owed even inside its own month', async () => {
    // Stopping a retainer part way through closes the card it was worked on.
    // The work happened, so the money is owed now rather than at month end.
    (prisma.monthCard.findMany as any).mockResolvedValue([
      card('mc-1', thisMonth, 'CLOSED', { closedAt: now, stopped: true }),
    ]);
    const res = await get();
    expect(res.body.rows[0].due).toBe(true);
    expect(res.body.rows[0].retainerStopped).toBe(true);
  });

  it('keeps a month still running in the list, but not as owed', async () => {
    // The forward view. Dropping it would leave the screen empty for most of
    // the month and make the list read as a rebuke rather than a work list.
    (prisma.monthCard.findMany as any).mockResolvedValue([card('mc-1', thisMonth, 'OPEN')]);
    const res = await get();
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].due).toBe(false);
    expect(res.body.dueCount).toBe(0);
    expect(res.body.upcomingCount).toBe(1);
  });

  it('names the client, since the person billing cannot open the retainer', async () => {
    (prisma.monthCard.findMany as any).mockResolvedValue([card('mc-1', lastMonth, 'CLOSED')]);
    const res = await get();
    expect(res.body.rows[0].companyName).toBe('Right Hospitals');
    expect(res.body.rows[0].companyId).toBe('co-1');
  });

  it('is closed to somebody without the figures', async () => {
    // A Head holds `money.status` and would see the alert, but these rows are
    // fees — the same gate the Money screen itself runs on.
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'usr-1',
      organizationId: 'org-1',
      name: 'Dilshad',
      email: 'x@eyelevel.local',
      preset: RolePreset.HEAD,
      permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'],
      active: true,
      sessionsValidFrom: null,
    });
    const res = await get(HEAD);
    expect(res.status).toBe(403);
  });

  it('is not swallowed by the /:id route', async () => {
    // `/awaiting` is declared before `/invoices/:id`; the other order makes it
    // a lookup for an invoice with that id, which 404s.
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rows');
  });
});
