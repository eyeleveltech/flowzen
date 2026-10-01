/**
 * What every task payload carries about its people (and its last approval
 * round, and its repeat) — one include, shared by the task routes, the
 * retainer and internal-project screens, and the repeat job, so a copy the job
 * makes comes back in the same shape as one a person made.
 */

import { LAST_REVIEW } from './taskApprovals.js';

/**
 * The people on a task, in one shape wherever a task is read.
 *
 * `assignee` is the lead and `assignees` is everybody, the lead included, so a
 * caller can render "Janani +2" without joining two lists itself.
 *
 * `assignedBy` and `creator` are two different people asked two different
 * questions: who wanted this done, and who typed it in. They are usually the
 * same, which is why one column pretended to be both for so long — but a
 * manager writing up what a Head asked for in a meeting is exactly the case
 * the product exists to record, and it was the one it got wrong.
 */
export const TASK_PEOPLE = {
  assignee: { select: { id: true, name: true, designation: true, dept: true } },
  assignedBy: { select: { id: true, name: true, designation: true } },
  creator: { select: { id: true, name: true, designation: true } },
  reviewer: { select: { id: true, name: true, designation: true } },
  assignees: {
    orderBy: { assignedAt: 'asc' as const },
    select: { user: { select: { id: true, name: true, designation: true, dept: true } } },
  },
  /*
   * The last round of approval, when a task has had one.
   *
   * Carried with the people because every list that shows a task needs it the
   * same way: "Changes requested" and the feedback, or how long it has been
   * waiting on an approver. `withPeople` turns it into `lastReview`.
   */
  reviews: LAST_REVIEW,
  /*
   * The repeat, when the task is a copy in one: the rule and whether it has
   * stopped. Every list carries it for the small repeat mark; the screens that
   * open a task also get `nextDue` (see `withRepeatNext`).
   */
  repeat: {
    select: { id: true, frequency: true, weekday: true, dayOfMonth: true, stoppedAt: true, stoppedReason: true },
  },
} as const;
