/**
 * Alert rules raised by a worker other than the hourly health scanner.
 *
 * The scanner resolves every open alert it did not raise on its last pass, so
 * an alert owned by anybody else would be closed within the hour. This is the
 * one list of those rules; the scanner skips them, and the bell works out
 * their audience from people rather than a permission.
 */

/** The approval chaser's reminders and escalations. */
export const CHASER_RULES = ['APPROVAL_REMINDER', 'APPROVAL_ESCALATED'];

/** Calendar events: the morning-of reminder, and "you were booked / it moved". */
export const EVENT_RULES = ['EVENT_TODAY', 'EVENT_UPDATE'];

export const EXTERNAL_RULES = [...CHASER_RULES, ...EVENT_RULES];
