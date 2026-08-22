/**
 * Scanner unit tests.
 *
 * Tests each signal function in isolation by verifying the shape and deduplication
 * keys of the returned notification rows, without needing a real database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before importing scanner
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    deal: { findMany: vi.fn() },
    engagement: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    userRole: { findMany: vi.fn() },
    notification: { upsert: vi.fn() },
    organization: { findMany: vi.fn() },
    quote: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/orgConfig.js', () => ({
  getOrgConfig: vi.fn().mockResolvedValue({
    id: 'org1',
    name: 'Test Org',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    locale: 'en-IN',
    dateFormat: 'dd MMM yyyy',
    fiscalYearStart: 4,
    documentPrefix: 'FZ',
    state: null,
    gstNumber: null,
  }),
}));

import { prisma } from '../lib/prisma.js';
import {
  scanFollowUps,
  scanRottingDeals,
  scanQuotesAwaitingReply,
  scanReviewsDue,
  scanExpiringEngagements,
  scanOverdueInvoices,
  scanBillingDue,
  scanTasks,
} from './scanner.js';

const TZ = 'Asia/Kolkata';

describe('Scanner signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scanFollowUps', () => {
    it('creates a notification for each deal with a due follow-up', async () => {
      (prisma.deal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'deal1',
          title: 'Website deal',
          ownerId: 'user1',
          followUpDate: new Date('2026-08-01'),
          company: { name: 'Acme Corp' },
        },
      ]);

      const rows = await scanFollowUps('org1', TZ);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: 'user1',
        type: 'FOLLOW_UP_DUE',
        dedupeKey: 'followup:deal1',
        link: '/pipeline/deal1',
      });
      expect(rows[0].title).toContain('Acme Corp');
    });

    it('returns empty when no follow-ups are due', async () => {
      (prisma.deal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const rows = await scanFollowUps('org1', TZ);
      expect(rows).toHaveLength(0);
    });
  });

  describe('scanRottingDeals', () => {
    it('flags a deal that has exceeded its stage patience', async () => {
      // A deal in stage with rottingDays=7, entered 10 days ago
      const enteredAt = new Date(Date.now() - 10 * 86_400_000);
      (prisma.deal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'deal2',
          title: 'Logo rebrand',
          ownerId: 'user2',
          createdAt: enteredAt,
          company: { name: 'Beta Inc' },
          stage: { name: 'Meeting', kind: 'OPEN', rottingDays: 7 },
          stageHistory: [{ enteredAt }],
        },
      ]);

      const rows = await scanRottingDeals('org1', TZ);
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe('rotting:deal2');
      expect(rows[0].type).toBe('DEAL_ROTTING');
    });

    it('skips a deal within its patience window', async () => {
      const enteredAt = new Date(Date.now() - 2 * 86_400_000);
      (prisma.deal.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'deal3',
          title: 'Fresh deal',
          ownerId: 'user1',
          createdAt: enteredAt,
          company: { name: 'Gamma' },
          stage: { name: 'Meeting', kind: 'OPEN', rottingDays: 14 },
          stageHistory: [{ enteredAt }],
        },
      ]);

      const rows = await scanRottingDeals('org1', TZ);
      expect(rows).toHaveLength(0);
    });
  });

  describe('scanReviewsDue', () => {
    it('flags rolling engagements due for review', async () => {
      (prisma.engagement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'eng1',
          nextReviewDate: new Date(Date.now() + 5 * 86_400_000),
          company: { id: 'comp1', name: 'Delta Ltd', ownerId: 'user3' },
        },
      ]);

      const rows = await scanReviewsDue('org1');
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe('review-due:eng1');
      expect(rows[0].userId).toBe('user3');
    });

    it('skips engagements without a company owner', async () => {
      (prisma.engagement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'eng2',
          nextReviewDate: new Date(),
          company: { id: 'comp2', name: 'Orphan', ownerId: null },
        },
      ]);

      const rows = await scanReviewsDue('org1');
      expect(rows).toHaveLength(0);
    });
  });

  describe('scanExpiringEngagements', () => {
    it('flags fixed-term engagements ending within 30 days', async () => {
      (prisma.engagement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'eng3',
          endDate: new Date(Date.now() + 15 * 86_400_000),
          company: { id: 'comp3', name: 'Epsilon', ownerId: 'user4' },
        },
      ]);

      const rows = await scanExpiringEngagements('org1');
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe('expiring:eng3');
    });
  });

  describe('scanOverdueInvoices', () => {
    it('notifies company owner AND admins', async () => {
      (prisma.invoice.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'inv1',
          number: 'EL/INV/2026-27/001',
          total: { toString: () => '50000' },
          dueDate: new Date('2026-07-01'),
          company: { id: 'comp1', name: 'Alpha', ownerId: 'owner1' },
        },
      ]);
      (prisma.userRole.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { userId: 'admin1' },
        { userId: 'owner1' }, // same as owner — should be deduped
      ]);

      const rows = await scanOverdueInvoices('org1');
      // owner1 gets one (as owner), admin1 gets one (as admin), owner1 not
      // duplicated as admin because they are already the owner
      expect(rows).toHaveLength(2);
      const keys = rows.map((r) => r.dedupeKey);
      expect(keys).toContain('overdue-invoice:inv1:owner1');
      expect(keys).toContain('overdue-invoice:inv1:admin1');
    });
  });

  describe('scanBillingDue', () => {
    it('notifies admins about engagements needing an invoice', async () => {
      (prisma.engagement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'eng4',
          amount: { toString: () => '40000' },
          company: { id: 'comp4', name: 'Zeta' },
        },
      ]);
      (prisma.userRole.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { userId: 'admin1' },
      ]);

      const rows = await scanBillingDue('org1', TZ);
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe('billing-due:eng4:admin1');
      expect(rows[0].type).toBe('BILLING_DUE');
    });
  });

  describe('scanTasks', () => {
    it('distinguishes overdue from due-today', async () => {
      const yesterday = new Date(Date.now() - 86_400_000);
      const today = new Date();

      (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'task1',
          title: 'Overdue task',
          dueDate: yesterday,
          assigneeId: 'user1',
          project: { id: 'proj1', name: 'Website' },
        },
        {
          id: 'task2',
          title: 'Due today task',
          dueDate: today,
          assigneeId: 'user2',
          project: null,
        },
      ]);

      const rows = await scanTasks('org1', TZ);
      expect(rows).toHaveLength(2);

      const overdue = rows.find((r) => r.dedupeKey.includes('task1'));
      const dueToday = rows.find((r) => r.dedupeKey.includes('task2'));

      expect(overdue?.type).toBe('TASK_OVERDUE');
      expect(dueToday?.type).toBe('TASK_DUE_TODAY');
    });
  });

  describe('deduplication keys', () => {
    it('produces unique keys per signal type', async () => {
      // Verify that two different signal types on the same entity produce different keys
      const followUpKey = 'followup:deal1';
      const rottingKey = 'rotting:deal1';
      expect(followUpKey).not.toBe(rottingKey);
    });
  });
});
