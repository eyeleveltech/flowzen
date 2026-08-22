/**
 * Engagements — what a client pays, and the history of what they used to pay.
 *
 * Subscription and Contract merged into one thing, because they differed only in
 * how often they bill. That is a field, not a table — and two tables gave two
 * different answers for monthly revenue, which disagreed for four of five real
 * clients (master plan §1.3 ③).
 */

import { Prisma } from '@prisma/client';
import type { BillingFrequency, EngagementStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { syncCompanyStatus } from './companyStatus.js';
import { addMonths } from './deal.service.js';

const D = Prisma.Decimal;

/**
 * One engagement's contribution to monthly recurring revenue.
 *
 * ONE definition, used by every screen. Previously the renewals screen summed
 * deal values while the revenue screen summed subscriptions, so the two never
 * agreed and neither could be trusted (§3.6).
 */
export const monthlyValue = (
  amount: Prisma.Decimal | number | string,
  frequency: BillingFrequency,
): Prisma.Decimal => {
  const a = new D(amount);
  switch (frequency) {
    case 'MONTHLY':
      return a;
    case 'QUARTERLY':
      return a.div(3);
    case 'YEARLY':
      return a.div(12);
    // A one-off is not recurring, so it contributes nothing to a RECURRING total.
    // Including it makes a good month look like a permanent step change.
    case 'ONE_TIME':
      return new D(0);
  }
};

/** MRR for an organisation: every ACTIVE engagement, as a monthly figure. */
export const calculateMrr = async (organizationId: string): Promise<Prisma.Decimal> => {
  const engagements = await prisma.engagement.findMany({
    where: { organizationId, status: 'ACTIVE', billingFrequency: { not: 'ONE_TIME' } },
    select: { amount: true, billingFrequency: true },
  });
  return engagements.reduce(
    (total, e) => total.add(monthlyValue(e.amount, e.billingFrequency)),
    new D(0),
  );
};

export type TermsChange = {
  amount?: Prisma.Decimal | number | string;
  billingFrequency?: BillingFrequency;
  status?: EngagementStatus;
  effectiveFrom?: Date;
  reason: string;
};

/**
 * Change an engagement's commercial terms.
 *
 * Always writes a revision. Raising a client from 40,000 to 55,000 by overwriting
 * the number makes "what were we earning last March?" permanently unanswerable —
 * and you discover that on the day you need it (§3.7).
 *
 * This is also one of the four audited events, because it involves money (§3.12).
 */
export const changeTerms = async (
  engagementId: string,
  change: TermsChange,
  userId: string,
): Promise<{ engagementId: string; revisionId: string }> => {
  const engagement = await prisma.engagement.findUniqueOrThrow({
    where: { id: engagementId },
    select: {
      id: true,
      organizationId: true,
      companyId: true,
      amount: true,
      billingFrequency: true,
      status: true,
      reviewIntervalMonths: true,
    },
  });

  const next = {
    amount: change.amount === undefined ? engagement.amount : new D(change.amount),
    billingFrequency: change.billingFrequency ?? engagement.billingFrequency,
    status: change.status ?? engagement.status,
  };

  const effectiveFrom = change.effectiveFrom ?? new Date();

  return prisma.$transaction(async (tx) => {
    await tx.engagement.update({
      where: { id: engagementId },
      data: {
        amount: next.amount,
        billingFrequency: next.billingFrequency,
        status: next.status,
        // A price review resets the clock whatever the outcome — deciding not to
        // change the price is still a review, and should not re-prompt tomorrow.
        lastReviewedAt: effectiveFrom,
        nextReviewDate: addMonths(effectiveFrom, engagement.reviewIntervalMonths ?? 6),
        ...(next.status === 'ENDED' ? { endedAt: effectiveFrom } : {}),
      },
    });

    const revision = await tx.engagementRevision.create({
      data: {
        engagementId,
        amount: next.amount,
        billingFrequency: next.billingFrequency,
        status: next.status,
        effectiveFrom,
        reason: change.reason,
        changedById: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: engagement.organizationId,
        userId,
        action: 'ENGAGEMENT_TERMS_CHANGED',
        entityType: 'Engagement',
        entityId: engagementId,
        before: {
          amount: engagement.amount.toString(),
          billingFrequency: engagement.billingFrequency,
          status: engagement.status,
        },
        after: {
          amount: next.amount.toString(),
          billingFrequency: next.billingFrequency,
          status: next.status,
        },
      },
    });

    // The status change may make the company churned, on hold, or active again.
    // One writer decides that, never this function (§3.2).
    await syncCompanyStatus(engagement.companyId, tx);

    return { engagementId, revisionId: revision.id };
  });
};

/**
 * What an engagement's terms were on a given date.
 *
 * This is what revisions buy: any month's revenue can be reconstructed exactly,
 * rather than approximated from a snapshot taken on a schedule.
 */
export const termsAsOf = async (
  engagementId: string,
  date: Date,
): Promise<{ amount: Prisma.Decimal; billingFrequency: BillingFrequency; status: EngagementStatus } | null> => {
  const revision = await prisma.engagementRevision.findFirst({
    where: { engagementId, effectiveFrom: { lte: date } },
    orderBy: { effectiveFrom: 'desc' },
    select: { amount: true, billingFrequency: true, status: true },
  });
  return revision;
};

/**
 * Whether an engagement is rolling — running until somebody stops it.
 *
 * A blank end date MEANS something. Nothing expires, so the risk is not expiry;
 * it is a price that never moved while the work quietly grew (§4.10).
 */
export const isRolling = (engagement: { type: string; endDate: Date | null }): boolean =>
  engagement.type === 'RETAINER' && engagement.endDate === null;

/**
 * Engagements needing attention, split by why.
 *
 * Fixed-term ones expire and need a renew-or-not decision. Rolling ones never do,
 * so the question asked of them is different: is this still the right price?
 */
export const findNeedingAttention = async (organizationId: string, withinDays = 30) => {
  const horizon = new Date(Date.now() + withinDays * 86_400_000);

  const [expiring, dueForReview] = await Promise.all([
    prisma.engagement.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        endDate: { not: null, lte: horizon },
      },
      include: { company: { select: { id: true, name: true, ownerId: true } } },
      orderBy: { endDate: 'asc' },
    }),
    prisma.engagement.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        endDate: null,
        nextReviewDate: { lte: horizon },
      },
      include: { company: { select: { id: true, name: true, ownerId: true } } },
      orderBy: { nextReviewDate: 'asc' },
    }),
  ]);

  return { expiring, dueForReview };
};

/**
 * Pause a client's billing.
 *
 * Stops real money, which is why it is a separate act from parking a deal. Before
 * freezing, the caller should check for another live engagement with the same
 * company — pausing one of two does not pause the customer (§4.11).
 */
export const pauseEngagement = (engagementId: string, reason: string, userId: string) =>
  changeTerms(engagementId, { status: 'PAUSED', reason }, userId);

export const resumeEngagement = (engagementId: string, reason: string, userId: string) =>
  changeTerms(engagementId, { status: 'ACTIVE', reason }, userId);

export const endEngagement = (engagementId: string, reason: string, userId: string, on?: Date) =>
  changeTerms(engagementId, { status: 'ENDED', reason, effectiveFrom: on }, userId);
