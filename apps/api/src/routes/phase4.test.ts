import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { calculateGst } from '../utils/tax.js';
import { generateNextInvoiceNumber } from '../utils/documentNumber.js';
import { InvoiceStatus, RolePreset } from '@prisma/client';

describe('Phase 4: Financials & Intelligence Engine', () => {
  const adminToken = signJwt({
    userId: 'usr-admin-1',
    organizationId: 'org-1',
    email: 'admin@eyelevel.local',
    preset: 'MANAGEMENT',
    permissions: [
      'work.own', 'work.team', 'work.all',
      'pipeline.read', 'pipeline.write',
      'company.read', 'company.write',
      'money.figures', 'cost.enter', 'setup.admin',
      'reports.read',
    ],
  });

  const employeeToken = signJwt({
    userId: 'usr-emp-1',
    organizationId: 'org-1',
    email: 'designer@eyelevel.local',
    preset: 'EMPLOYEE',
    permissions: ['work.own'],
  });

  const headToken = signJwt({
    userId: 'usr-head-1',
    organizationId: 'org-1',
    email: 'sneha@eyelevel.local',
    preset: 'HEAD',
    permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'],
  });

  beforeEach(() => {
    (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
      if (where.id === 'usr-admin-1') {
        return {
          id: 'usr-admin-1',
          organizationId: 'org-1',
          name: 'Admin Boss',
          email: 'admin@eyelevel.local',
          preset: RolePreset.MANAGEMENT,
          permissions: [
            'work.own', 'work.team', 'work.all',
            'pipeline.read', 'pipeline.write',
            'company.read', 'company.write',
            'money.figures', 'cost.enter', 'cost.approve',
            'forecast.view', 'setup.admin',
          ],
          active: true,
        };
      }
      if (where.id === 'usr-emp-1') {
        return {
          id: 'usr-emp-1',
          organizationId: 'org-1',
          name: 'Designer Dave',
          email: 'designer@eyelevel.local',
          preset: RolePreset.EMPLOYEE,
          permissions: ['work.own'],
          active: true,
        };
      }
      if (where.id === 'usr-head-1') {
        return {
          id: 'usr-head-1',
          organizationId: 'org-1',
          name: 'Sneha (Head of Marketing)',
          email: 'sneha@eyelevel.local',
          preset: RolePreset.HEAD,
          permissions: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'],
          active: true,
        };
      }
      return null;
    });
  });

  it('1. Verifies GST 18% calculation with CGST/SGST intra-state and IGST inter-state', () => {
    // Intra-state ₹100,000 at 18% => CGST ₹9,000 + SGST ₹9,000 = Total ₹118,000
    const intra = calculateGst(100000, false, 18);
    expect(intra.baseAmount).toBe(100000);
    expect(intra.cgstAmount).toBe(9000);
    expect(intra.sgstAmount).toBe(9000);
    expect(intra.igstAmount).toBe(0);
    expect(intra.totalTaxAmount).toBe(18000);
    expect(intra.totalAmountWithTax).toBe(118000);

    // Inter-state ₹100,000 at 18% => IGST ₹18,000 = Total ₹118,000
    const inter = calculateGst(100000, true, 18);
    expect(inter.isInterState).toBe(true);
    expect(inter.igstAmount).toBe(18000);
    expect(inter.cgstAmount).toBe(0);
    expect(inter.sgstAmount).toBe(0);
  });

  it('2. Verifies sequential Indian FY invoice number generator formatting', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue({
      proformaPrefix: 'EL/PI',
      financialYearStart: 4,
    });
    (prisma.invoice.findMany as any).mockResolvedValue([]);

    const invoiceNum = await generateNextInvoiceNumber('org-1');
    expect(invoiceNum).toMatch(/^EL\/INV\/\d{2}-\d{2}\/001$/);
  });

  it('3. Verifies invoice creation, access gating, and financial figure masking', async () => {
    // Deny creation for employee
    const denied = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        companyId: 'comp-1',
        amount: 50000,
      });
    expect(denied.status).toBe(403);

    // Admin lists invoices
    (prisma.invoice.findMany as any).mockResolvedValue([
      {
        id: 'inv-1',
        number: 'EL/INV/26-27/001',
        companyId: 'comp-1',
        workType: 'RETAINER',
        workId: 'ret-1',
        amount: 75000,
        raisedAt: new Date(),
        dueAt: new Date(Date.now() + 15 * 24 * 3600 * 1000),
        status: InvoiceStatus.RAISED,
        paidAt: null,
        proformaId: null,
        company: { id: 'comp-1', name: 'Acme Corp', domain: 'acme.com' },
        payments: [],
        project: null,
      },
    ]);

    const adminList = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminList.status).toBe(200);
    expect(adminList.body.data[0].amount).toBe(75000);

    // A HEAD holds money.status ("paid or unpaid, never an amount") but not
    // money.figures -> the list is visible, the rupee figure is masked.
    const headList = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${headToken}`);
    expect(headList.status).toBe(200);
    expect(headList.body.data[0].amount).toBeNull();

    // A plain EMPLOYEE holds neither money.status nor money.figures -> the
    // list itself is refused, not just the amount. Enumerating every
    // client's invoices and payment status org-wide is not "work.own".
    const empList = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(empList.status).toBe(403);
  });

  it('4. Verifies payment recording and automatic settlement to PAID status', async () => {
    (prisma.invoice.findFirst as any).mockResolvedValue({
      id: 'inv-1',
      organizationId: 'org-1',
      number: 'EL/INV/26-27/001',
      amount: 50000,
      status: InvoiceStatus.RAISED,
      payments: [],
      company: { id: 'comp-1', name: 'Acme Corp' },
    });

    (prisma.payment.create as any).mockResolvedValue({
      id: 'pay-1',
      invoiceId: 'inv-1',
      amount: 50000,
      receivedAt: new Date(),
      mode: 'NEFT',
      reference: 'UTR12345678',
    });

    (prisma.invoice.update as any).mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.PAID,
      paidAt: new Date(),
      payments: [{ id: 'pay-1', amount: 50000 }],
      company: { id: 'comp-1', name: 'Acme Corp' },
    });

    (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });

    const payRes = await request(app)
      .post('/api/invoices/inv-1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 50000,
        mode: 'NEFT',
        reference: 'UTR12345678',
      });

    expect(payRes.status).toBe(201);
    expect(payRes.body.success).toBe(true);
    expect(payRes.body.isFullySettled).toBe(true);
  });

  it('5. Verifies 3-month forward cash flow forecast calculation', async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      { id: 'usr-1', name: 'Lead Dev', dept: 'Development', monthlyCost: 100000 },
      { id: 'usr-2', name: 'Lead Designer', dept: 'Design', monthlyCost: 80000 },
    ]);

    (prisma.retainer.findMany as any).mockResolvedValue([
      { id: 'ret-1', monthlyValue: 250000, endsOn: null, company: { id: 'comp-1', name: 'Alpha' } },
      { id: 'ret-2', monthlyValue: 150000, endsOn: null, company: { id: 'comp-2', name: 'Beta' } },
    ]);

    (prisma.proposal.findMany as any).mockResolvedValue([
      {
        id: 'prop-1',
        stage: 'VERBAL_YES',
        probabilityOverride: null,
        company: { id: 'comp-3', name: 'Gamma' },
        versions: [{ value: 300000, n: 1 }],
      },
    ]);

    (prisma.project.findMany as any).mockResolvedValue([]);

    const forecastRes = await request(app)
      .get('/api/forecast/3-month')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(forecastRes.status).toBe(200);
    expect(forecastRes.body.success).toBe(true);
    expect(forecastRes.body.forecast).toHaveLength(3);
    // Month 1 should have MRR 400,000 + weighted verbal yes (90% of 300,000 = 270,000)
    expect(forecastRes.body.forecast[0].inflows.retainers).toBe(400000);
    expect(forecastRes.body.forecast[0].outflows.payroll).toBe(180000);
    expect(forecastRes.body.forecast[0].status).toBe('SURPLUS');
  });

  it('6. Verifies Monday Morning Intelligence Briefing 4-quadrant calculation', async () => {
    (prisma.retainer.findMany as any).mockResolvedValue([
      {
        id: 'ret-1',
        monthlyValue: 200000,
        renewalDate: new Date(Date.now() + 20 * 24 * 3600 * 1000), // expires in 20 days (<45 days)
        company: { id: 'c-1', name: 'Expiring Client', website: 'https://exp.com' },
        monthCards: [],
      },
    ]);

    (prisma.proposal.findMany as any).mockResolvedValue([
      {
        id: 'prop-1',
        stage: 'VERBAL_YES',
        updatedAt: new Date(),
        company: { id: 'c-2', name: 'Verbal Client' },
        owner: { id: 'u-1', name: 'BD Lead' },
        versions: [{ value: 150000 }],
      },
    ]);

    (prisma.invoice.findMany as any).mockResolvedValue([]);
    (prisma.user.findMany as any).mockResolvedValue([]);

    const briefRes = await request(app)
      .get('/api/brief/monday')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(briefRes.status).toBe(200);
    expect(briefRes.body.success).toBe(true);
    expect(briefRes.body.quadrants.contractRisks.count).toBe(1);
    expect(briefRes.body.quadrants.contractRisks.items[0].companyName).toBe('Expiring Client');
    expect(briefRes.body.quadrants.pipelineMomentum.verbalYesCount).toBe(1);
  });
});
