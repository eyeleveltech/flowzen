/**
 * Every screen that shows a task hears about a change to one.
 *
 * A task appears on My Work, All tasks, the Team screen and a person's drawer,
 * Live work's counts, an internal project and the approval queue — each its
 * own cached list. A change was refreshed only on the screen it was made on,
 * so editing a task on All tasks and opening My Work within the 30-second
 * cache window showed the old title, date or status.
 *
 * The API client calls `announceTaskWrite` after any successful write to
 * `/tasks…` (edit, status, hold, delete, approval, a new task), and
 * `GlobalEvents` marks every list below out of date: the one on screen
 * refetches at once, the rest the next time they are opened. Done here rather
 * than in each caller, so a new screen or a new action cannot forget it.
 */

/** Every cached list a task shows up in. A prefix covers its variants. */
export const TASK_VIEW_KEYS: readonly (readonly string[])[] = [
  ['tasks'], // My Work, the approval queue
  ['all-work'],
  ['team'], // capacity, the approvals report
  ['live-work'],
  ['internal-projects'],
  ['internal-project'],
  ['task-reviews'],
  ['calendar'],
];

const listeners = new Set<() => void>();

/** Run `fn` after every task write; returns the unsubscribe. */
export function onTaskWrite(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called by the API client — not meant for screens. */
export function announceTaskWrite(): void {
  for (const fn of listeners) fn();
}
