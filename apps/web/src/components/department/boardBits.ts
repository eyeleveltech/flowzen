/**
 * The Board's words — what Team → Board said about a task, kept for My
 * Department, which replaced it (Department head page plan). Now, Next up and
 * the counts mean exactly what they meant there.
 */

import { formatDate, type TeamBoard, type TeamBoardList, type TeamBoardReason } from '@/lib/api-v2';
import type { Tone } from '@/components/ui/badge';
import type { DrawerTask } from '@/components/work/TaskDrawer';
import { monthLabel } from '@/lib/retainerBilling';

export type BoardTask = TeamBoard['tasks'][string];

export const TASK_STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
export const statusLabel = (s: string) => TASK_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;

/** A person's counts, in the plan's order. Each is a list of task ids. */
export const PERSON_COUNTS: { key: TeamBoardList; label: string; hint: string }[] = [
  { key: 'open', label: 'Open', hint: 'To do, In progress and On hold' },
  { key: 'overdue', label: 'Overdue', hint: 'Open, past its due date' },
  { key: 'waiting', label: 'On hold', hint: 'Waiting on the client, someone else, or just paused' },
  { key: 'inReview', label: 'In review', hint: 'Sent for approval, with an approver' },
  { key: 'doneThisWeek', label: 'Done this week', hint: 'Finished since Monday' },
];

export const REASON: Record<TeamBoardReason, { label: string; tone: Tone }> = {
  OVERDUE: { label: 'Overdue', tone: 'bad' },
  WAITING_LONG: { label: 'On hold 3+ working days', tone: 'warn' },
  REVIEW_LONG: { label: 'Stuck in review', tone: 'review' },
  URGENT_NOT_STARTED: { label: 'Urgent, not started', tone: 'warn' },
};

/** The one fact behind the first reason: a date, never a running clock. */
export function reasonDetail(reason: TeamBoardReason, t: BoardTask): string {
  switch (reason) {
    case 'OVERDUE':
      return `was due ${formatDate(t.dueDate)}`;
    case 'WAITING_LONG':
      return `on hold since ${formatDate(t.waitingSince)}${
        t.waitingOn === 'CLIENT' ? ', waiting on the client' : t.waitingOn === 'ANOTHER_PERSON' ? ', waiting on someone else' : ''
      }`;
    case 'REVIEW_LONG':
      return `sent ${formatDate(t.lastReview?.submittedAt)}, past the reminder time`;
    case 'URGENT_NOT_STARTED':
      return `still to do, due ${formatDate(t.dueDate)}`;
  }
}

/** Where the task belongs, in one short line. */
export const placeLine = (t: BoardTask) =>
  [t.clientName, t.projectName ?? (t.monthCardMonth ? `${monthLabel(t.monthCardMonth)} retainer` : null)]
    .filter(Boolean)
    .join(' · ');

/** As the task drawer takes it. */
export const toDrawerTask = (t: BoardTask): DrawerTask =>
  ({ ...t, workLabel: t.monthCardMonth ? `${monthLabel(t.monthCardMonth)} retainer` : null }) as unknown as DrawerTask;

const OPEN = ['TODO', 'IN_PROGRESS', 'ON_HOLD'];

/** The person panel's groups, in the order a head reads them. */
export const TASK_GROUPS = ['Overdue', 'Today', 'This week', 'Later', 'Waiting', 'In review'] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/**
 * A person's tasks as the person panel groups them. Waiting (on hold) and In
 * review are their own groups, whatever their dates; the rest go by due date
 * against the studio's today and the week's Sunday. Done tasks are left out.
 */
export function groupTasks(tasks: BoardTask[], today: string, weekEnd: string): Record<TaskGroup, BoardTask[]> {
  const out = Object.fromEntries(TASK_GROUPS.map((g) => [g, [] as BoardTask[]])) as Record<TaskGroup, BoardTask[]>;
  const byDue = [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const t of byDue) {
    const due = t.dueDate.slice(0, 10);
    if (t.status === 'IN_REVIEW') out['In review'].push(t);
    else if (t.status === 'ON_HOLD') out.Waiting.push(t);
    else if (!OPEN.includes(t.status)) continue;
    else if (due < today) out.Overdue.push(t);
    else if (due === today) out.Today.push(t);
    else if (due <= weekEnd) out['This week'].push(t);
    else out.Later.push(t);
  }
  return out;
}
