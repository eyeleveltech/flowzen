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

export async function changeTaskStatus(task: { id: string; status: string }, next: string): Promise<void> {
  if (next === task.status) return;
  if (next === 'ON_HOLD') {
    await api.tasks.wait(task.id, 'CLIENT');
  } else if (task.status === 'ON_HOLD') {
    // Resume closes the wait and lands on In progress; anything else goes on top.
    await api.tasks.resume(task.id);
    if (next !== 'IN_PROGRESS') await api.tasks.updateStatus(task.id, next);
  } else {
    await api.tasks.updateStatus(task.id, next);
  }
}
