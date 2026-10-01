/**
 * Writing a new task, and its "created" line in the activity log.
 *
 * The one place a task row is created — by a person (POST /tasks, after the
 * route has checked who may assign whom and where the task may sit) and by the
 * repeat job (each copy of a repeating task). Sharing it is what keeps a copy
 * the same as a task somebody typed: the same people rows, the same approval
 * filing, the same log line.
 */

import { Priority, TaskStatus, type TaskType, type TaskWorkType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { approvalType } from './taskApprovals.js';
import { TASK_PEOPLE } from './taskPeople.js';

/** The client or a transaction inside it — whichever the caller is writing through. */
type Db = Pick<typeof prisma, 'task' | 'activity'>;

export type NewTask = {
  orgId: string;
  /** Who typed it. For a copy, whoever created the copy it was made from. */
  createdById: string;
  /** Who the log line names — null for the repeat job, which is nobody. */
  actorId: string | null;
  title: string;
  workType: TaskWorkType;
  workId?: string | null;
  monthCardId?: string | null;
  projectId?: string | null;
  retainerProjectId?: string | null;
  internalProjectId?: string | null;
  companyId?: string | null;
  /** Everybody on it, the lead first. Already checked by the caller. */
  people: string[];
  assignedById?: string | null;
  reviewerId?: string | null;
  taskType?: TaskType | null;
  needsApproval?: boolean;
  dueDate: Date;
  dueTime?: string | null;
  priority?: Priority;
  notes?: string | null;
  /** The repeat this task is a copy in. */
  repeatId?: string | null;
  /** `task_created` for a person, `task_repeated` for the job. */
  verb?: 'task_created' | 'task_repeated';
};

export async function createTaskRecord(db: Db, t: NewTask) {
  const task = await db.task.create({
    data: {
      organizationId: t.orgId,
      title: t.title.trim(),
      workType: t.workType,
      workId: t.workId || null,
      monthCardId: t.monthCardId || null,
      projectId: t.projectId || (t.workType === 'PROJECT' ? t.workId : null) || null,
      retainerProjectId: t.retainerProjectId || null,
      internalProjectId: t.internalProjectId || null,
      companyId: t.companyId || null,
      assigneeId: t.people[0],
      createdById: t.createdById,
      // Nobody, unless somebody was named — see POST /tasks.
      assignedById: t.assignedById || null,
      reviewerId: t.reviewerId || null,
      // Needing approval with no type is filed as Other (taskApprovals).
      taskType: t.needsApproval ? approvalType(t.taskType) : (t.taskType ?? null),
      needsApproval: t.needsApproval ?? false,
      dueDate: t.dueDate,
      dueTime: t.dueTime ?? null,
      assignedAt: new Date(),
      status: TaskStatus.TODO,
      priority: t.priority ?? Priority.MEDIUM,
      notes: t.notes || null,
      repeatId: t.repeatId ?? null,
      assignees: { create: t.people.map((userId) => ({ userId })) },
    },
    include: TASK_PEOPLE,
  });

  await db.activity.create({
    data: {
      organizationId: t.orgId,
      entityType: 'Task',
      entityId: task.id,
      actorId: t.actorId,
      verb: t.verb ?? 'task_created',
      payload: {
        title: task.title,
        workType: task.workType,
        assigneeIds: t.people,
        ...(task.needsApproval ? { needsApproval: true } : {}),
        ...(t.verb === 'task_repeated' ? { dueDate: task.dueDate.toISOString().slice(0, 10) } : {}),
      },
    },
  });

  return task;
}
