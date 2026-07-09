/**
 * Single source of truth for the task-status vocabulary.
 *
 * Mirrors `enum TaskStatus` in apps/api/prisma/schema.prisma and the `status`
 * enum in apps/api/src/routes/tasks.ts — all three must list the same values.
 * This list previously lived in four separate files, each missing different
 * values, which made some statuses unselectable and others render unstyled or
 * disappear from the Kanban board entirely.
 *
 * Order matters: it is the left-to-right Kanban column order.
 */
export const TASK_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'APPROVED',
  'BLOCKED',
  'ON_HOLD',
  'COMPLETED',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'In Review',
  APPROVED: 'Approved',
  BLOCKED: 'Blocked',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Done',
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  BACKLOG: 'bg-gray-100 text-gray-600',
  TODO: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  REVIEW: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-teal-50 text-teal-700',
  BLOCKED: 'bg-red-50 text-red-700',
  ON_HOLD: 'bg-purple-50 text-purple-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
};

/** Ready-made options for <Select> / <MultiSelect>. */
export const TASK_STATUS_OPTIONS: { label: string; value: string }[] = TASK_STATUSES.map((value) => ({
  label: TASK_STATUS_LABELS[value],
  value,
}));
