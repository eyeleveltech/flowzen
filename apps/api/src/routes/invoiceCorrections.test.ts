import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { InvoiceStatus, MilestoneStatus, RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

/**
 * Correcting an invoice, its payments, and going back a stage.
 *
 * Every step forward could be taken and none taken back. Now: an invoice's
 * details can be corrected (never below what was received), a payment can be
 * corrected or removed (the invoice, milestone and proforma follow the money
 * both ways), and an invoice can be cancelled, which frees the month, the
 * proforma and the milestone it was entered against — but not while money is
 * recorded against it.
 */

const ADMIN = {
  id: 'usr-admin-1',
  organizationId: 'org-1',
  name: 'Admin',
  email: 'admin@x',
  preset: RolePreset.MANAGEMENT,
  permissions: ['money.figures', 'setup.admin'],
  active: true,
};
const HEAD = { ...ADMIN, id: 'usr-head-1', preset: RolePreset.HEAD, permissions: ['work.own', 'money.status'] } as unknown as typeof ADMIN;
const token = (u: typeof ADMIN) =>
  signJwt({ userId: u.id, organizationId: u.organizationId, email: u.email, preset: u.preset, permissions: u.permissions } as never);
const as = (u: typeof ADMIN) => ({ Authorization: `Bearer ${token(u)}` });

const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  organizationId: 'org-1',
  number: 'INV/26-27/0200',
  amount: 118000,
  gstAmount: 18000,
  subtotal: null,
  status: InvoiceStatus.RAISED,
  raisedAt: new Date('2026-10-01'),
  dueAt: new Date('2026-10-16'),
  paidAt: null,
  milestoneId: 'ms-1',
  proformaId: 'pf-1',
  payments: [],
  company: { name: 'Brigade' },
  ...over,
});

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) =>
    where.id === ADMIN.id ? ADMIN : where.id === HEAD.id ? HEAD : null,
  );
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
});

describe('PATCH /api/invoices/:id — correct an invoice', () => {
  it('corrects the number, the amount and its GST, and the dates', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow());
    (prisma.invoice.findUnique as any).mockResolvedValue(invoiceRow({ number: 'INV/26-27/0201', payments: [] }));
    const res = await request(app)
      .patch('/api/invoices/inv-1')
      .set(as(ADMIN))
      .send({ number: 'INV/26-27/0201', amount: 59000, gstAmount: 9000, dueAt: '2026-10-20' });
    expect(res.status).toBe(200);
    expect((prisma.invoice.update as any).mock.calls[0][0].data).toMatchObject({
      number: 'INV/26-27/0201',
      amount: 59000,
      gstAmount: 9000,
      gstApplicable: true,
    });
    expect((prisma.activity.create as any).mock.calls[0][0].data.verb).toBe('invoice_edited');
  });

  it('refuses a total below what has been received', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow({ payments: [{ amount: 60000 }] }));
    const res = await request(app).patch('/api/invoices/inv-1').set(as(ADMIN)).send({ amount: 50000, gstAmount: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been received/);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('leaves the amount of an invoice with a printed document to Edit document', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow({ subtotal: 100000 }));
    const res = await request(app).patch('/api/invoices/inv-1').set(as(ADMIN)).send({ amount: 50000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Edit document/);
  });

  it('a number already in use is a clear conflict', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow());
    (prisma.invoice.update as any).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const res = await request(app).patch('/api/invoices/inv-1').set(as(ADMIN)).send({ number: 'INV/26-27/0001' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already used/);
  });

  it('a cancelled invoice is not changed; and it needs money.figures', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow({ status: InvoiceStatus.CANCELLED }));
    expect((await request(app).patch('/api/invoices/inv-1').set(as(ADMIN)).send({ number: 'X' })).status).toBe(400);
    expect((await request(app).patch('/api/invoices/inv-1').set(as(HEAD)).send({ number: 'X' })).status).toBe(403);
  });
});

describe('payments — correct or remove, and the invoice follows', () => {
  const payment = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    invoiceId: 'inv-1',
    amount: 118000,
    gstAmount: 18000,
    receivedAt: new Date('2026-10-05'),
    mode: 'NEFT',
    reference: null,
    invoice: { id: 'inv-1', number: 'INV/26-27/0200', status: InvoiceStatus.PAID, company: { name: 'Brigade' } },
    ...over,
  });

  it('removing the payment that settled it: owed again, milestone back to Invoiced, proforma back to Unpaid', async () => {
    (prisma.payment.findFirst as any).mockResolvedValue(payment());
    // After the delete, what resettle reads: paid status, no money.
    (prisma.invoice.findUnique as any).mockResolvedValue(invoiceRow({ status: InvoiceStatus.PAID, payments: [] }));
    const res = await request(app).delete('/api/invoices/inv-1/payments/pay-1').set(as(ADMIN));
    expect(res.status).toBe(200);
    expect(prisma.payment.delete).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: InvoiceStatus.RAISED, paidAt: null } });
    expect(prisma.milestone.updateMany).toHaveBeenCalledWith({
      where: { id: 'ms-1', status: MilestoneStatus.PAID },
      data: { status: MilestoneStatus.INVOICED },
    });
    expect(prisma.proforma.updateMany).toHaveBeenCalledWith({ where: { id: 'pf-1', status: 'PAID' }, data: { status: 'UNPAID' } });
    expect((prisma.activity.create as any).mock.calls[0][0].data.verb).toBe('payment_removed');
  });

  it('correcting a part payment up to the full amount settles it', async () => {
    (prisma.payment.findFirst as any).mockResolvedValue(payment({ amount: 50000, gstAmount: null, invoice: { id: 'inv-1', number: 'X', status: InvoiceStatus.RAISED, company: { name: 'B' } } }));
    (prisma.payment.update as any).mockResolvedValue({ id: 'pay-1' });
    (prisma.invoice.findUnique as any).mockResolvedValue(
      invoiceRow({ payments: [{ id: 'pay-1', amount: 118000, receivedAt: new Date('2026-10-07') }] }),
    );
    const res = await request(app)
      .patch('/api/invoices/inv-1/payments/pay-1')
      .set(as(ADMIN))
      .send({ amount: 118000, gstAmount: 18000, receivedAt: '2026-10-07' });
    expect(res.status).toBe(200);
    expect((prisma.payment.update as any).mock.calls[0][0].data).toMatchObject({ amount: 118000, gstAmount: 18000 });
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: InvoiceStatus.PAID, paidAt: new Date('2026-10-07') },
    });
    expect(prisma.milestone.update).toHaveBeenCalledWith({ where: { id: 'ms-1' }, data: { status: MilestoneStatus.PAID } });
  });

  it('refuses a payment GST that is not less than the amount, and a payment on another invoice', async () => {
    (prisma.payment.findFirst as any).mockResolvedValue(payment());
    expect((await request(app).patch('/api/invoices/inv-1/payments/pay-1').set(as(ADMIN)).send({ amount: 100, gstAmount: 100 })).status).toBe(400);
    (prisma.payment.findFirst as any).mockResolvedValue(null);
    expect((await request(app).delete('/api/invoices/inv-1/payments/pay-9').set(as(ADMIN))).status).toBe(404);
    expect((prisma.payment.findFirst as any).mock.calls[0][0].where).toMatchObject({ invoice: { organizationId: 'org-1' } });
  });
});

describe('POST /api/invoices/:id/cancel — back a stage', () => {
  it('refused while money is recorded against it', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow({ payments: [{ id: 'pay-1' }] }));
    const res = await request(app).post('/api/invoices/inv-1/cancel').set(as(ADMIN));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Remove its payment first/);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('frees the month and the proforma, and the milestone goes back to Proforma raised', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow());
    (prisma.proforma.count as any).mockResolvedValue(1);
    const res = await request(app).post('/api/invoices/inv-1/cancel').set(as(ADMIN));
    expect(res.status).toBe(200);
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: InvoiceStatus.CANCELLED, paidAt: null, proformaId: null },
    });
    expect(prisma.monthCard.updateMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1' }, data: { invoiceId: null } });
    expect(prisma.proforma.updateMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1' }, data: { invoiceId: null } });
    expect(prisma.milestone.update).toHaveBeenCalledWith({ where: { id: 'ms-1' }, data: { status: MilestoneStatus.PROFORMA_RAISED } });
  });

  it('a milestone with no proforma goes back to Pending', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow({ proformaId: null }));
    (prisma.proforma.count as any).mockResolvedValue(0);
    await request(app).post('/api/invoices/inv-1/cancel').set(as(ADMIN));
    expect(prisma.milestone.update).toHaveBeenCalledWith({ where: { id: 'ms-1' }, data: { status: MilestoneStatus.PENDING } });
  });

  it('already cancelled is said so', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue(invoiceRow({ status: InvoiceStatus.CANCELLED }));
    expect((await request(app).post('/api/invoices/inv-1/cancel').set(as(ADMIN))).status).toBe(400);
  });
});
