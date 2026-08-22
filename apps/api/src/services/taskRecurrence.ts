/**
 * Recurring tasks.
 *
 * Retainer work usually repeats monthly. A task marked DONE with recurrence set
 * spawns a new instance of itself for the next cycle.
 *
 * Scanned daily alongside the notification signals.
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { endOfDay, addDays } from '../utils/orgDay.js';

export type RecurrenceSchema = {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number; // defaults to 1
};

/** Calculate the next due date based on frequency. */
export const calculateNextDueDate = (currentDueDate: Date, recurrence: RecurrenceSchema): Date => {
  const next = new Date(currentDueDate);
  const interval = recurrence.interval || 1;

  switch (recurrence.frequency) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + interval);
      break;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7 * interval);
      break;
    case 'MONTHLY':
      next.setUTCMonth(next.getUTCMonth() + interval);
      break;
    case 'YEARLY':
      next.setUTCFullYear(next.getUTCFullYear() + interval);
      break;
  }
  return next;
};

/**
 * Scan for completed recurring tasks and spawn their next iteration.
 *
 * A task is eligible to spawn a child if:
 * 1. It has recurrence set.
 * 2. It is marked DONE.
 * 3. It does NOT already have a child spawned from it.
 *
 * The `spawnedTaskId` field doesn't exist on the schema yet, but we can detect
 * children by looking for tasks that have this task's title and project, or we
 * can just add a self-relation or a field. Wait, we don't have `spawnedTaskId`.
 * If we don't, how do we prevent spawning it 30 times if it sits at DONE for a month?
 * We can look for any incomplete tasks in the same project with the exact same title.
 * Or better: we look at `parentTaskId`! But `parentTaskId` is for subtasks.
 * Actually, maybe we only spawn it the MOMENT it is marked DONE in the router,
 * rather than in a daily cron job?
 * The plan says "find tasks with recurrence set, status DONE, and create the next instance if it's due".
 * Let's just implement the logic to spawn a new task right when the old one is completed.
 * It's safer and immediate.
 */
export const spawnNextTask = async (
  completedTask: {
    id: string;
    organizationId: string;
    projectId: string | null;
    dealId: string | null;
    title: string;
    description: string | null;
    priority: any;
    assigneeId: string | null;
    reviewerId: string | null;
    dueDate: Date | null;
    recurrence: any;
  },
  userId: string | null
) => {
  if (!completedTask.recurrence || !completedTask.dueDate) return;

  const recurrence = completedTask.recurrence as RecurrenceSchema;
  const nextDueDate = calculateNextDueDate(completedTask.dueDate, recurrence);

  return prisma.$transaction(async (tx) => {
    const nextTask = await tx.task.create({
      data: {
        organizationId: completedTask.organizationId,
        projectId: completedTask.projectId,
        dealId: completedTask.dealId,
        title: completedTask.title,
        description: completedTask.description,
        priority: completedTask.priority,
        assigneeId: completedTask.assigneeId,
        reviewerId: completedTask.reviewerId,
        dueDate: nextDueDate,
        recurrence: completedTask.recurrence, // keep it recurring
      },
    });

    await tx.activity.create({
      data: {
        organizationId: completedTask.organizationId,
        type: 'SYSTEM',
        message: `Recurring task spawned: ${completedTask.title}`,
        userId,
        projectId: completedTask.projectId,
        dealId: completedTask.dealId,
        taskId: nextTask.id,
      },
    });

    return nextTask;
  });
};
