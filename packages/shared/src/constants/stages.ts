/**
 * How each pipeline stage reads on screen.
 *
 * ─── Why this is here and not in three places ───────────────────────────────
 *
 * It was in three. The pipeline board and the quotations list each had their
 * own copy in sentence case ("Proposal sent"), the API's search results had a
 * third in title case ("Proposal Sent"), and that copy's comment claimed it
 * "mirrors the list config sends" — which it had stopped doing. So the same
 * deal read two different ways depending on whether you found it on the board
 * or through search.
 *
 * Three hand-kept copies of a seven-item list is three chances to drift, and it
 * had already taken two of them.
 *
 * ─── The names themselves ───────────────────────────────────────────────────
 *
 * Title case throughout, which is what the stage the studio renamed uses.
 *
 * "Proforma Issued / Contract Sent" says both things that happen at that point:
 * some clients get a proforma, some get a contract, and the stage is the same
 * either way. Naming only the proforma made the stage look inapplicable to
 * half the deals that pass through it.
 *
 * These are LABELS. The stored values are the `ProposalStage` enum and nothing
 * here changes them, so renaming a stage stays a one-line edit rather than a
 * migration.
 */
export const STAGE_LABEL: Record<string, string> = {
  PROSPECT: 'Prospect',
  PROPOSAL_SENT: 'Proposal Sent',
  IN_NEGOTIATION: 'In Negotiation',
  PROFORMA_ISSUED: 'Proforma Issued / Contract Sent',
  VERBAL_YES: 'Verbal Yes',
  WON: 'Won',
  LOST: 'Lost',
  EXPIRED: 'Expired',
};

/**
 * The stages a live deal moves through, in order. Won closes it; Lost and
 * Expired leave the board.
 *
 * Typed as plain strings rather than a literal tuple: the board asks it
 * `indexOf(someStage)` to decide whether a drag moves forwards, and a tuple of
 * literals refuses a string argument.
 */
export const STAGE_ORDER: readonly string[] = [
  'PROSPECT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'PROFORMA_ISSUED',
  'VERBAL_YES',
  'WON',
];

/** Falls back to the raw value, so a stage added later shows rather than vanishing. */
export const stageLabel = (stage?: string | null): string =>
  !stage ? '—' : (STAGE_LABEL[stage] ?? stage.replace(/_/g, ' '));
