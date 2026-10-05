import { TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * "Is this task already on the board?"
 *
 * Asked before Zen drafts a task, and again when a Zen draft is created, so
 * the same task does not go up twice: asked for in one chat and then again in
 * another, a card pressed twice, a list pasted a second time.
 *
 * The same task means the same title (case and surrounding spaces aside) with
 * one of the same people on it, still open — a done or cancelled task is
 * history, and asking for it again is asking for new work.
 */

const OPEN: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.ON_HOLD];

export type TaskTwin = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  dueDate: string;
  status: TaskStatus;
  /** Everybody on it, by name. */
  people: string[];
};

export async function findOpenTwin(
  organizationId: string,
  task: {
    title: string;
    assigneeIds: string[];
    /** Given: only a task due that same day counts — the stricter check made at Create. */
    dueDate?: string;
  },
): Promise<TaskTwin | null> {
  const title = task.title.trim();
  const people = task.assigneeIds.filter(Boolean);
  if (!title || people.length === 0) return null;
  const day = task.dueDate?.slice(0, 10);

  const hit = await prisma.task.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: OPEN },
      title: { equals: title, mode: 'insensitive' },
      assignees: { some: { userId: { in: people } } },
      ...(day ? { dueDate: new Date(`${day}T00:00:00Z`) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      dueDate: true,
      status: true,
      assignees: { select: { user: { select: { name: true } } } },
    },
  });
  if (!hit) return null;
  return {
    id: hit.id,
    title: hit.title,
    dueDate: hit.dueDate.toISOString().slice(0, 10),
    status: hit.status,
    people: hit.assignees.map((a) => a.user.name),
  };
}

/** "Mon 6 Oct", for a YYYY-MM-DD. */
export const twinDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** How a status reads in a sentence. */
export const twinStatus = (s: TaskStatus) =>
  ({ TODO: 'to do', IN_PROGRESS: 'in progress', IN_REVIEW: 'waiting for approval', ON_HOLD: 'on hold' })[s as string] ?? s.toLowerCase();
