import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { InvoiceStatus, RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { INVOICE_MONEY_FIELDS, maskInvoiceFigures, maskPaymentFigures } from '../utils/invoiceFigures.js';

/**
 * GST on an invoice entered from Tally.
 *
 * The form sends the payable total as `amount` and the GST inside it as
 * `gstAmount`. Stored as given; refused when the GST is not less than the
 * total; shown only to people who may see figures — in the list, the CSV, and
 * every route that hands back whole invoice rows.
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
const HEAD = {
  id: 'usr-head-1',
  organizationId: 'org-1',
  name: 'Head',
  email: 'head@x',
  preset: RolePreset.HEAD,
  permissions: ['work.own', 'work.team', 'work.all', 'money.status'],
  active: true,
};
const token = (u: typeof ADMIN) =>
  signJwt({ userId: u.id, organizationId: u.organizationId, email: u.email, preset: u.preset, permissions: u.permissions } as never);

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) =>
    where.id === ADMIN.id ? ADMIN : where.id === HEAD.id ? HEAD : null,
  );
  (prisma.company.findFirst as any).mockResolvedValue({ id: 'comp-1', name: 'Brigade', organizationId: 'org-1' });
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
  (prisma.invoice.create as any).mockImplementation(async ({ data }: any) => ({ id: 'inv-1', ...data, company: { name: 'Brigade' } }));
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
});

const post = (body: Record<string, unknown>) =>
  request(app).post('/api/invoices').set('Authorization', `Bearer ${token(ADMIN)}`).send({ companyId: 'comp-1', customNumber: 'INV/26-27/0200', ...body });

describe('POST /api/invoices — GST', () => {
  it('stores the total as the amount and the GST inside it', async () => {
    const res = await post({ amount: 118000, gstAmount: 18000 });
    expect(res.status).toBe(201);
    const data = (prisma.invoice.create as any).mock.calls[0][0].data;
    expect(data).toMatchObject({ amount: 118000, gstAmount: 18000, gstApplicable: true });
  });

  it('a GST of zero records "no GST charged"', async () => {
    await post({ amount: 50000, gstAmount: 0 });
    expect((prisma.invoice.create as any).mock.calls[0][0].data).toMatchObject({ gstAmount: 0, gstApplicable: false });
  });

  it('without GST, nothing about it is written — as before', async () => {
    await post({ amount: 50000 });
    const data = (prisma.invoice.create as any).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('gstAmount');
    expect(data).not.toHaveProperty('gstApplicable');
  });

  it('refuses a GST that is not less than the total', async () => {
    const res = await post({ amount: 18000, gstAmount: 18000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GST has to be less than/);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect((await post({ amount: 1000, gstAmount: -5 })).status).toBe(400);
  });
});

describe('GET /api/invoices — who sees the GST', () => {
  beforeEach(() => {
    (prisma.invoice.findMany as any).mockResolvedValue([
      {
        id: 'inv-1',
        number: 'INV/26-27/0200',
        companyId: 'comp-1',
        workType: 'MONTH_CARD',
        workId: null,
        amount: 118000,
        gstAmount: 18000,
        subtotal: null,
        raisedAt: new Date('2026-10-01'),
        dueAt: new Date('2026-10-16'),
        status: InvoiceStatus.RAISED,
        paidAt: null,
        proformaId: null,
        company: { id: 'comp-1', name: 'Brigade', website: null },
        payments: [],
        project: null,
      },
    ]);
    (prisma.invoice.count as any).mockResolvedValue(1);
  });

  it('figures: the GST comes back, and the CSV has a GST column', async () => {
    const res = await request(app).get('/api/invoices').set('Authorization', `Bearer ${token(ADMIN)}`);
    expect(res.body.data[0]).toMatchObject({ amount: 118000, gstAmount: 18000 });
    const csv = await request(app).get('/api/invoices?format=csv').set('Authorization', `Bearer ${token(ADMIN)}`);
    const [header, row] = csv.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(header).toContain('GST');
    expect(row).toContain('18000');
  });

  it('status only (a Head): no amount, no GST', async () => {
    const res = await request(app).get('/api/invoices').set('Authorization', `Bearer ${token(HEAD as never)}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].amount).toBeNull();
    expect(res.body.data[0].gstAmount).toBeNull();
  });
});

describe('maskInvoiceFigures', () => {
  const row = {
    id: 'inv-1',
    number: 'INV/1',
    status: 'RAISED',
    amount: 118000,
    gstAmount: 18000,
    subtotal: 100000,
    cgstAmount: 9000,
    sgstAmount: 9000,
    igstAmount: 0,
    roundOff: 0,
    total: 118000,
    amountInWords: 'One lakh eighteen thousand rupees only',
  };

  it('nulls every figure for somebody without money.figures, and keeps the rest', () => {
    const masked = maskInvoiceFigures(row, false) as Record<string, unknown>;
    for (const f of INVOICE_MONEY_FIELDS) expect(masked[f]).toBeNull();
    expect(masked).toMatchObject({ id: 'inv-1', number: 'INV/1', status: 'RAISED' });
  });

  it('leaves the row alone for somebody with it', () => {
    expect(maskInvoiceFigures(row, true)).toBe(row);
  });
});

describe('POST /api/invoices/:id/payments — GST', () => {
  beforeEach(() => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      id: 'inv-1',
      organizationId: 'org-1',
      number: 'INV/26-27/0200',
      amount: 118000,
      gstAmount: 18000,
      status: InvoiceStatus.RAISED,
      milestoneId: null,
      proformaId: null,
      payments: [],
      company: { id: 'comp-1', name: 'Brigade' },
    });
    (prisma.payment.create as any).mockImplementation(async ({ data }: any) => ({ id: 'pay-1', ...data }));
    (prisma.invoice.update as any).mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.PAID, payments: [], company: { name: 'Brigade' } });
  });
  const pay = (body: Record<string, unknown>) =>
    request(app).post('/api/invoices/inv-1/payments').set('Authorization', `Bearer ${token(ADMIN)}`).send({ mode: 'NEFT', ...body });

  it('stores what was received and the GST inside it; the total still settles the invoice', async () => {
    const res = await pay({ amount: 118000, gstAmount: 18000 });
    expect(res.status).toBe(201);
    expect((prisma.payment.create as any).mock.calls[0][0].data).toMatchObject({ amount: 118000, gstAmount: 18000 });
    expect(res.body.isFullySettled).toBe(true);
  });

  it('without GST, the payment is as before', async () => {
    await pay({ amount: 50000 });
    expect((prisma.payment.create as any).mock.calls[0][0].data).not.toHaveProperty('gstAmount');
  });

  it('refuses a GST that is not less than the amount received', async () => {
    const res = await pay({ amount: 18000, gstAmount: 18000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/less than the amount received/);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('a payment’s figures are hidden together', () => {
    const p = { id: 'pay-1', mode: 'NEFT', amount: 118000, gstAmount: 18000 };
    expect(maskPaymentFigures(p, false)).toEqual({ id: 'pay-1', mode: 'NEFT', amount: null, gstAmount: null });
    expect(maskPaymentFigures(p, true)).toBe(p);
  });
});
