/**
 * Why a deal was lost.
 *
 * `lostReason` has always been stored, and has always been free text — a box
 * somebody typed into at the moment they were giving up on a deal, which is
 * exactly when nobody writes carefully. So the column holds "budget", "Budget
 * issue", "no budget this year" and "went quiet", which are four spellings of
 * two reasons and cannot be counted.
 *
 * A fixed list makes the question answerable: how many did we lose on price,
 * how many to another agency, how many simply went quiet. That is the whole
 * point of recording it.
 *
 * `Other` stays, because a list that cannot express the real reason gets the
 * nearest wrong one picked instead — and a wrong category is worse than an
 * uncategorised note. Choosing it asks for the reason in words, and that text
 * is what gets stored.
 *
 * Stored as the words themselves, like industries and lead sources: the value
 * IS the label, so there is no second table to keep in step.
 */
export const LOST_REASONS = [
  'Budget Issue',
  'Price Too High',
  'Chose Another Agency',
  'No Response',
  'Project Put on Hold',
  'Project Cancelled',
  'Timing Issue',
  'Scope Mismatch',
  'Internal Team Handling It',
  'Decision Delayed',
  'Not a Good Fit',
  'Other',
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

/** The one that asks for words instead. */
export const LOST_REASON_OTHER: LostReason = 'Other';

/**
 * Whether a stored reason is one of the countable ones.
 *
 * Anything else is either a free-text "Other" or a reason typed before this
 * list existed. Reporting groups those together rather than pretending they
 * are categories of one.
 */
export const isCountableLostReason = (v: unknown): v is LostReason =>
  typeof v === 'string' && (LOST_REASONS as readonly string[]).includes(v) && v !== LOST_REASON_OTHER;
