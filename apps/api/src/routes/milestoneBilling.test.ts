import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { nextDocumentNumber } from '../utils/documentNumber.js';
import { expireLapsedProformas } from '../services/proformaExpiry.js';

/**
 * Money Plan 2 — Accounts bills projects (11), one invoice per milestone and
 * no orphaned proformas (10), proforma alerts reach Accounts and lapsed ones
 * expire (12), a reprice never leaves an old-fee proforma silent (13), and
 * the invoice number's year is the invoice's own (8). Plus salaries are not a
 * cost (3).
 */

// Accounts: money.figures, and no work.all — the person the project page bounced.
const ACCOUNTS = {
  id: 'usr-accounts',
  organizationId: 'org-1',
  name: 'Accounts',
  email: 'accounts@x',
  preset: RolePreset.ACCOUNTS,
  permissions: ['money.status', 'money.figures', 'cost.enter', 'company.read', 'company.write'],
  active: true,
  sessionsValidFrom: null,
};
const token = `Bearer ${signJwt({ userId: ACCOUNTS.id, organizationId: 'org-1', email: ACCOUNTS.email, preset: ACCOUNTS.preset, permissions: ACCOUNTS.permissions } as never)}`;
const p = prisma as any;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

beforeEach(() => {
  p.user.findUnique.mockImplementation(async ({ where }: any) => (where.id === ACCOUNTS.id ? ACCOUNTS : null));
  p.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata', financialYearStart: 4, proformaPrefix: 'EL/PI' });
  p.activity.create.mockResolvedValue({});
  p.$transaction.mockImplementation(async (fn: any) => fn(p));
});

describe('Accounts can bill a project from /money', () => {
  it('lists the milestones to bill: the next one per project, and every one with a document out', async () => {
    const project = (id: string) => ({ id, name: `Project ${id}`, status: 'LIVE', company: { id: 'co-1', name: 'Suvai' } });
    p.milestone.findMany.mockResolvedValue([
      { id: 'm1', label: 'Advance', percent: 40, amount: 40000, status: 'INVOICED', order: 0, project: project('a'), proformas: [], invoices: [{ id: 'inv-1', number: 'EL/INV/26-27/001', amount: 47200, gstAmount: 7200, status: 'RAISED', dueAt: day('2026-10-30'), payments: [{ amount: 7200 }] }] },
      { id: 'm2', label: 'Draft', percent: 30, amount: 30000, status: 'PENDING', order: 1, project: project('a'), proformas: [], invoices: [] },
      { id: 'm3', label: 'Final', percent: 30, amount: 30000, status: 'PENDING', order: 2, project: project('a'), proformas: [], invoices: [] },
      { id: 'm4', label: 'Advance', percent: 50, amount: 50000, status: 'PROFORMA_RAISED', order: 0, project: project('b'), proformas: [{ id: 'pf-1', number: 'EL/PI/01-10-2026/004', status: 'UNPAID', amount: 50000, total: 59000, validTill: day('2026-10-15') }], invoices: [] },
    ]);
    const res = await request(app).get('/api/money/milestones').set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: any) => [r.id, r.next])).toEqual([
      ['m1', 'PAYMENT'],
      ['m2', 'PROFORMA'],
      ['m4', 'INVOICE'],
    ]);
    expect(res.body.rows[0].invoice).toMatchObject({ balanceDue: 40000, partPaid: true, state: 'PART_PAID' });
    // Live and delivered projects, not sample work, not deleted.
    expect(p.milestone.findMany.mock.calls[0][0].where.project).toMatchObject({ organizationId: 'org-1', deletedAt: null, isSample: false });
  });

  describe('recording a milestone invoice', () => {
    beforeEach(() => {
      p.company.findFirst.mockResolvedValue({ id: 'co-1', name: 'Suvai', organizationId: 'org-1' });
      p.project.findFirst.mockResolvedValue({ id: 'prj-1', isSample: false });
      p.milestone.findFirst.mockResolvedValue({ id: 'm1', label: 'Advance', status: 'PROFORMA_RAISED', projectId: 'prj-1', invoices: [] });
      p.proforma.findFirst.mockResolvedValue({ id: 'pf-1' });
      p.$queryRaw.mockResolvedValue([]);
      p.invoice.findFirst.mockResolvedValue(null);
      p.invoice.create.mockImplementation(async ({ data }: any) => ({ id: 'inv-new', ...data, company: { name: 'Suvai' } }));
      p.proforma.update.mockResolvedValue({});
      p.milestone.update.mockResolvedValue({});
    });
    const record = () =>
      request(app)
        .post('/api/invoices')
        .set('Authorization', token)
        .send({ companyId: 'co-1', projectId: 'prj-1', milestoneId: 'm1', amount: 47200, gstAmount: 7200, customNumber: 'T/101', raisedAt: '2026-10-05' });

    it('is allowed with money.figures and no work.all — and links the proforma standing against the milestone', async () => {
      const res = await record();
      expect(res.status).toBe(201);
      expect(p.invoice.create.mock.calls[0][0].data).toMatchObject({ milestoneId: 'm1', proformaId: 'pf-1' });
      expect(p.proforma.update).toHaveBeenCalledWith({ where: { id: 'pf-1' }, data: { invoiceId: 'inv-new' } });
      // The standing proforma is found by its milestone, not yet invoiced.
      expect(p.proforma.findFirst.mock.calls.at(-1)[0].where).toMatchObject({ milestoneId: 'm1', invoiceId: null });
    });

    it('refuses a second invoice for the same milestone', async () => {
      p.milestone.findFirst.mockResolvedValue({ id: 'm1', label: 'Advance', status: 'INVOICED', projectId: 'prj-1', invoices: [{ id: 'inv-1', status: 'RAISED' }] });
      const res = await record();
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already has an invoice/);
      expect(p.invoice.create).not.toHaveBeenCalled();
    });

    it('and refuses it under a lock, when two people record it at the same moment', async () => {
      // Both pass the look-up before the transaction; the second finds the
      // first once it holds the milestone row.
      p.invoice.findFirst.mockResolvedValue({ number: 'T/100' });
      const res = await record();
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already has invoice T\/100/);
      expect(p.$queryRaw).toHaveBeenCalled();
      expect(p.invoice.create).not.toHaveBeenCalled();
    });
  });
});

describe('the invoice number carries the year of the invoice’s own date', () => {
  afterEach(() => vi.useRealTimers());

  it('an invoice dated 31 March and entered on 2 April is last year’s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-04-02T06:00:00Z'));
    p.invoice.findMany.mockResolvedValue([]);
    expect(await nextDocumentNumber('org-1', 'INVOICE', day('2027-03-31'))).toBe('EL/INV/26-27/001');
    expect(await nextDocumentNumber('org-1', 'INVOICE', day('2027-04-01'))).toBe('EL/INV/27-28/001');
  });

  it('with no date, today where the studio is: 1 April 00:30 in Chennai is the new year', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-31T19:00:00Z'));
    p.invoice.findMany.mockResolvedValue([]);
    expect(await nextDocumentNumber('org-1', 'INVOICE')).toBe('EL/INV/27-28/001');
  });
});

describe('proforma alerts reach Accounts, and a lapsed proforma expires', () => {
  it('Accounts is shown PROFORMA_UNPAID and PROFORMA_EXPIRED', async () => {
    p.taskApprover.findMany.mockResolvedValue([]);
    p.approvalEscalationContact.findMany.mockResolvedValue([]);
    p.task.findMany.mockResolvedValue([]);
    p.alert.findMany.mockResolvedValue([]);
    p.alert.count.mockResolvedValue(0);
    p.alertRead.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/notifications').set('Authorization', token);
    expect(res.status).toBe(200);
    const where = JSON.stringify(p.alert.findMany.mock.calls[0][0].where);
    expect(where).toContain('PROFORMA_UNPAID');
    expect(where).toContain('PROFORMA_EXPIRED');
  });

  it('UNPAID past its valid-till date becomes EXPIRED, logged with the status it had', async () => {
    p.proforma.findMany.mockResolvedValue([
      { id: 'pf-old', number: 'EL/PI/01-09-2026/001', validTill: day('2026-09-15'), company: { name: 'Suvai' } },
      { id: 'pf-billed', number: 'EL/PI/01-09-2026/002', validTill: day('2026-09-15'), company: { name: 'Suvai' } },
    ]);
    // An invoice points at the second one: it was billed, so it is left alone.
    p.invoice.findMany.mockResolvedValue([{ proformaId: 'pf-billed' }]);
    p.proforma.updateMany.mockResolvedValue({ count: 1 });

    const n = await expireLapsedProformas('org-1', new Date('2026-10-05T20:00:00Z'));
    expect(n).toBe(1);
    const find = p.proforma.findMany.mock.calls[0][0].where;
    // Only UNPAID, never one with an invoice; "past" by the Chennai calendar (the 6th).
    expect(find).toMatchObject({ status: 'UNPAID', invoiceId: null });
    expect(find.validTill.lt.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(p.proforma.updateMany).toHaveBeenCalledTimes(1);
    expect(p.proforma.updateMany).toHaveBeenCalledWith({ where: { id: 'pf-old', status: 'UNPAID', invoiceId: null }, data: { status: 'EXPIRED' } });
    expect(p.activity.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'Proforma',
      entityId: 'pf-old',
      verb: 'proforma_expired',
      payload: { from: 'UNPAID', to: 'EXPIRED' },
    });
  });

  it('a person changing a proforma’s status is on the record', async () => {
    p.proforma.findFirst.mockResolvedValue({ id: 'pf-1', number: 'EL/PI/1', status: 'UNPAID', milestoneId: null });
    p.proforma.update.mockResolvedValue({ id: 'pf-1', status: 'CANCELLED' });
    const res = await request(app).patch('/api/proformas/pf-1/status').set('Authorization', token).send({ status: 'CANCELLED' });
    expect(res.status).toBe(200);
    expect(p.activity.create.mock.calls[0][0].data).toMatchObject({ verb: 'proforma_status_changed', payload: { from: 'UNPAID', to: 'CANCELLED' } });
  });
});

describe('repricing a retainer with a proforma out at the old fee', () => {
  it('names the proforma, so it can be cancelled and raised again', async () => {
    p.retainer.findFirst.mockResolvedValue({
      id: 'ret-1',
      organizationId: 'org-1',
      status: 'ACTIVE',
      monthlyValue: 40000,
      gstPercent: 18,
      billing: 'IN_ADVANCE',
      startDate: day('2026-01-01'),
      termMonths: null,
      ownerId: 'usr-accounts',
      company: { name: 'Suvai' },
    });
    p.retainer.update.mockResolvedValue({ id: 'ret-1', monthlyValue: 50000 });
    p.monthCard.updateMany.mockResolvedValue({ count: 1 });
    p.monthCard.findMany.mockResolvedValue([{ id: 'card-oct', month: '2026-10' }]);
    p.proforma.findMany.mockResolvedValue([{ id: 'pf-oct', number: 'EL/PI/01-10-2026/002', amount: 40000, sourceId: 'card-oct' }]);
    const res = await request(app).patch('/api/retainers/ret-1').set('Authorization', token).send({ monthlyValue: 50000 });
    expect(res.status).toBe(200);
    expect(res.body.staleProformas).toEqual([{ id: 'pf-oct', number: 'EL/PI/01-10-2026/002', amount: 40000, month: '2026-10', monthCardId: 'card-oct' }]);
    expect(p.proforma.findMany.mock.calls[0][0].where).toMatchObject({ sourceType: 'MONTH_CARD', status: 'UNPAID', invoiceId: null });
  });
});

describe('salaries are not a cost', () => {
  it('a new "Salaries" cost is refused', async () => {
    const res = await request(app)
      .post('/api/costs')
      .set('Authorization', token)
      .send({ type: 'COMPANY', category: 'Salaries', vendor: 'Payroll', amount: 662000, incurredAt: '2026-10-01' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SALARY_NOT_A_COST');
    expect(p.cost.create).not.toHaveBeenCalled();
  });
});
