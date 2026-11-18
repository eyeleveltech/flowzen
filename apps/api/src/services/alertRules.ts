/**
 * Alert rules raised by a worker other than the hourly health scanner.
 *
 * The scanner resolves every open alert it did not raise on its last pass, so
 * an alert owned by anybody else would be closed within the hour. This is the
 * one list of those rules; the scanner skips them, and the bell works out
 * their audience from people rather than a permission.
 */

/** Calendar events: the morning-of reminder, and "you were booked / it moved". */
export const EVENT_RULES = ['EVENT_TODAY', 'EVENT_UPDATE'];

/**
 * A proposal handed to Management to price and finalise (AI Proposal Builder,
 * phase 2). Raised by "Send for review", resolved by Finalise or "Send back".
 */
export const REVIEW_RULE = 'PROPOSAL_REVIEW_REQUESTED';

/**
 * An API key made or revoked (API Plan 1): told to every setup.admin. Raised
 * by Settings → API, and closed after two weeks by the API clean-up.
 */
export const API_KEY_RULE = 'API_KEY_CHANGED';

/**
 * Logins (Credentials plan): somebody opened an unusual number of logins, or
 * left Management having opened some. Raised by the reveal route and the
 * team screen; closed by the daily logins purge after a month.
 */
export const CREDENTIAL_RULES = ['CREDENTIAL_UNUSUAL_ACTIVITY', 'CREDENTIAL_ACCESS_LOST'];

/**
 * "Something confusing? Tell us" (Ease Plan 3). FEEDBACK_NEW is Management's
 * one "3 new feedback notes" alert per organisation, kept in step by the
 * feedback routes; FEEDBACK_LOOKED_AT is the sender's "your note was looked
 * at" bell, closed after two weeks by the daily usage clean-up.
 */
export const FEEDBACK_NEW_RULE = 'FEEDBACK_NEW';
export const FEEDBACK_REPLY_RULE = 'FEEDBACK_LOOKED_AT';

/**
 * "Usage review for October is ready": Management's, early each month, raised
 * by the daily usage clean-up and closed when the Screens view is opened or
 * the next month's arrives.
 */
export const USAGE_REVIEW_RULE = 'USAGE_REVIEW';

export const EXTERNAL_RULES = [
  ...EVENT_RULES,
  REVIEW_RULE,
  API_KEY_RULE,
  ...CREDENTIAL_RULES,
  FEEDBACK_NEW_RULE,
  FEEDBACK_REPLY_RULE,
  USAGE_REVIEW_RULE,
];
