import { ProposalStage, type Prisma } from '@prisma/client';

/**
 * What an active deal is — the one rule (QA19 fixes plan, F01).
 *
 * A deal is active while it has no outcome (not won, lost or expired) and is
 * not sitting in a closed stage. Both, because the two are written by
 * different routes and a row where one moved and the other did not is exactly
 * the row that should not be counted as live.
 *
 * Every screen used to decide this for itself, and they disagreed: the
 * Pipeline board took "not in the Won column" — which kept the whole Lost
 * column — so its "Live deals" and "Full pipeline" headline were inflated by
 * every deal that had already been lost, while Forecast, the Proposals list
 * and Zen each had a slightly different filter of their own. They all read
 * from here now.
 */
export const CLOSED_STAGES: ProposalStage[] = [ProposalStage.WON, ProposalStage.LOST, ProposalStage.EXPIRED];

/** The same rule as a Prisma filter. Deleted deals are never active either. */
export const ACTIVE_DEAL_WHERE = {
  deletedAt: null,
  outcome: null,
  stage: { notIn: CLOSED_STAGES },
} satisfies Prisma.ProposalWhereInput;

export const isActiveDeal = (p: { outcome: string | null; stage: string; deletedAt?: Date | null }): boolean =>
  p.outcome === null && !(CLOSED_STAGES as string[]).includes(p.stage) && !p.deletedAt;

/**
 * The pipeline's headline: how many active deals, what they come to if every
 * one lands, and that weighted by each deal's likelihood. Lost and won deals
 * stay in their own columns and out of these three numbers.
 */
export function activeDealTotals(
  deals: { outcome: string | null; stage: string; deletedAt?: Date | null; value: number | null; probability: number }[],
): { count: number; value: number; weighted: number } {
  const active = deals.filter(isActiveDeal);
  return {
    count: active.length,
    value: Math.round(active.reduce((s, d) => s + (d.value ?? 0), 0)),
    weighted: Math.round(active.reduce((s, d) => s + (d.value ?? 0) * (d.probability / 100), 0)),
  };
}
