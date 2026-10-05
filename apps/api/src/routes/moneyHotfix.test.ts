import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { InvoiceStatus, RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

/**
 * Money Plan 1 — the hotfix (money audit, 2026-10-03).
 *
 *   1. GET /invoices/:id is money.status, and every figure in it — the
 *      proforma's, the month's and the project's too — is masked without
 *      money.figures.
 *   2. Nothing sets PAID but recording payments, nothing sets CANCELLED but
 *      the cancel route: the free status flip is gone.
 *   3. Payments: never on a cancelled invoice, never over the balance, in one
 *      transaction, in integer paise.
 *   4. A proforma's proposal is the caller's organisation's, and a WON deal
 *      stays WON.
 *   5. allocations/bulk: the organisation's work only, a Head's own people
 *      only, never a closed month.
 *   6. A paid invoice is locked — an admin may change it, with a reason that
 *      is kept.
 *   7. A client with billing history is never permanently deleted.
 */

type Who = { id: string; preset: RolePreset; permissions: string[] };
const EMPLOYEE: Who = { id: 'usr-emp', preset: RolePreset.EMPLOYEE, permissions: ['work.own'] };
const HEAD: Who = { id: 'usr-head', preset: RolePreset.HEAD, permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'] };
const ACCOUNTS: Who = { id: 'usr-acc', preset: RolePreset.ACCOUNTS, permissions: ['work.own', 'company.read', 'money.status', 'money.figures', 'cost.enter'] };
const ADMIN: Who = { id: 'usr-admin', preset: RolePreset.MANAGEMENT, permissions: ['money.status', 'money.figures', 'setup.admin'] };
const PEOPLE = [EMPLOYEE, HEAD, ACCOUNTS, ADMIN];

const as = (who: Who) => ({
  Authorization: `Bearer ${signJwt({ userId: who.id, organizationId: 'org-1', email: `${who.id}@x`, preset: who.preset, permissions: who.permissions } as never)}`,
});

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const who = PEOPLE.find((p) => p.id === where.id);
    return who ? { ...who, organizationId: 'org-1', name: who.id, email: `${who.id}@x`, active: true } : null;
  });
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
});

// ── 1. GET /invoices/:id ─────────────────────────────────────────────────────

describe('1. GET /invoices/:id — gated, and every figure masked', () => {
  const invoice = {
    id: 'inv-1',
    organizationId: 'org-1',
    number: 'INV/26-27/0200',
    status: InvoiceStatus.RAISED,
    amount: 118000,
    gstAmount: 18000,
    subtotal: null,
    cgstAmount: null,
    sgstAmount: null,
    igstAmount: null,
    roundOff: null,
    total: null,
    amountInWords: null,
    payments: [{ id: 'pay-1', amount: 18000, gstAmount: null, receivedAt: new Date('2026-10-02'), mode: 'NEFT' }],
    lineItems: [],
    company: { id: 'co-1', name: 'Brigade' },
    project: { id: 'pr-1', name: 'Launch film', quotedValue: 250000, estimatedCost: 90000 },
    proforma: { id: 'pf-1', number: 'EL/PI/26-27/014', amount: 100000, subtotal: 100000, cgstAmount: 9000, sgstAmount: 9000, igstAmount: 0, roundOff: 0, total: 118000, amountInWords: 'One lakh eighteen thousand' },
    monthCard: { id: 'mc-1', month: '2026-09', revenue: 100000 },
  };
  beforeEach(() => (prisma.invoice.findFirst as any).mockResolvedValue(invoice));

  it('an EMPLOYEE is refused', async () => {
    expect((await request(app).get('/api/invoices/inv-1').set(as(EMPLOYEE))).status).toBe(403);
  });

  it('money.status without money.figures: the status, and no figure anywhere — nested ones included', async () => {
    const res = await request(app).get('/api/invoices/inv-1').set(as(HEAD));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.status).toBe('RAISED');
    expect([d.amount, d.gstAmount, d.totalPaid, d.balanceDue, d.payments[0].amount]).toEqual([null, null, null, null, null]);
    expect([d.proforma.amount, d.proforma.subtotal, d.proforma.total, d.proforma.cgstAmount, d.proforma.amountInWords]).toEqual([null, null, null, null, null]);
    expect(d.proforma.number).toBe('EL/PI/26-27/014');
    expect(d.monthCard.revenue).toBeNull();
    expect([d.project.quotedValue, d.project.estimatedCost]).toEqual([null, null]);
    expect(JSON.stringify(d)).not.toMatch(/118000|100000|250000|90000/);
  });

  it('Accounts sees everything', async () => {
    const d = (await request(app).get('/api/invoices/inv-1').set(as(ACCOUNTS))).body.data;
    expect(d).toMatchObject({ amount: 118000, totalPaid: 18000, balanceDue: 100000 });
    expect(Number(d.proforma.total)).toBe(118000);
    expect(Number(d.monthCard.revenue)).toBe(100000);
    expect(Number(d.project.quotedValue)).toBe(250000);
  });

  it('another organisation’s id is not found', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(null);
    expect((await request(app).get('/api/invoices/other').set(as(ACCOUNTS))).status).toBe(404);
    expect((prisma.invoice.findFirst as any).mock.calls[0][0].where).toEqual({ id: 'other', organizationId: 'org-1' });
  });
});

// ── 2. The free status flip ──────────────────────────────────────────────────

describe('2. no free status flip', () => {
  it('PATCH /invoices/:id/status is gone — PAID and CANCELLED cannot be typed', async () => {
    for (const status of ['PAID', 'CANCELLED']) {
      const res = await request(app).patch('/api/invoices/inv-1/status').set(as(ADMIN)).send({ status });
      expect(res.status).toBe(404);
    }
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
});

// ── 3. Payments ──────────────────────────────────────────────────────────────

describe('3. payments', () => {
  /** One invoice; payments written in a test are seen by every later read. */
  let paid: { amount: number; receivedAt: Date }[];
  let status: InvoiceStatus;
  const amount = { value: 118000 };
  beforeEach(() => {
    paid = [];
    status = InvoiceStatus.RAISED;
    amount.value = 118000;
    (prisma.invoice.findFirst as any).mockImplementation(async () => ({ id: 'inv-1', number: 'INV/1', status, company: { name: 'Brigade' } }));
    (prisma.invoice.findUnique as any).mockImplementation(async () => ({
      id: 'inv-1',
      amount: amount.value,
      status,
      milestoneId: null,
      proformaId: null,
      payments: [...paid],
      company: { name: 'Brigade' },
    }));
    (prisma.payment.create as any).mockImplementation(async ({ data }: any) => {
      paid.push({ amount: data.amount, receivedAt: data.receivedAt });
      return { id: `pay-${paid.length}`, ...data };
    });
    (prisma.invoice.update as any).mockImplementation(async ({ data }: any) => {
      if (data.status) status = data.status;
      return { id: 'inv-1' };
    });
  });
  const pay = (amt: number) =>
    request(app).post('/api/invoices/inv-1/payments').set(as(ACCOUNTS)).send({ amount: amt, mode: 'NEFT', receivedAt: '2026-10-03' });

  it('refused on a cancelled invoice', async () => {
    status = InvoiceStatus.CANCELLED;
    const res = await pay(1000);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This invoice is cancelled.');
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('₹1 more than the balance is refused, with the balance shown', async () => {
    paid.push({ amount: 59000, receivedAt: new Date('2026-10-01') });
    const res = await pay(59001);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("That's more than the ₹59,000 still owed.");
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('two payments that together settle it mark it PAID exactly once, under a lock', async () => {
    const first = await pay(59000);
    const second = await pay(59000);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect([first.body.isFullySettled, second.body.isFullySettled]).toEqual([false, true]);
    const toPaid = (prisma.invoice.update as any).mock.calls.filter((c: any[]) => c[0].data.status === InvoiceStatus.PAID);
    expect(toPaid).toHaveLength(1);
    const verbs = (prisma.activity.create as any).mock.calls.map((c: any[]) => c[0].data.verb);
    expect(verbs).toEqual(['payment_received', 'fully_paid']);
    // The row is locked inside each transaction, so the second waits for the first.
    expect((prisma.$queryRaw as any).mock.calls.length).toBe(2);
  });

  it('settles in whole paise: ten payments of ₹0.10 pay a ₹1 invoice', async () => {
    amount.value = 1;
    for (let i = 0; i < 9; i++) paid.push({ amount: 0.1, receivedAt: new Date('2026-10-01') });
    // As floats, 0.1 × 10 is 0.9999999999999999 — short of 1, so never Paid.
    const res = await pay(0.1);
    expect(res.status).toBe(201);
    expect(res.body.isFullySettled).toBe(true);
  });
});

// ── 4. issueProforma ─────────────────────────────────────────────────────────

describe('4. a proforma raised from a proposal', () => {
  const ORG = {
    id: 'org-1',
    name: 'EyeLevel Growth Studio',
    legalName: 'EyeLevel Growth Studio LLP',
    address: 'No. 12, KK Nagar',
    state: 'Tamil Nadu',
    gstNumber: '33AABCE1234F1Z5',
    gstStateCode: '33',
    pan: 'AABCE1234F',
    contactEmail: null,
    declarationText: null,
    defaultPaymentTerms: 'Immediate',
    defaultProformaValidityDays: 30,
    bankAccountHolderName: null,
    bankName: null,
    bankBranch: null,
    bankAccountNumber: null,
    bankIfscCode: null,
    proformaPrefix: 'EL/PI',
    financialYearStart: 4,
  };
  beforeEach(() => {
    (prisma.organization.findUnique as any).mockResolvedValue(ORG);
    (prisma.company.findFirst as any).mockResolvedValue({ id: 'co-1', billingAddress: null, gstin: null, stateName: 'Tamil Nadu', stateCode: '33' });
    (prisma.proforma.findMany as any).mockResolvedValue([]);
    (prisma.proforma.create as any).mockImplementation(async ({ data }: any) => ({ id: 'pf-new', ...data }));
  });
  const raise = () =>
    request(app)
      .post('/api/proformas')
      .set(as(ACCOUNTS))
      .send({ companyId: 'co-1', sourceType: 'PROPOSAL', sourceId: 'prop-1', billingName: 'Brigade Pvt Ltd', amount: 50000 });

  it("another organisation's proposal is not found, and nothing is written", async () => {
    (prisma.proposal.findFirst as any).mockResolvedValue(null);
    const res = await raise();
    expect(res.status).toBe(404);
    expect((prisma.proposal.findFirst as any).mock.calls[0][0].where).toEqual({ id: 'prop-1', organizationId: 'org-1' });
    expect(prisma.proforma.create).not.toHaveBeenCalled();
    expect(prisma.proposal.updateMany).not.toHaveBeenCalled();
  });

  it('a WON proposal stays WON', async () => {
    (prisma.proposal.findFirst as any).mockResolvedValue({ id: 'prop-1', stage: 'WON' });
    const res = await raise();
    expect(res.status).toBe(201);
    expect(prisma.proposal.updateMany).not.toHaveBeenCalled();
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it('a proposal still being worked moves to Proforma issued — in this organisation only', async () => {
    (prisma.proposal.findFirst as any).mockResolvedValue({ id: 'prop-1', stage: 'IN_NEGOTIATION' });
    await raise();
    expect(prisma.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'prop-1', organizationId: 'org-1', stage: { not: 'WON' } },
      data: { stage: 'PROFORMA_ISSUED' },
    });
  });
});

// ── 5. allocations/bulk ──────────────────────────────────────────────────────

describe('5. POST /allocations/bulk', () => {
  beforeEach(() => {
    (prisma.user.findFirst as any).mockResolvedValue({ id: 'usr-designer', organizationId: 'org-1' });
    (prisma.monthCard.count as any).mockImplementation(async ({ where }: any) => where.id.in.length);
    (prisma.project.count as any).mockImplementation(async ({ where }: any) => where.id.in.length);
    (prisma.peopleAllocation.findMany as any).mockResolvedValue([]);
    (prisma.monthCard.findMany as any).mockResolvedValue([]);
  });
  const save = (who: Who, allocations: unknown[], userId = 'usr-designer') =>
    request(app).post('/api/allocations/bulk').set(as(who)).send({ userId, month: '2026-08', allocations });

  it("a Head can't change the split of another department's people", async () => {
    (prisma.department.findMany as any).mockResolvedValue([{ id: 'dep-video', name: 'Video' }]);
    (prisma.user.findMany as any).mockResolvedValue([{ id: 'usr-editor', departmentId: 'dep-video' }]);
    const res = await save(HEAD, [{ workType: 'PROJECT', workId: 'proj-1', percent: 100 }]);
    expect(res.status).toBe(403);
    expect(prisma.peopleAllocation.deleteMany).not.toHaveBeenCalled();
  });

  it("…and can change their own people's", async () => {
    (prisma.department.findMany as any).mockResolvedValue([{ id: 'dep-video', name: 'Video' }]);
    (prisma.user.findMany as any).mockResolvedValue([{ id: 'usr-designer', departmentId: 'dep-video' }]);
    expect((await save(HEAD, [{ workType: 'PROJECT', workId: 'proj-1', percent: 100 }])).status).toBe(201);
  });

  it("work from outside the organisation is refused", async () => {
    (prisma.project.count as any).mockResolvedValue(0);
    const res = await save(ACCOUNTS, [{ workType: 'PROJECT', workId: 'other-org-proj', percent: 100 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not one of yours/);
  });

  it('a closed month refuses changes, with the costs message', async () => {
    (prisma.peopleAllocation.findMany as any).mockResolvedValue([
      { id: 'a1', workType: 'MONTH_CARD', workId: 'mc-aug', monthCardId: 'mc-aug', percent: 60, proposedPercent: 60 },
    ]);
    (prisma.monthCard.findMany as any).mockResolvedValue([{ id: 'mc-aug' }]);
    (prisma.monthCard.findUnique as any).mockResolvedValue({ status: 'CLOSED', month: '2026-08' });
    const res = await save(ACCOUNTS, [{ workType: 'MONTH_CARD', workId: 'mc-aug', monthCardId: 'mc-aug', percent: 40 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^August 2026 is closed\. Changing these allocations would change a month whose profit has already been reported/);
    expect(prisma.peopleAllocation.deleteMany).not.toHaveBeenCalled();
  });

  it("a closed month's rows that come back unchanged are left exactly as they are", async () => {
    (prisma.peopleAllocation.findMany as any).mockResolvedValue([
      { id: 'a1', workType: 'MONTH_CARD', workId: 'mc-aug', monthCardId: 'mc-aug', percent: 60, proposedPercent: 60 },
    ]);
    (prisma.monthCard.findMany as any).mockResolvedValue([{ id: 'mc-aug' }]);
    const res = await save(ACCOUNTS, [
      { workType: 'MONTH_CARD', workId: 'mc-aug', monthCardId: 'mc-aug', percent: 60 },
      { workType: 'PROJECT', workId: 'proj-1', projectId: 'proj-1', percent: 40 },
    ]);
    expect(res.status).toBe(201);
    expect(prisma.peopleAllocation.deleteMany).toHaveBeenCalledWith({ where: { userId: 'usr-designer', month: '2026-08', id: { notIn: ['a1'] } } });
    expect((prisma.peopleAllocation.create as any).mock.calls.map((c: any[]) => c[0].data.workId)).toEqual(['proj-1']);
  });
});

// ── 6. Paid invoices are locked ──────────────────────────────────────────────

describe('6. a paid invoice is locked', () => {
  const PAID = {
    id: 'inv-1',
    organizationId: 'org-1',
    number: 'INV/26-27/0200',
    amount: 118000,
    gstAmount: 18000,
    subtotal: null,
    status: InvoiceStatus.PAID,
    raisedAt: new Date('2026-09-01'),
    dueAt: new Date('2026-09-16'),
    paidAt: new Date('2026-09-10'),
    milestoneId: null,
    proformaId: null,
    payments: [{ amount: 118000, receivedAt: new Date('2026-09-10') }],
    company: { name: 'Brigade', billingAddress: null, gstin: null, stateName: 'Tamil Nadu', stateCode: '33' },
  };
  beforeEach(() => {
    (prisma.invoice.findFirst as any).mockResolvedValue(PAID);
    (prisma.invoice.findUnique as any).mockResolvedValue({ ...PAID, number: 'INV/26-27/0201' });
  });
  const edit = (who: Who, body: Record<string, unknown>) => request(app).patch('/api/invoices/inv-1').set(as(who)).send(body);

  it('refused for Accounts', async () => {
    const res = await edit(ACCOUNTS, { number: 'INV/26-27/0201' });
    expect(res.status).toBe(403);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('refused for an admin who gives no reason', async () => {
    const res = await edit(ADMIN, { number: 'INV/26-27/0201' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Say why/);
  });

  it('an admin with a reason may — and the reason is written to Activity', async () => {
    const res = await edit(ADMIN, { number: 'INV/26-27/0201', dueAt: '2026-09-20', reason: 'Tally number typed wrong' });
    expect(res.status).toBe(200);
    const logged = (prisma.activity.create as any).mock.calls[0][0].data;
    expect(logged.verb).toBe('invoice_edited');
    expect(logged.payload).toMatchObject({ wasPaid: true, reason: 'Tally number typed wrong' });
    expect(logged.payload.changed.number).toEqual({ from: 'INV/26-27/0200', to: 'INV/26-27/0201' });
  });

  it("the document of a paid invoice is locked too", async () => {
    const res = await request(app)
      .put('/api/invoices/inv-1/document')
      .set(as(ACCOUNTS))
      .send({ billingName: 'Brigade Pvt Ltd', lineItems: [{ particulars: 'Retainer', units: 1, unitCost: 100000 }] });
    expect(res.status).toBe(403);
    expect(prisma.documentLineItem.deleteMany).not.toHaveBeenCalled();
  });
});

// ── 7. Never hard-delete money ───────────────────────────────────────────────

describe('7. permanently deleting a client with billing history', () => {
  beforeEach(() => {
    (prisma.company.findFirst as any).mockResolvedValue({ id: 'co-1', name: 'Brigade', status: 'PROSPECT' });
  });
  const remove = () =>
    request(app).post('/api/companies/co-1/delete-permanently').set(as(ADMIN)).send({ confirmName: 'Brigade' });

  it('refused with an unpaid invoice', async () => {
    (prisma.invoice.count as any).mockResolvedValue(1);
    (prisma.proforma.count as any).mockResolvedValue(0);
    const res = await remove();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This client has billing history. Archive it instead.');
    expect(prisma.company.delete).not.toHaveBeenCalled();
  });

  it('refused with only a cancelled proforma', async () => {
    (prisma.invoice.count as any).mockResolvedValue(0);
    (prisma.proforma.count as any).mockImplementation(async ({ where }: any) => {
      // Counted whatever its status: nothing filters cancelled ones out.
      expect(where).toEqual({ companyId: 'co-1' });
      return 1;
    });
    const res = await remove();
    expect(res.status).toBe(400);
    expect(prisma.company.delete).not.toHaveBeenCalled();
  });
});

vi.mock('../utils/mailer.js', () => ({ sendMail: vi.fn() }));
