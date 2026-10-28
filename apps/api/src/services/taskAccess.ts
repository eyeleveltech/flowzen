import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { hasPermission, type UserSession } from '../middleware/auth.js';
import { taskInScope, teamScope } from './teamScope.js';

/**
 * Who may change a task, and who may read its history (security fixes plan,
 * H1 and H2, from the 2–3 Oct security check).
 *
 * `taskInScope` narrows a query for a department Head and leaves it alone for
 * everybody else — right for lists, where `work.own` routes already show a
 * person only their own work. But every task route that CHANGES a task loaded
 * it with `taskInScope` too, so for an Employee, BD or Accounts the only check
 * was "same organisation": anybody could rename, re-date, close, hold, take
 * over and then delete anybody's task, by id. And the activity feed returned
 * every task's history to everyone signed in.
 *
 * The rule, in one place:
 *   - **Change** a task: the people on it, whoever created or assigned it, a
 *     Head whose departments it touches, and Management.
 *   - **Read its history**: the same people.
 *   - Anybody else is answered "not found", so a task's existence is not
 *     confirmed to somebody who cannot reach it.
 */

type AccessUser = Pick<UserSession, 'userId' | 'organizationId' | 'preset' | 'permissions' | 'active'>;

/** A task this person is on, created, or assigned. */
const theirs = (userId: string): Prisma.TaskWhereInput[] => [
  { assignees: { some: { userId } } },
  { createdById: userId },
  { assignedById: userId },
];

/**
 * Narrows a task query to the tasks this person may change. Heads and
 * Management keep their team scope; everybody else gets their own tasks.
 */
export async function taskChangeableWhere(user: AccessUser, where: Prisma.TaskWhereInput): Promise<Prisma.TaskWhereInput> {
  if (hasPermission(user as UserSession, 'work.team')) return taskInScope(user, where);
  return { AND: [where, { OR: theirs(user.userId) }] };
}

/**
 * Narrows a task query to the tasks whose history this person may read — the
 * ones they may change.
 */
export async function taskReadableWhere(user: AccessUser, where: Prisma.TaskWhereInput): Promise<Prisma.TaskWhereInput> {
  if (hasPermission(user as UserSession, 'work.team')) {
    const scope = await teamScope(user);
    if (scope.all) return where;
    return taskInScope(user, where);
  }
  return { AND: [where, { OR: theirs(user.userId) }] };
}

/** Whether one task's history is readable by this person. */
export async function canReadTask(user: AccessUser, taskId: string): Promise<boolean> {
  const where = await taskReadableWhere(user, { id: taskId, organizationId: user.organizationId });
  return (await prisma.task.count({ where })) > 0;
}

/**
 * The ids of every task whose history this person may read, for the general
 * feed — or null when nothing narrows it (Management, and a Head who leads no
 * department yet, which is the rollout rule in teamScope).
 */
export async function readableTaskIds(user: AccessUser): Promise<string[] | null> {
  if (hasPermission(user as UserSession, 'work.team') && (await teamScope(user)).all) return null;
  const where = await taskReadableWhere(user, { organizationId: user.organizationId });
  const rows = await prisma.task.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id);
}
