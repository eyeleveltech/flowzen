import { ProposalStage } from '@prisma/client';

/**
 * How likely a deal at each stage is to land — one source, read from the org.
 *
 * ─── Why this file exists ───────────────────────────────────────────────────
 *
 * There were three copies of this table and no two agreed:
 *
 *   routes/proposals.ts    20 / 40 / 60 / 80 / 95
 *   routes/forecast.ts     10 / 30 / 60 / 80 / 90
 *   web pipeline board     20 / 40 / 60 / 80 / 95
 *
 * §8 computes weighted pipeline as `value × probability`, so the Pipeline board
 * and the Forecast were reporting different weighted figures for the same deal
 * — not a rounding difference, a different answer. And all three disagreed with
 * §14, which sets the defaults at 30 / 60 / 85 / 90 and says they are
 * "configurable in Setup" rather than compiled in.
 *
 * So the numbers live on the organisation row, and everything that weights a
 * proposal reads them through here: the board, the forecast, and the web, which
 * gets them over /config rather than keeping a fourth copy.
 *
 * ─── The stages the brief does not price ────────────────────────────────────
 *
 * WON and LOST/EXPIRED are not predictions at all: a won deal is money and a
 * lost one is nothing, so they are fixed, not configurable.
 *
 * There was a fifth setting here, for a TALKING stage in front of Proposal
 * sent. §14 never priced it — "a proposal only reaches the board at Proposal
 * sent" — and the stage itself is gone, because the only thing that ever
 * reached it was an empty proposal that adding a company created by itself.
 *
 * PROSPECT now sits in that position and is priced at zero for the same
 * reason: a promoted lead has no quote behind it. The difference from TALKING
 * is that nothing creates one automatically, and it can be deleted.
 */

/** The columns this reads. Anything with them will do — a full org row, or a select. */
export interface StageProbabilitySource {
  stageProbProposalSent: number;
  stageProbInNegotiation: number;
  stageProbProformaIssued: number;
  stageProbVerbalYes: number;
}

/** The org columns every weighting read needs, for a Prisma `select`. */
export const STAGE_PROBABILITY_SELECT = {
  stageProbProposalSent: true,
  stageProbInNegotiation: true,
  stageProbProformaIssued: true,
  stageProbVerbalYes: true,
} as const;

/** §14's own defaults, for a caller that has no org row to hand. */
export const BRIEF_STAGE_PROBABILITIES: StageProbabilitySource = {
  stageProbProposalSent: 30,
  stageProbInNegotiation: 60,
  stageProbProformaIssued: 85,
  stageProbVerbalYes: 90,
};

/** Every stage priced, as whole percentages. */
export function stageProbabilities(org: StageProbabilitySource | null | undefined): Record<ProposalStage, number> {
  const o = org ?? BRIEF_STAGE_PROBABILITIES;
  return {
    /*
     * Not a prediction, and not configurable.
     *
     * A promoted lead has no quote, so there is no value to weight — zero is
     * the honest figure rather than a probability applied to nothing. §14 has
     * never priced anything before Proposal sent, and the last stage that sat
     * there and was priced is the one that had to be removed.
     */
    [ProposalStage.PROSPECT]: 0,
    [ProposalStage.PROPOSAL_SENT]: o.stageProbProposalSent,
    [ProposalStage.IN_NEGOTIATION]: o.stageProbInNegotiation,
    [ProposalStage.PROFORMA_ISSUED]: o.stageProbProformaIssued,
    [ProposalStage.VERBAL_YES]: o.stageProbVerbalYes,
    // Not predictions. Won money is money; a lost deal is worth nothing.
    [ProposalStage.WON]: 100,
    [ProposalStage.LOST]: 0,
    [ProposalStage.EXPIRED]: 0,
  };
}

/**
 * What one proposal is weighted at, as a percentage.
 *
 * An explicit override always wins — that is the whole point of §8's
 * `probabilityOverride ?? stageDefault`, and of the board's "override win
 * probability for this deal".
 */
export function proposalProbability(
  proposal: { stage: ProposalStage; probabilityOverride?: number | null },
  org: StageProbabilitySource | null | undefined,
): number {
  if (proposal.probabilityOverride !== null && proposal.probabilityOverride !== undefined) {
    return proposal.probabilityOverride;
  }
  return stageProbabilities(org)[proposal.stage] ?? 0;
}
