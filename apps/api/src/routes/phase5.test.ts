import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { evaluateAgencyHealthRules } from '../workers/scanner.cron.js';
import { CostType, CostPaidBy, CostTreatment, RolePreset, TaskWorkType } from '@prisma/client';

describe('Phase 5: Direct Costs, Allocations & The 12 Health Rules Scanner', () => {
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

  const headToken = signJwt({
    userId: 'usr-head-1',
    organizationId: 'org-1',
    email: 'head@eyelevel.local',
    preset: 'HEAD',
    permissions: ['work.own', 'work.team', 'cost.enter'],
  });

  const employeeToken = signJwt({
    userId: 'usr-emp-1',
    organizationId: 'org-1',
    email: 'designer@eyelevel.local',
    preset: 'EMPLOYEE',
    permissions: ['work.own'],
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
      if (where.id === 'usr-head-1') {
        return {
          id: 'usr-head-1',
          organizationId: 'org-1',
          name: 'Design Lead',
          email: 'head@eyelevel.local',
          preset: RolePreset.HEAD,
          permissions: ['work.own', 'work.team', 'cost.enter'],
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
      return null;
    });
  });

  it('1. Verifies direct cost creation and cost.enter permission gating', async () => {
    // Employee without cost.enter is denied
    const denied = await request(app)
      .post('/api/costs')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        category: 'AD_SPEND',
        vendor: 'Meta Ads',
        amount: 25000,
      });
    expect(denied.status).toBe(403);

    // Head with cost.enter can record cost
    (prisma.cost.create as any).mockResolvedValue({
      id: 'cost-1',
      organizationId: 'org-1',
      type: CostType.DIRECT,
      category: 'AD_SPEND',
      vendor: 'Meta Ads',
      amount: 25000,
      incurredAt: new Date(),
      paidBy: CostPaidBy.COMPANY,
      treatment: CostTreatment.COMPANY_EXPENSE,
      enteredById: 'usr-head-1',
    });
    (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });

    const created = await request(app)
      .post('/api/costs')
      .set('Authorization', `Bearer ${headToken}`)
      .send({
        type: 'DIRECT',
        workType: 'RETAINER',
        workId: 'ret-1',
        category: 'AD_SPEND',
        vendor: 'Meta Ads',
        amount: 25000,
      });

    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
  });

  it('2. Verifies bulk percentage allocation saving and salary privacy masking', async () => {
    (prisma.user.findFirst as any).mockResolvedValue({
      id: 'usr-emp-1',
      organizationId: 'org-1',
      name: 'Designer Dave',
    });

    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback({
        peopleAllocation: {
          deleteMany: async () => ({ count: 1 }),
          create: async (data: any) => ({ id: 'alloc-1', ...data }),
        },
      });
    });

    // Head saves 50% / 50% split for designer
    const allocRes = await request(app)
      .post('/api/allocations/bulk')
      .set('Authorization', `Bearer ${headToken}`)
      .send({
        userId: 'usr-emp-1',
        month: '2026-08',
        allocations: [
          { workType: 'RETAINER', workId: 'ret-1', percent: 50 },
          { workType: 'PROJECT', workId: 'proj-1', percent: 50 },
        ],
      });

    expect(allocRes.status).toBe(201);
    expect(allocRes.body.success).toBe(true);

    // List allocations as Head (No money.figures) -> monthlyCost and salaryCost are null
    (prisma.user.findMany as any).mockResolvedValue([
      {
        id: 'usr-emp-1',
        name: 'Designer Dave',
        email: 'designer@eyelevel.local',
        dept: 'Design',
        preset: 'EMPLOYEE',
        monthlyCost: 60000,
        allocations: [
          {
            id: 'alloc-1',
            workType: 'RETAINER',
            workId: 'ret-1',
            percent: 50,
            proposedPercent: 50,
            confirmedAt: null,
            confirmedBy: null,
            monthCard: null,
            project: null,
          },
        ],
      },
    ]);

    const headList = await request(app)
      .get('/api/allocations?month=2026-08')
      .set('Authorization', `Bearer ${headToken}`);

    expect(headList.status).toBe(200);
    expect(headList.body.members[0].monthlyCost).toBeNull();
    expect(headList.body.members[0].allocations[0].salaryCost).toBeNull();
    expect(headList.body.members[0].totalPercent).toBe(50);
  });

  it('3. Verifies allocation confirmation with cost.approve permission', async () => {
    (prisma.peopleAllocation.updateMany as any).mockResolvedValue({ count: 4 });

    const confirmRes = await request(app)
      .post('/api/allocations/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        month: '2026-08',
      });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);
    expect(confirmRes.body.confirmedCount).toBe(4);
  });

  it('4. Verifies the 12 Agency Health Rules pure evaluator', async () => {
    const sevenDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);

    (prisma.proposal.findMany as any).mockResolvedValueOnce([
      {
        id: 'prop-stalled',
        stage: 'PROPOSAL_SENT',
        ownerId: 'usr-head-1',
        updatedAt: sevenDaysAgo,
        company: { name: 'Slow Client' },
        versions: [{ sentAt: sevenDaysAgo }],
      },
    ]).mockResolvedValueOnce([]); // verbal

    (prisma.task.findFirst as any).mockResolvedValue(null);

    (prisma.proforma.findMany as any).mockResolvedValue([]);
    (prisma.retainer.findMany as any).mockResolvedValue([
      {
        id: 'ret-expiring',
        renewalDate: new Date(Date.now() + 10 * 24 * 3600 * 1000), // 10 days left
        company: { name: 'Expiring Client' },
      },
    ]);

    (prisma.task.findMany as any).mockResolvedValueOnce([
      {
        id: 'task-overdue',
        title: 'Brand Guidelines',
        dueDate: yesterday,
        assignee: { name: 'Dave' },
      },
    ]).mockResolvedValueOnce([]) // hold
      .mockResolvedValue([]); // fallback for TASK_AGING's done/open task lookups

    (prisma.invoice.findMany as any).mockResolvedValue([]);
    (prisma.peopleAllocation.groupBy as any).mockResolvedValue([]);
    (prisma.peopleAllocation.count as any).mockResolvedValue(0);
    (prisma.project.findMany as any).mockResolvedValue([]);
    (prisma.user.findMany as any).mockResolvedValue([]);
    (prisma.task.groupBy as any).mockResolvedValue([]);
    (prisma.company.findMany as any).mockResolvedValue([]);
    (prisma.monthCard.findMany as any).mockResolvedValue([]);
    // The evaluator also runs the four asset rules now — see
    // routes/assets.test.ts for the tests that actually exercise them.
    (prisma.asset.findMany as any).mockResolvedValue([]);
    (prisma.assetMovement.findMany as any).mockResolvedValue([]);
    (prisma.assetMaintenance.findMany as any).mockResolvedValue([]);

    const alerts = await evaluateAgencyHealthRules('org-1');
    expect(alerts.length).toBeGreaterThanOrEqual(3);

    const rules = alerts.map((a) => a.rule);
    expect(rules).toContain('PROPOSAL_STALLED');
    expect(rules).toContain('RETAINER_EXPIRING');
    expect(rules).toContain('TASK_OVERDUE');
  });
});
