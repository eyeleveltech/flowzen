import { TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * "Working on now" (Team plan 1).
 *
 * One task per person, set by that person and nobody else, on one of their own
 * open tasks. It is what they SAY they are on — nothing here watches anybody:
 * no time is kept with it, nothing is logged about it, and it is not ranked.
 *
 * It ends itself when the task stops being something to work on — finished,
 * cancelled, put on hold, deleted — or when the person is
 * taken off it. The routes that do those things call `clearFocusOn` /
 * `clearFocusOff`; every read also checks `isLiveFocus`, so a path that forgets
 * (a status changed some other way) shows nothing rather than a stale "Now".
 */

/** The statuses a task can be somebody's "now" in. */
export const FOCUS_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS];

/** The statuses that end it. */
export const ENDS_FOCUS: TaskStatus[] = [TaskStatus.DONE, TaskStatus.CANCELLED, TaskStatus.ON_HOLD];

/** Whoever is on this task now isn't any more — it has moved out of reach. */
export function clearFocusOn(taskId: string) {
  return prisma.user.updateMany({ where: { focusTaskId: taskId }, data: { focusTaskId: null } });
}

/** Everybody taken off a task stops being on it now; whoever is still on it keeps theirs. */
export function clearFocusOff(taskId: string, stillOn: string[]) {
  return prisma.user.updateMany({
    where: { focusTaskId: taskId, id: { notIn: stillOn } },
    data: { focusTaskId: null },
  });
}

/** Whether a task can still be this person's "now": open, not deleted, and theirs. */
export function isLiveFocus(
  task: { status: TaskStatus | string; deletedAt?: Date | null; assignees: { userId: string }[] } | null | undefined,
  userId: string,
): boolean {
  return (
    Boolean(task) &&
    !task!.deletedAt &&
    FOCUS_STATUSES.includes(task!.status as TaskStatus) &&
    task!.assignees.some((a) => a.userId === userId)
  );
}

/** Why a task can't be made somebody's "now", or null when it can. */
export function focusRefusal(task: { status: TaskStatus | string }): string | null {
  switch (task.status) {
    case TaskStatus.DONE:
      return 'This task is already done.';
    case TaskStatus.CANCELLED:
      return 'This task was cancelled.';
    case TaskStatus.ON_HOLD:
      return 'This task is on hold. Take it off hold first.';
    default:
      return null;
  }
}
