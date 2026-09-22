import { prisma } from '../lib/prisma.js';
import { loadWorkCalendar, workingMinutesOn } from './workCalendar.js';

/**
 * Brief §8: "Task type average — median elapsed for tasks sharing the same
 * templateItemId, or the same title pattern when ad hoc."
 *
 * Task templates were removed, and `templateItemId` with them, so the second
 * half of that sentence is now the whole rule: work of the same kind is work
 * with the same title. Keeping a `?? templateItemId` branch here would be a
 * branch that can never run. Shared between the
 * TASK_AGING alert rule (scanner.cron.ts) and the frontend-facing elapsed-vs-
 * median figure on My Work — both must group and compute the same way, or
 * "aging" and "shown against the median" would silently mean two different
 * things depending which screen you're looking at.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const normalizeTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

export const taskTypeGroupKey = (t: { title: string }) => `title:${normalizeTitle(t.title)}`;

/**
 * Median elapsed working-minutes per task-type group, computed from every
 * completed task in the org. A group needs at least 3 data points to count —
 * fewer than that isn't a meaningful median, same threshold the alert rule uses.
 */
export async function computeTaskTypeMedians(organizationId: string): Promise<Map<string, number>> {
  const doneTasks = await prisma.task.findMany({
    where: { organizationId, status: 'DONE', completedAt: { not: null }, deletedAt: null },
    select: { title: true, assignedAt: true, completedAt: true, waitingTotalMinutes: true },
  });
  const calendar = await loadWorkCalendar(organizationId);
  const elapsedByGroup = new Map<string, number[]>();
  for (const t of doneTasks) {
    const key = taskTypeGroupKey(t);
    const minutes = workingMinutesOn(calendar, t.assignedAt, t.completedAt!, t.waitingTotalMinutes).totalMinutes;
    const arr = elapsedByGroup.get(key) ?? [];
    arr.push(minutes);
    elapsedByGroup.set(key, arr);
  }
  const medianByGroup = new Map<string, number>();
  for (const [key, values] of elapsedByGroup) {
    if (values.length < 3) continue;
    medianByGroup.set(key, median(values));
  }
  return medianByGroup;
}
