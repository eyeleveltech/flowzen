/**
 * What things are called on screen.
 *
 * ─── Why this file exists ───────────────────────────────────────────────────
 *
 * A card on the pipeline board is a `deals` row in the database, and it always
 * will be: it is the thing that can be won exactly once, which is what makes win
 * rate, cycle time and stage conversion countable at all.
 *
 * But nobody at the agency says "deal", and the word had leaked into buttons,
 * menus, notifications and empty states. So the DATA keeps the name and the
 * INTERFACE does not, and the interface's name lives here — in one constant —
 * because the alternative is a find-and-replace across the whole front end the
 * first time somebody prefers a different word.
 *
 * To change it: edit `ENQUIRY` below. Nothing else.
 */

export const ENQUIRY = {
  /** "an enquiry" */
  one: 'enquiry',
  /** "three enquiries" */
  many: 'enquiries',
  /** Start of a sentence, or a heading. */
  One: 'Enquiry',
  Many: 'Enquiries',
  /**
   * With its article: "Choose an enquiry", "Raise a job".
   *
   * Spelled out rather than derived from the first letter, because the rule is
   * about SOUND — "a one-off", "an hour" — and a call site working it out is a
   * call site that gets it wrong the first time the word changes.
   */
  anOne: 'an enquiry',
} as const;

/** `2 enquiries`, `1 enquiry`. */
export const countEnquiries = (n: number) => `${n} ${n === 1 ? ENQUIRY.one : ENQUIRY.many}`;

/**
 * What to call one card.
 *
 * A card with no title is the CORRECT state for a lead you were handed on
 * Tuesday — you do not know what you are selling them yet, and the database has
 * always allowed `title` to be null. Six different screens each invented their
 * own fallback for that, and every one of them chose **"Untitled deal"**: a
 * phrase that reads as an error, in the one situation where nothing is wrong.
 *
 * The honest fallback is the company's name. That is what the conversation is
 * actually called until somebody knows what the work is.
 *
 * Pass the company name wherever it is known. Where it is NOT — a list on the
 * client's own page, where repeating their name on every row says nothing — use
 * `untitledHint` instead.
 */
export const enquiryName = (
  enquiry: { title?: string | null },
  companyName?: string | null,
): string => enquiry.title?.trim() || companyName?.trim() || ENQUIRY.One;

/**
 * For the two places where the company name is already on the screen.
 *
 * Render this in muted type, not as the title. It is a note that something is
 * not known yet, not a name.
 */
export const untitledHint = 'No title yet';
