import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { runZenTool, ZEN_TOOLS } from './zenTools.js';

/*
 * The activity log's subject lookup reads every kind of record; the history
 * tool's job here is what it does with the rows, so the subjects are stubbed.
 */
vi.mock('./activityLog.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./activityLog.js')>();
  return { ...real, resolveSubjects: vi.fn(async () => new Map()) };
});

/**
 * Zen's lookups (Zen Plan 3): what they may read and what they hand back.
 *
 *   · the organisation comes from the session, never from the model's arguments;
 *   · no list goes past 50 rows, whatever the model asks for;
 *   · a salary is never itemised — not in the cost register, not in history;
 *   · every row carries a link into the app.
 */

const ORG = 'org-1';
const p = prisma as any;
const run = (name: string, args: Record<string, unknown> = {}) => runZenTool(name, args, ORG) as Promise<any>;
const isLink = (v: unknown) => typeof v === 'string' && v.startsWith('/');

beforeEach(() => {
  p.organization.findUnique.mockResolvedValue({});
  p.company.findFirst.mockResolvedValue({ id: 'co-1', name: 'Acme' });
});

describe('the lookups Zen is given', () => {
  it('include every new one', () => {
    const names = ZEN_TOOLS.map((t) => t.name);
    for (const n of ['getAlerts', 'getApprovals', 'getOutreach', 'getProformas', 'getMonthCard', 'getCosts', 'getForecast', 'getHistory', 'getBrief']) {
      expect(names).toContain(n);
    }
  });
});

describe('organisation scoping', () => {
  it('reads the session organisation even when the model names another', async () => {
    p.alert.findMany.mockResolvedValue([]);
    p.proforma.findMany.mockResolvedValue([]);
    p.monthCard.findMany.mockResolvedValue([]);
    p.project.findMany.mockResolvedValue([]);
    p.cost.findMany.mockResolvedValue([]);
    p.outreachEntry.findMany.mockResolvedValue([]);
    const sneaky = { organizationId: 'org-other' };

    await run('getAlerts', sneaky);
    await run('getProformas', sneaky);
    await run('getCosts', sneaky);
    await run('getOutreach', sneaky);

    expect(p.alert.findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect(p.proforma.findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect(p.cost.findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect(p.outreachEntry.findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
  });
});

describe('the 50-row cap', () => {
  it('holds whatever limit the model asks for', async () => {
    p.task.findMany.mockResolvedValue([]);
    p.alert.findMany.mockResolvedValue([]);
    p.activity.findMany.mockResolvedValue([]);
    p.user.findMany.mockResolvedValue([]);

    await run('getTasks', { limit: 5000 });
    await run('getAlerts', { limit: 900 });
    await run('getHistory', { limit: 999 });

    expect(p.task.findMany.mock.calls[0][0].take).toBe(50);
    expect(p.alert.findMany.mock.calls[0][0].take).toBe(50);
    expect(p.activity.findMany.mock.calls[0][0].take).toBe(50);
  });

  it('cuts a long outreach list to 50', async () => {
    const leads = Array.from({ length: 120 }, (_, i) => ({
      id: `l${i}`,
      name: `Lead ${i}`,
      status: 'FOLLOW_UP',
      contactPersonName: null,
      vertical: 'Retail',
      source: 'Cold Outreach',
      remarks: null,
      nextActionDate: null,
      importedAt: new Date('2026-09-01'),
      owner: null,
    }));
    p.outreachEntry.findMany.mockResolvedValue(leads);
    p.activity.groupBy.mockResolvedValue([]);

    const out = await run('getOutreach', { limit: 500 });
    expect(out.matching).toBe(120);
    expect(out.leads).toHaveLength(50);
  });
});

describe('salaries', () => {
  it('are one summed line in the cost register, never a person or an amount', async () => {
    p.cost.findMany.mockResolvedValue([
      { category: 'Salaries', vendor: 'Janani', amount: 65000, incurredAt: new Date('2026-09-30'), type: 'COMPANY', confirmed: true, recurring: true, monthCard: null, project: null },
      { category: 'Salaries', vendor: 'Ravi', amount: 61000, incurredAt: new Date('2026-09-30'), type: 'COMPANY', confirmed: true, recurring: true, monthCard: null, project: null },
      { category: 'Software', vendor: 'Adobe', amount: 5200, incurredAt: new Date('2026-09-05'), type: 'COMPANY', confirmed: true, recurring: false, monthCard: null, project: null },
    ]);

    const out = await run('getCosts', { month: '2026-09' });
    const text = JSON.stringify(out);

    expect(out.costs.map((c: any) => c.what)).toEqual(['Software']);
    expect(out.byCategory).toContainEqual({ category: 'Salaries', amount: 126000, entries: 2 });
    expect(out.salaries).toEqual({ amount: 126000, entries: 2 });
    expect(text).not.toContain('Janani');
    expect(text).not.toContain('Ravi');
    expect(text).not.toContain('65000');
  });

  it('never come out of the history', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u-ravi', name: 'Ravi' }]);
    p.activity.findMany.mockResolvedValue([
      {
        id: 'a1',
        at: new Date('2026-09-20T10:00:00Z'),
        entityType: 'User',
        entityId: 'u-ravi',
        verb: 'user_access_updated',
        actor: { id: 'u-boss', name: 'Akmal' },
        payload: { name: 'Ravi', changed: { monthlyCost: { from: 55000, to: 61000 }, preset: { from: 'EMPLOYEE', to: 'HEAD' } } },
      },
    ]);

    const out = await run('getHistory', {});
    const text = JSON.stringify(out);

    expect(out.changes).toHaveLength(1);
    expect(text).not.toContain('61000');
    expect(text).not.toContain('61,000');
    expect(text).not.toContain('55,000');
  });
});

describe('links', () => {
  it('come with every row', async () => {
    p.company.findMany.mockResolvedValue([{ id: 'co-1', name: 'Acme', status: 'CLIENT', vertical: null, city: null, owner: null }]);
    p.task.findMany.mockResolvedValue([
      { id: 't1', title: 'Reel cut', status: 'TODO', priority: 'MEDIUM', dueDate: new Date('2026-09-01'), repeat: null, monthCard: null, project: null, retainerProject: null, assignees: [] },
    ]);
    p.invoice.findMany.mockResolvedValue([
      { id: 'i1', number: 'INV/1', amount: 1000, status: 'RAISED', dueAt: new Date('2026-09-01'), companyId: 'co-1', company: { name: 'Acme' } },
    ]);
    p.proforma.findMany.mockResolvedValue([
      { id: 'pf1', number: 'EL/PI/1', amount: 1000, total: 1180, status: 'UNPAID', raisedAt: new Date('2026-09-01'), validTill: new Date('2026-10-01'), sourceType: 'PROPOSAL', sourceId: 'pr1', invoiceId: null, companyId: 'co-1', company: { name: 'Acme' } },
    ]);
    p.monthCard.findMany.mockResolvedValue([]);
    p.project.findMany.mockResolvedValue([]);
    p.alert.findMany.mockResolvedValue([
      { rule: 'INVOICE_OVERDUE', severity: 'HIGH', message: 'INV/1 is overdue', entityType: 'Invoice', entityId: 'i1', raisedAt: new Date() },
      { rule: 'APPROVAL_ESCALATED', severity: 'HIGH', message: 'Waiting', entityType: 'Task', entityId: 't9', raisedAt: new Date() },
    ]);

    const clients = await run('searchClients');
    const tasks = await run('getTasks');
    const invoices = await run('getInvoices');
    const proformas = await run('getProformas');
    const alerts = await run('getAlerts');

    expect(clients[0].link).toBe('/companies/co-1');
    expect(tasks[0].link).toBe('/my-work?task=t1');
    expect(isLink(invoices[0].link) && isLink(invoices[0].clientLink)).toBe(true);
    expect(proformas[0].link).toBe('/companies/co-1?tab=MONEY');
    const alertLinks = alerts.byRule.flatMap((g: any) => g.alerts.map((a: any) => a.link));
    expect(alertLinks).toEqual(['/money', '/my-work?task=t9']);
  });
});

describe('what the existing lookups now get right', () => {
  it('never counts a cancelled invoice as overdue', async () => {
    p.invoice.findMany.mockResolvedValue([]);
    await run('getInvoices');
    expect(p.invoice.findMany.mock.calls[0][0].where.status).toEqual({ notIn: ['PAID', 'CANCELLED'] });
  });

  it("weighs a deal by its own override, as the Pipeline board does", async () => {
    p.proposal.findMany.mockResolvedValue([
      { kind: 'RETAINER', stage: 'PROPOSAL_SENT', probabilityOverride: 75, updatedAt: new Date(), companyId: 'co-1', company: { name: 'Acme' }, owner: null, versions: [{ value: 50000, scopeSummary: null }] },
    ]);
    const out = await run('getPipeline');
    expect(out[0].probability).toBe(75);
    expect(out[0].link).toBe('/companies/co-1?tab=PROPOSALS');
  });
});
