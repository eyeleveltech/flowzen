import { getStatusColor, getStatusLabel } from './status';

/**
 * Single source of truth for the task-status vocabulary.
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
  BACKLOG: getStatusLabel('BACKLOG'),
  TODO: getStatusLabel('TODO'),
  IN_PROGRESS: getStatusLabel('IN_PROGRESS'),
  REVIEW: 'In Review',
  APPROVED: getStatusLabel('APPROVED'),
  BLOCKED: getStatusLabel('BLOCKED'),
  ON_HOLD: getStatusLabel('ON_HOLD'),
  COMPLETED: 'Done',
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  BACKLOG: `${getStatusColor('BACKLOG').bg} ${getStatusColor('BACKLOG').text}`,
  TODO: `${getStatusColor('TODO').bg} ${getStatusColor('TODO').text}`,
  IN_PROGRESS: `${getStatusColor('IN_PROGRESS').bg} ${getStatusColor('IN_PROGRESS').text}`,
  REVIEW: `${getStatusColor('REVIEW').bg} ${getStatusColor('REVIEW').text}`,
  APPROVED: `${getStatusColor('APPROVED').bg} ${getStatusColor('APPROVED').text}`,
  BLOCKED: `${getStatusColor('BLOCKED').bg} ${getStatusColor('BLOCKED').text}`,
  ON_HOLD: `${getStatusColor('ON_HOLD').bg} ${getStatusColor('ON_HOLD').text}`,
  COMPLETED: `${getStatusColor('COMPLETED').bg} ${getStatusColor('COMPLETED').text}`,
};

/** Ready-made options for <Select> / <MultiSelect>. */
export const TASK_STATUS_OPTIONS: { label: string; value: string }[] = TASK_STATUSES.map((value) => ({
  label: TASK_STATUS_LABELS[value] || getStatusLabel(value),
  value,
}));
