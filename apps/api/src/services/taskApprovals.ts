/**
 * Task approvals — the rules every route shares.
 *
 * A task can need an approver's sign-off before it is done. Whoever creates it
 * ticks "Needs approval"; the approvers are set per task type in Settings →
 * Approvals, and any ONE of them is enough. The task then reaches DONE only
 * through Approve, never through the status menu.
 *
 * What lives here is what more than one route has to agree on: who approves a
 * type, what a person can approve, and when the tick is allowed at all.
 */

import { TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/** The same names the web's task-type picker shows. */
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  DESIGN: 'Design',
  VIDEO: 'Video',
  DIGITAL_MARKETING: 'Digital Marketing',
  DEVELOPMENT: 'Development',
  BUSINESS_DEVELOPMENT: 'Business Development',
  ACCOUNTS: 'Accounts',
  MANAGEMENT: 'Management',
  OTHER: 'Other',
};

/**
 * The type a task needing approval is filed under.
 *
 * Approval used to demand a type first ("Pick a task type first"). The same
 * approvers now cover all work, so the type is no longer the question —
 * a task ticked for approval with no type is filed as Other and goes to the
 * same people.
 */
export const approvalType = (taskType: TaskType | null | undefined): TaskType => taskType ?? TaskType.OTHER;

/**
 * Who can approve this type of task — active people only.
 *
 * Somebody who has left is still in the list until an admin tidies it, and an
 * approval from them would be an approval from nobody.
 */
export async function approverIds(orgId: string, taskType: TaskType | null | undefined): Promise<string[]> {
  if (!taskType) return [];
  const rows = await prisma.taskApprover.findMany({
    where: { organizationId: orgId, taskType, user: { active: true } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** The task types this person approves. Empty for almost everybody. */
export async function approverFor(orgId: string, userId: string): Promise<TaskType[]> {
  const rows = await prisma.taskApprover.findMany({
    where: { organizationId: orgId, userId },
    select: { taskType: true },
  });
  return rows.map((r) => r.taskType);
}

/** Who a stuck approval of this type escalates to — active people only. */
export async function escalationIds(orgId: string, taskType: TaskType | null | undefined): Promise<string[]> {
  if (!taskType) return [];
  const rows = await prisma.approvalEscalationContact.findMany({
    where: { organizationId: orgId, taskType, user: { active: true } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** The task types whose stuck approvals escalate to this person. */
export async function escalateFor(orgId: string, userId: string): Promise<TaskType[]> {
  const rows = await prisma.approvalEscalationContact.findMany({
    where: { organizationId: orgId, userId },
    select: { taskType: true },
  });
  return rows.map((r) => r.taskType);
}

/**
 * The escalation people for each type, by name — what "Escalated to Akmal"
 * on the editor's side reads.
 */
export async function escalationNamesByType(
  orgId: string,
  types: (TaskType | null)[],
): Promise<Map<TaskType, { id: string; name: string }[]>> {
  const wanted = [...new Set(types.filter((t): t is TaskType => Boolean(t)))];
  const map = new Map<TaskType, { id: string; name: string }[]>();
  if (wanted.length === 0) return map;
  const rows = await prisma.approvalEscalationContact.findMany({
    where: { organizationId: orgId, taskType: { in: wanted }, user: { active: true } },
    select: { taskType: true, user: { select: { id: true, name: true } } },
  });
  for (const r of rows) map.set(r.taskType, [...(map.get(r.taskType) ?? []), r.user]);
  return map;
}

/** 120 → "2h", 90 → "1h 30m", 15 → "15m" — the org's own timings, in words. */
export function minutesLabel(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Whether "Needs approval" can be ticked for this type.
 *
 * It needs a type, and the type needs somebody to approve it — a task waiting
 * on a list of nobody would wait for ever. Null when it is fine.
 */
export async function approvalFlagRefusal(
  orgId: string,
  taskType: TaskType | null | undefined,
  needsApproval: boolean,
): Promise<string | null> {
  if (!needsApproval) return null;
  const type = approvalType(taskType);
  const pool = await approverIds(orgId, type);
  if (pool.length === 0) {
    return 'Nobody is set to approve work yet. Set the approvers in Settings → Approvals.';
  }
  return null;
}

/**
 * Whether this person may approve (or send back) this task, and if not why not.
 *
 * In the pool for the task's type, and not on the task: nobody signs off their
 * own work. When the refusal is self-approval and nobody else is in the pool,
 * it says so — the fix is another approver, not trying again.
 */
export async function approveRefusal(
  orgId: string,
  userId: string,
  task: { taskType: TaskType | null; assigneeIds: string[] },
  /** The round being decided — once it has escalated, the escalation people can decide it too. */
  round?: { escalatedAt: Date | null } | null,
): Promise<string | null> {
  if (!task.taskType) return 'This task has no type, so nobody is set to approve it.';
  const pool = await approverIds(orgId, task.taskType);
  const label = TASK_TYPE_LABEL[task.taskType];
  if (!pool.includes(userId)) {
    const escalation = await escalationIds(orgId, task.taskType);
    if (!escalation.includes(userId)) {
      return `Only the ${label} approvers can approve this. Ask one of them, or an admin in Settings → Approvals.`;
    }
    // An escalation person decides only once it has actually escalated.
    if (!round?.escalatedAt) {
      return `You can decide this once it escalates — until then it is with the ${label} approvers.`;
    }
  }
  if (task.assigneeIds.includes(userId)) {
    const others = pool.filter((id) => !task.assigneeIds.includes(id));
    return others.length > 0
      ? "You're on this task, so you can't approve it. Another approver has to."
      : `You're on this task, so you can't approve it — and nobody else is set to approve ${label}. Add another approver in Settings → Approvals.`;
  }
  return null;
}

/**
 * The last round of review, for task lists: enough to show "Changes requested"
 * and the feedback, or how long a task has been waiting.
 */
export const LAST_REVIEW = {
  orderBy: { round: 'desc' as const },
  take: 1,
  select: {
    round: true,
    decision: true,
    feedback: true,
    decidedAt: true,
    submittedAt: true,
    remindedAt: true,
    escalatedAt: true,
    decidedBy: { select: { id: true, name: true } },
    // The other approvers' changes, when it was sent back.
    notes: {
      orderBy: { createdAt: 'asc' as const },
      select: { feedback: true, createdAt: true, author: { select: { id: true, name: true } } },
    },
  },
};

export type LastReview = {
  round: number;
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | null;
  feedback: string | null;
  decidedAt: Date | null;
  submittedAt: Date;
  /** The approvers were reminded — past the org's reminder time with no answer. */
  remindedAt: Date | null;
  /** It escalated to the type's escalation people. */
  escalatedAt: Date | null;
  /** Who decided it. */
  decidedBy: { id: string; name: string } | null;
  /** Changes other approvers added after it was sent back. */
  notes: { feedback: string; createdAt: Date; author: { id: string; name: string } }[];
};

/**
 * Whether this person may add their changes to a round somebody sent back,
 * and if not why not. Null when they may.
 *
 * Any approver for the type, or its escalation people; never somebody on the
 * task. Only while the task is back with the editor: once it is sent again the
 * new round is the one to answer, and once it is finished there is nothing to
 * change.
 */
export async function addChangesRefusal(
  orgId: string,
  userId: string,
  task: { taskType: TaskType | null; status: string; assigneeIds: string[] },
  latest: { decision: string | null } | null | undefined,
): Promise<string | null> {
  if (!latest || latest.decision !== 'CHANGES_REQUESTED') {
    return 'This task has not been sent back, so there are no changes to add to.';
  }
  if (task.status === 'IN_REVIEW') return "It has been sent again — answer the new version instead.";
  if (task.status === 'DONE' || task.status === 'CANCELLED') return 'This task is finished.';
  const type = approvalType(task.taskType);
  const [pool, escalation] = await Promise.all([approverIds(orgId, type), escalationIds(orgId, type)]);
  if (!pool.includes(userId) && !escalation.includes(userId)) {
    return `Only the ${TASK_TYPE_LABEL[type]} approvers can add changes to this.`;
  }
  if (task.assigneeIds.includes(userId)) return "You're on this task, so you can't send it back.";
  return null;
}

/**
 * Where a task's elapsed clock stops right now.
 *
 * Finished: when it finished. In review: when it was sent — the time an
 * approver takes is not the assignee's, and once the round is decided those
 * minutes are added to `waitingTotalMinutes` instead. Otherwise: now.
 */
export function elapsedEnd(
  task: { status: string; completedAt: Date | null },
  lastReview: Pick<LastReview, 'submittedAt' | 'decision'> | null | undefined,
  now: Date,
): Date {
  if (task.completedAt) return task.completedAt;
  if (task.status === 'IN_REVIEW' && lastReview && lastReview.decision == null) return lastReview.submittedAt;
  return now;
}
