/**
 * Moving a deal — and the one move that changes everything.
 *
 * Most stage changes are bookkeeping. Winning is not: it turns a company into a
 * client, creates the thing that bills them, and closes the deal, and those must
 * happen together or not at all. One click cannot half-win a deal and leave a
 * client nobody is billing (master plan §4.7).
 */

import { Prisma } from '@prisma/client';
import type { ContractType, BillingFrequency, PaymentTerms } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { syncCompanyStatus } from './companyStatus.js';
import {
  validateStageEntry,
  validateStageMove,
  type FieldError,
  type StageShape,
} from './stageRules.js';

/** A rule was broken. Carries every problem, so a form can show them at once. */
export class DealRuleError extends Error {
  readonly code = 'DEAL_RULE_VIOLATION';
  constructor(readonly errors: FieldError[]) {
    super(errors.map((e) => e.message).join(' '));
    this.name = 'DealRuleError';
  }
}

export type WinTerms = {
  contractType: ContractType;
  startDate: Date;
  endDate?: Date | null;
  amount: Prisma.Decimal | number | string;
  billingFrequency: BillingFrequency;
  paymentTerms?: PaymentTerms | null;
  advanceAmount?: Prisma.Decimal | number | string | null;
  cgst?: Prisma.Decimal | number | string;
  sgst?: Prisma.Decimal | number | string;
  igst?: Prisma.Decimal | number | string;
  notes?: string | null;
};

const STAGE_SELECT = {
  id: true,
  name: true,
  kind: true,
  requiresForecast: true,
  archivedAt: true,
} as const;

const toStageShape = (s: {
  id: string;
  name: string;
  kind: StageShape['kind'];
  requiresForecast: boolean;
  archivedAt: Date | null;
}): StageShape => s;

/**
 * Move a deal to a stage.
 *
 * Winning routes through `winDeal` instead — it needs terms this signature does
 * not carry, and quietly creating an engagement from a plain stage change is how
 * the old system billed a one-off project monthly forever.
 */
export const moveDealToStage = async (
  dealId: string,
  toStageId: string,
  userId: string | null,
): Promise<{ dealId: string; fromStageId: string | null; toStageId: string }> => {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { stage: { select: STAGE_SELECT } },
  });
  if (!deal) throw new DealRuleError([{ field: 'dealId', message: 'Deal not found.' }]);

  const to = await prisma.stage.findUnique({ where: { id: toStageId }, select: STAGE_SELECT });
  if (!to) throw new DealRuleError([{ field: 'stageId', message: 'Stage not found.' }]);

  if (to.kind === 'WON') {
    throw new DealRuleError([
      {
        field: 'stageId',
        message:
          'Winning a deal needs its terms — use the win action so the engagement is created with it.',
      },
    ]);
  }

  const from = toStageShape(deal.stage);
  const target = toStageShape(to);

  const move = validateStageMove(from, target);
  if (!move.ok) throw new DealRuleError(move.errors);

  const entry = validateStageEntry(target, {
    value: deal.value,
    expectedCloseDate: deal.expectedCloseDate,
    contractType: deal.contractType,
    lostReasonId: deal.lostReasonId,
  });
  if (!entry.ok) throw new DealRuleError(entry.errors);

  await prisma.$transaction(async (tx) => {
    await tx.deal.update({
      where: { id: dealId },
      data: {
        stageId: toStageId,
        ...(target.kind === 'LOST' ? { lostAt: new Date() } : {}),
      },
    });

    // Append-only. The only source of cycle time, win rate and "12 days in this
    // stage", and it points at stage IDs so a rename never rewrites history.
    await tx.stageHistory.create({
      data: { dealId, fromStageId: from.id, toStageId, movedById: userId },
    });

    await tx.activity.create({
      data: {
        organizationId: deal.organizationId,
        type: 'STAGE_CHANGE',
        message: `Moved from ${from.name} to ${target.name}`,
        userId,
        dealId,
        companyId: deal.companyId,
      },
    });
  });

  return { dealId, fromStageId: from.id, toStageId };
};

/**
 * Win a deal.
 *
 * Everything below happens in ONE transaction:
 *
 *   the deal moves to the won stage and closes
 *   stage history records the move
 *   the company becomes a client
 *   ONE engagement is created
 *   its first price revision is written
 *
 * The engagement carries `@@unique([dealId])`, so two people clicking at the same
 * instant cannot bill the client twice — the second fails at the database rather
 * than relying on the application having checked first (§3.6).
 *
 * The first revision is written here rather than later because revision history
 * only works if it starts when the engagement does. Add it a month in and every
 * question about the first month is unanswerable (§3.7).
 */
export const winDeal = async (
  dealId: string,
  terms: WinTerms,
  userId: string | null,
): Promise<{ dealId: string; engagementId: string; companyStatus: string }> => {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      stage: { select: STAGE_SELECT },
      company: { select: { id: true, name: true } },
      engagement: { select: { id: true } },
    },
  });
  if (!deal) throw new DealRuleError([{ field: 'dealId', message: 'Deal not found.' }]);

  if (deal.engagement) {
    throw new DealRuleError([
      { field: 'dealId', message: 'This deal has already been won and has an engagement.' },
    ]);
  }

  const wonStage = await prisma.stage.findFirst({
    where: { pipelineId: (await pipelineIdOf(deal.stageId)) ?? undefined, kind: 'WON', archivedAt: null },
    select: STAGE_SELECT,
  });
  if (!wonStage) {
    throw new DealRuleError([
      { field: 'stageId', message: 'This pipeline has no won stage, so nothing can be won in it.' },
    ]);
  }

  const from = toStageShape(deal.stage);
  const target = toStageShape(wonStage);

  const move = validateStageMove(from, target);
  if (!move.ok) throw new DealRuleError(move.errors);

  const entry = validateStageEntry(target, {
    value: deal.value,
    expectedCloseDate: deal.expectedCloseDate,
    contractType: terms.contractType,
    lostReasonId: deal.lostReasonId,
    engagementStartDate: terms.startDate,
    engagementEndDate: terms.endDate ?? null,
  });
  if (!entry.ok) throw new DealRuleError(entry.errors);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: deal.organizationId },
    select: { currency: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();

    await tx.deal.update({
      where: { id: dealId },
      data: {
        stageId: wonStage.id,
        contractType: terms.contractType,
        wonAt: now,
        isOnHold: false,
        heldSince: null,
      },
    });

    await tx.stageHistory.create({
      data: { dealId, fromStageId: from.id, toStageId: wonStage.id, movedById: userId },
    });

    const engagement = await tx.engagement.create({
      data: {
        organizationId: deal.organizationId,
        companyId: deal.companyId,
        dealId,
        type: terms.contractType,
        status: 'ACTIVE',
        amount: new Prisma.Decimal(terms.amount),
        currency: org.currency,
        billingFrequency: terms.billingFrequency,
        paymentTerms: terms.paymentTerms ?? null,
        cgst: new Prisma.Decimal(terms.cgst ?? 0),
        sgst: new Prisma.Decimal(terms.sgst ?? 0),
        igst: new Prisma.Decimal(terms.igst ?? 0),
        advanceAmount:
          terms.advanceAmount == null ? null : new Prisma.Decimal(terms.advanceAmount),
        startDate: terms.startDate,
        // Absent means ROLLING. Not missing data — most retainers just run, and
        // inventing a date invents a deadline nobody agreed to (§3.6).
        endDate: terms.endDate ?? null,
        // Billing is due from day one. The date only ever advances when an
        // invoice is actually raised, never on a timer (§3.8).
        nextBillingDate: terms.billingFrequency === 'ONE_TIME' ? terms.startDate : terms.startDate,
        reviewIntervalMonths: 6,
        nextReviewDate: addMonths(terms.startDate, 6),
        notes: terms.notes ?? null,
      },
    });

    await tx.engagementRevision.create({
      data: {
        engagementId: engagement.id,
        amount: engagement.amount,
        billingFrequency: engagement.billingFrequency,
        status: 'ACTIVE',
        effectiveFrom: terms.startDate,
        reason: 'Deal won',
        changedById: userId ?? 'system',
      },
    });

    const status = await syncCompanyStatus(deal.companyId, tx);

    await tx.activity.create({
      data: {
        organizationId: deal.organizationId,
        type: 'STAGE_CHANGE',
        message: `Deal won — ${terms.contractType === 'RETAINER' ? 'retainer' : 'project'} starting ${terms.startDate.toISOString().slice(0, 10)}`,
        userId,
        dealId,
        companyId: deal.companyId,
        engagementId: engagement.id,
      },
    });

    // Auto-generate onboarding tasks if configured
    const orgRecord = await tx.organization.findUnique({
      where: { id: deal.organizationId },
      select: { settings: true },
    });
    const settings = orgRecord?.settings as { defaultOnboardingTasks?: { title: string; description?: string }[] } | null;
    
    if (settings?.defaultOnboardingTasks && Array.isArray(settings.defaultOnboardingTasks)) {
      for (const [idx, taskDef] of settings.defaultOnboardingTasks.entries()) {
        await tx.task.create({
          data: {
            organizationId: deal.organizationId,
            dealId,
            title: taskDef.title,
            description: taskDef.description,
            status: 'TODO',
            priority: 'MEDIUM',
            assigneeId: deal.ownerId ?? userId,
            position: idx,
          },
        });
      }
    }

    return { engagementId: engagement.id, companyStatus: status.status };
  });

  return { dealId, ...result };
};

const pipelineIdOf = async (stageId: string): Promise<string | null> => {
  const s = await prisma.stage.findUnique({ where: { id: stageId }, select: { pipelineId: true } });
  return s?.pipelineId ?? null;
};

/**
 * Add whole months, clamping to the end of a short month.
 *
 * 31 January plus one month is 28 February, not 3 March. The naive version walks
 * a review or billing date forward through the year.
 */
export const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date);
  const targetDay = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTarget = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(targetDay, lastDayOfTarget));
  return d;
};

/**
 * Park a deal.
 *
 * A FLAG, not a stage. As a stage it destroyed the deal's position — unhold had
 * to guess where it came from, and a deal parked at Negotiation could return as a
 * New Lead (§1.3 ⑥).
 *
 * Parking a deal costs nothing; there is no billing yet. Pausing a CLIENT stops
 * real money and is a different action entirely (§4.11).
 */
export const holdDeal = async (dealId: string, reason: string | null, userId: string | null) => {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: { id: true, organizationId: true, companyId: true, isOnHold: true },
  });
  if (deal.isOnHold) return deal;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.deal.update({
      where: { id: dealId },
      data: { isOnHold: true, heldSince: new Date(), holdReason: reason },
    });
    await tx.activity.create({
      data: {
        organizationId: deal.organizationId,
        type: 'SYSTEM',
        message: reason ? `Deal parked — ${reason}` : 'Deal parked',
        userId,
        dealId,
        companyId: deal.companyId,
      },
    });
    return updated;
  });
};

/** Unpark it. The deal is exactly where it was — nothing has to be reconstructed. */
export const unholdDeal = async (dealId: string, userId: string | null) => {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: { id: true, organizationId: true, companyId: true, isOnHold: true },
  });
  if (!deal.isOnHold) return deal;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.deal.update({
      where: { id: dealId },
      data: { isOnHold: false, heldSince: null, holdReason: null },
    });
    await tx.activity.create({
      data: {
        organizationId: deal.organizationId,
        type: 'SYSTEM',
        message: 'Deal resumed',
        userId,
        dealId,
        companyId: deal.companyId,
      },
    });
    return updated;
  });
};
