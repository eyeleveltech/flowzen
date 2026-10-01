import type { TaskRepeatInfo } from '@/lib/repeat';
/**
 * The pieces the retainer screen and the project screen both need.
 *
 * A project used to be a drill-in inside `retainers/[id]` — the same page,
 * swapping its own body out. Giving it a route of its own meant two files
 * needed the same task shape, the same status vocabulary and the same two date
 * helpers, and the cheap thing would have been to copy them.
 *
 * Copied, they drift: one screen learns about a new status and the other keeps
 * rendering it as a blank cell, and nothing fails until somebody notices the
 * blank. So they live here once.
 */

import type { RetainerProject } from '@/lib/api-v2';

export type TaskStatusValue = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'ON_HOLD' | 'DONE' | 'CANCELLED';

/**
 * The statuses somebody can pick from a menu.
 *
 * Not "In review": a task gets there only by "Send for approval", which
 * records the round and who it went to. `statusChoices` below adds it back
 * for a task that is in review, so the menu can show where it stands.
 */
export const TASK_STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** Every status, in words — In review included. */
export const TASK_STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  ON_HOLD: 'On hold',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

/** The pill for each status — the tones every task list uses. */
export const TASK_STATUS_TONE: Record<string, string> = {
  TODO: 'border-border text-secondary',
  IN_PROGRESS: 'border-info/30 text-info bg-info-tint',
  IN_REVIEW: 'border-review/30 text-review bg-review-tint',
  ON_HOLD: 'border-warning/30 text-warning-ink bg-warning-tint',
  DONE: 'border-success/30 text-success bg-success-tint',
  CANCELLED: 'border-border text-secondary',
};

/**
 * What a task's own status menu may offer.
 *
 *   · In review: only where it is and Cancel — an approver moves it on.
 *   · Needs approval: no Done — it gets there by being approved.
 *   · Anything else: the usual list.
 */
export function statusChoices(
  options: { value: string; label: string }[],
  task: { status: string; needsApproval?: boolean | null },
): { value: string; label: string }[] {
  if (task.status === 'IN_REVIEW') {
    return [
      { value: 'IN_REVIEW', label: 'In review' },
      ...options.filter((o) => o.value === 'CANCELLED'),
    ];
  }
  // Nobody picks In review — "Send for approval" puts a task there.
  const pickable = options.filter((o) => o.value !== 'IN_REVIEW');
  if (task.needsApproval && task.status !== 'DONE') return pickable.filter((o) => o.value !== 'DONE');
  return pickable;
}

export type RetainerTask = {
  id: string;
  title: string;
  /** Which piece of retainer work it is part of, if any. */
  retainerProject?: { id: string; name: string; status: string } | null;
  status: TaskStatusValue;
  priority: string;
  dueDate: string;
  /** Optional, "17:30" — shown after the date. */
  dueTime?: string | null;
  /** The repeat, if it is a copy in one — the small mark beside the title. */
  repeat?: TaskRepeatInfo | null;
  assignedAt: string;
  completedAt: string | null;
  notes: string | null;
  reopenCount: number;
  waitingOn: 'CLIENT' | 'ANOTHER_PERSON' | null;
  taskType: string | null;
  assignee: { id: string; name: string; designation?: string | null; dept: string } | null;
  /** Everybody on it, lead first. */
  assignees?: { id: string; name: string; designation?: string | null }[];
  assignedBy?: { id: string; name: string } | null;
  creator?: { id: string; name: string } | null;
  reviewer?: { id: string; name: string } | null;
  needsApproval?: boolean;
  lastReview?: {
    round: number;
    decision: 'APPROVED' | 'CHANGES_REQUESTED' | null;
    feedback: string | null;
    decidedAt: string | null;
    submittedAt: string;
  } | null;
};

/** What `GET /retainers/:id/projects/:projectId/tasks` returns. */
export type ProjectTaskView = {
  project: RetainerProject | null;
  months: { month: string; status: string; tasks: RetainerTask[] }[];
  total: number;
};

/** "2026-09" → "September 2026". */
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

/** "2026-09" shifted by whole months, still as "2026-09". */
export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/** How long a project runs, in the words the card uses. */
export function describeRun(p: RetainerProject): string {
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (p.startDate && p.endDate) return `${day(p.startDate)} – ${day(p.endDate)}`;
  if (p.startDate) return `from ${day(p.startDate)}`;
  if (p.endDate) return `until ${day(p.endDate)}`;
  return 'ongoing';
}

/**
 * Past its due date, and neither finished nor called off — nor waiting on an
 * approver, which is not its assignee's lateness.
 */
export const isTaskLate = (t: { status: string; dueDate: string }, todayKey: string) =>
  t.status !== 'DONE' && t.status !== 'CANCELLED' && t.status !== 'IN_REVIEW' && t.dueDate.slice(0, 10) < todayKey;

/**
 * What the status filter offers.
 *
 * "Late" is not a status — it is a due date that has passed on work that is
 * neither done nor called off — but it is what people mean when they ask what
 * state something is in, so it sits with the rest.
 */
export const TASK_FILTER_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'LATE', label: 'Late' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const matchesStatusFilter = (
  t: RetainerTask,
  filter: string[],
  todayKey: string,
): boolean =>
  filter.length === 0 ||
  filter.some((f) =>
    f === 'OPEN'
      ? t.status === 'TODO' || t.status === 'IN_PROGRESS'
      : f === 'LATE'
        ? isTaskLate(t, todayKey)
        : t.status === f,
  );
