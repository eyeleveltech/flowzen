/**
 * The rules that govern moving a deal between stages.
 *
 * Kept as pure functions, separate from anything that touches the database, for
 * two reasons: they are the rules most worth testing exhaustively, and they are
 * enforced on the server rather than only in the browser (§5) — so the same
 * function has to be callable from a route, a bulk import and a test.
 *
 * The central constraint: **no rule may identify a stage by its name.** Stages are
 * rows and can be renamed, so a check for "Negotiation" would silently stop firing
 * the day somebody calls it "Commercials". Rules read `kind` and the explicit
 * flags instead (§3.4).
 */

import type { ContractType, StageKind } from '@prisma/client';

export type StageShape = {
  id: string;
  name: string;
  kind: StageKind;
  requiresForecast: boolean;
  /** Present when the caller has loaded it. An archived stage takes no new deals. */
  archivedAt?: Date | null;
};

/** What a deal would look like after the move. */
export type DealCandidate = {
  value: unknown | null;
  expectedCloseDate: Date | null;
  contractType: ContractType | null;
  lostReasonId: string | null;
  /** Only supplied when winning — the engagement is created in the same action. */
  engagementStartDate?: Date | null;
  engagementEndDate?: Date | null;
};

export type FieldError = {
  field: string;
  message: string;
};

export type StageEntryResult = { ok: true } | { ok: false; errors: FieldError[] };

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Whether a deal may enter `stage`.
 *
 * Returns every problem at once rather than throwing on the first. A stage form
 * that reveals one missing field per attempt is a form people learn to resent,
 * and it makes bulk import diagnostics useless.
 */
export const validateStageEntry = (
  stage: StageShape,
  deal: DealCandidate,
): StageEntryResult => {
  const errors: FieldError[] = [];

  // A forecast without an amount and a date cannot be planned against, so the
  // deal is invisible to planning while feeling like progress (§4.5).
  if (stage.requiresForecast) {
    if (isBlank(deal.value)) {
      errors.push({
        field: 'value',
        message: `A deal needs a value to reach ${stage.name}.`,
      });
    }
    if (!deal.expectedCloseDate) {
      errors.push({
        field: 'expectedCloseDate',
        message: `A deal needs an expected close date to reach ${stage.name}.`,
      });
    }
  }

  // Winning creates the engagement, so the terms it needs are required here.
  // Billing without a type is billing that is wrong — this is the check the old
  // system did not have, which let a one-off project bill monthly forever
  // (§1.3 ①).
  if (stage.kind === 'WON') {
    if (!deal.contractType) {
      errors.push({
        field: 'contractType',
        message: 'Say whether this is a retainer or a project before winning it.',
      });
    }
    if (!deal.engagementStartDate) {
      errors.push({
        field: 'engagementStartDate',
        message: 'A won deal needs a start date — it is when billing begins.',
      });
    }

    // A retainer with no end date is ROLLING, which is the normal case and
    // deliberately allowed. A project without one has no defined delivery, so the
    // absence there is missing data rather than meaning (§3.6).
    if (deal.contractType === 'PROJECT' && !deal.engagementEndDate) {
      errors.push({
        field: 'engagementEndDate',
        message: 'A project needs an end date. Only retainers may run open-ended.',
      });
    }

    if (
      deal.engagementStartDate &&
      deal.engagementEndDate &&
      deal.engagementEndDate < deal.engagementStartDate
    ) {
      errors.push({
        field: 'engagementEndDate',
        message: 'The end date cannot be before the start date.',
      });
    }
  }

  // Without a reason, "why do we lose?" is unanswerable — and it is the single
  // most useful question a pipeline can answer.
  if (stage.kind === 'LOST' && isBlank(deal.lostReasonId)) {
    errors.push({
      field: 'lostReasonId',
      message: 'Choose a reason before closing this deal as lost.',
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true };
};

/**
 * Whether a deal may move from one stage to another at all, before looking at
 * fields.
 *
 * Deliberately permissive about direction. Stages can be skipped and dragged
 * backwards, because real deals do not move in a straight line and forcing a
 * strict order teaches people to lie to the board (§4.5).
 *
 * The one thing that is not permitted is reopening a lost deal. A revival is a new
 * deal — otherwise cycle time and win rate are lies, because any deal could be
 * closed and reopened indefinitely (§5).
 */
export const validateStageMove = (
  from: StageShape | null,
  to: StageShape,
): StageEntryResult => {
  if (from?.kind === 'LOST' && to.kind !== 'LOST') {
    return {
      ok: false,
      errors: [
        {
          field: 'stageId',
          message:
            'A lost deal cannot be reopened. Create a new deal on the same company instead — ' +
            'that keeps win rate and cycle time honest.',
        },
      ],
    };
  }

  if (from?.id === to.id) {
    return { ok: false, errors: [{ field: 'stageId', message: 'The deal is already in that stage.' }] };
  }

  if (to.archivedAt) {
    return {
      ok: false,
      errors: [{ field: 'stageId', message: `${to.name} has been archived and cannot take deals.` }],
    };
  }

  return { ok: true };
};

/**
 * Whether a stage may be removed.
 *
 * A stage holding deals is BLOCKED rather than cascaded — deleting it would either
 * destroy deals or silently move them somewhere nobody chose. An empty stage is
 * ARCHIVED rather than deleted, so historical stage history stays resolvable
 * (§3.4).
 */
export const validateStageRemoval = (
  stage: StageShape,
  dealCount: number,
): StageEntryResult => {
  if (stage.kind === 'WON' || stage.kind === 'LOST') {
    return {
      ok: false,
      errors: [
        {
          field: 'stageId',
          message: `${stage.name} is the ${stage.kind.toLowerCase()} stage and cannot be removed. Every rule depends on there being exactly one.`,
        },
      ],
    };
  }

  if (dealCount > 0) {
    return {
      ok: false,
      errors: [
        {
          field: 'stageId',
          message: `${stage.name} still holds ${dealCount} deal${dealCount === 1 ? '' : 's'}. Move them first.`,
        },
      ],
    };
  }

  return { ok: true };
};

/**
 * How long a deal has sat in its current stage, and whether that is longer than
 * this stage's own patience.
 *
 * Per-stage rather than one global threshold: three days in Meeting is normal,
 * three weeks is not, and the same numbers make no sense for Proposal. The
 * thresholds already existed and were scanned daily but never shown (§1.3 ⑧).
 */
export const isRotting = (
  stage: Pick<StageShape, 'kind'> & { rottingDays: number | null },
  daysInStage: number,
): boolean => {
  // A closed deal cannot rot. It is finished, not neglected.
  if (stage.kind !== 'OPEN') return false;
  if (stage.rottingDays === null || stage.rottingDays <= 0) return false;
  return daysInStage > stage.rottingDays;
};

/**
 * Check a pipeline's shape before it is saved.
 *
 * The database enforces one WON and one LOST per pipeline with partial unique
 * indexes, but it cannot express ordering. Anything after the closing stages would
 * mean a won deal never leaves the board — which is the exact problem this design
 * removes (§3.4).
 */
export const validatePipelineShape = (stages: StageShape[]): StageEntryResult => {
  const live = stages.filter((s) => !s.archivedAt);
  const errors: FieldError[] = [];

  const won = live.filter((s) => s.kind === 'WON');
  const lost = live.filter((s) => s.kind === 'LOST');

  if (won.length !== 1) {
    errors.push({ field: 'stages', message: `A pipeline needs exactly one won stage. Found ${won.length}.` });
  }
  if (lost.length !== 1) {
    errors.push({ field: 'stages', message: `A pipeline needs exactly one lost stage. Found ${lost.length}.` });
  }

  if (won.length === 1 && lost.length === 1) {
    const closingIndexes = live
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind !== 'OPEN')
      .map(({ i }) => i);
    const firstClosing = Math.min(...closingIndexes);
    const openAfterClosing = live.slice(firstClosing).filter((s) => s.kind === 'OPEN');

    if (openAfterClosing.length) {
      errors.push({
        field: 'stages',
        message:
          `No stage may come after the closing stages. Found ${openAfterClosing.map((s) => `"${s.name}"`).join(', ')}. ` +
          'A pipeline answers one question — what might we win — and anything after the win means deals never leave the board.',
      });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
};
