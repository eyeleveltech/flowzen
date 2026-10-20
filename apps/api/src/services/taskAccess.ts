import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { hasPermission, type UserSession } from '../middleware/auth.js';
import { approverFor, escalateFor } from './taskApprovals.js';
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
 * every task's history — approvers' feedback on other people's work included —
 * to everyone signed in.
 *
 * The rule, in one place:
 *   - **Change** a task: the people on it, whoever created or assigned it, a
 *     Head whose departments it touches, and Management.
 *   - **Read its history**: all of those, plus the approvers (and escalation
 *     contacts) for its type — they review it, so they see its rounds.
 *   - Anybody else is answered "not found", so a task's existence is not
 *     confirmed to somebody who cannot reach it.
 *
 * Approving and requesting changes keep their own checks (the approver lists);
 * an approver is not thereby allowed to edit, close or delete the task.
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

/** The task types this person approves or is the escalation contact for. */
async function reviewsTypes(user: AccessUser) {
  const [approves, escalates] = await Promise.all([
    approverFor(user.organizationId, user.userId),
    escalateFor(user.organizationId, user.userId),
  ]);
  return Array.from(new Set([...approves, ...escalates]));
}

/**
 * Narrows a task query to the tasks whose history this person may read: the
 * ones they may change, and the ones of a type they review.
 */
export async function taskReadableWhere(user: AccessUser, where: Prisma.TaskWhereInput): Promise<Prisma.TaskWhereInput> {
  const types = await reviewsTypes(user);
  const reviewed: Prisma.TaskWhereInput[] = types.length ? [{ taskType: { in: types } }] : [];
  if (hasPermission(user as UserSession, 'work.team')) {
    const scope = await teamScope(user);
    if (scope.all) return where;
    const scoped = await taskInScope(user, where);
    return reviewed.length ? { OR: [scoped, { AND: [where, ...reviewed] }] } : scoped;
  }
  return { AND: [where, { OR: [...theirs(user.userId), ...reviewed] }] };
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
