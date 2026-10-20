/**
 * Changing a task's status, the one way every screen does it.
 *
 * On hold is not just a status: putting a task on hold records what it is
 * waiting on and from when (`/wait`), and taking it off closes that wait and
 * folds the minutes into `waitingTotalMinutes` (`/resume`) — so the elapsed
 * clock does not charge the assignee for time spent waiting on a client. The
 * plain status route does neither. My Work knew this; All tasks set ON_HOLD
 * through the status route, so its holds were never timed.
 */

import { api } from '@/lib/api-v2';
import { useWaitingOnStore } from '@/stores/waitingOn';

/**
 * Change it, asking "Waiting on…" first when it goes on hold (QA19 fixes plan,
 * F06). Every on-hold path posted CLIENT, hard-coded, so an internal task with
 * no client read "waiting on the client". "The client" is offered only when
 * the task has one — `hasClient`, from the server; a screen whose tasks always
 * have a client passes true.
 *
 * Resolves false when the question was cancelled and nothing changed.
 */
export async function changeTaskStatus(
  task: { id: string; status: string; title?: string; hasClient?: boolean },
  next: string,
): Promise<boolean> {
  if (next === task.status) return false;
  if (next === 'ON_HOLD') {
    const choice = await useWaitingOnStore.getState().ask({ hasClient: task.hasClient ?? true, title: task.title });
    if (choice === undefined) return false;
    await api.tasks.wait(task.id, choice);
  } else if (task.status === 'ON_HOLD') {
    // Resume closes the wait and lands on In progress; anything else goes on top.
    await api.tasks.resume(task.id);
    if (next !== 'IN_PROGRESS') await api.tasks.updateStatus(task.id, next);
  } else {
    await api.tasks.updateStatus(task.id, next);
  }
  return true;
}

/**
 * What an on-hold task shows: "On hold", or "On hold · waiting on the client /
 * someone else". The server already shows an old internal "client" hold as
 * plain On hold, so this only words what it is given.
 */
export const waitingWords = (waitingOn?: string | null): string | null =>
  waitingOn === 'CLIENT' ? 'waiting on the client' : waitingOn === 'ANOTHER_PERSON' ? 'waiting on someone else' : null;
