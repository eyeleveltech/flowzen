/**
 * My Work's column filters: what each column can be narrowed by, and whether a
 * task passes. Every filter is "any of these"; filters on different columns
 * all have to pass. Nothing ticked on a column is that column not filtering.
 */

import { getPriorityLabel } from '@/lib/priority';
import { taskTypeLabel } from '@/lib/task-type';
import type { FilterOption } from '@/components/ui/column-filter';

export type MyWorkFilters = {
  /** Words in the title, the client or the project. */
  text: string;
  type: string[];
  client: string[];
  due: string[];
  priority: string[];
  elapsed: string[];
  status: string[];
};

export const NO_FILTERS: MyWorkFilters = { text: '', type: [], client: [], due: [], priority: [], elapsed: [], status: [] };

export const isFiltering = (f: MyWorkFilters) =>
  Boolean(f.text.trim()) || f.type.length + f.client.length + f.due.length + f.priority.length + f.elapsed.length + f.status.length > 0;

export type FilterableTask = {
  title: string;
  taskType?: string | null;
  clientName: string;
  projectName?: string | null;
  internalProjectName?: string | null;
  dueDate: string;
  status: string;
  priority: string;
  workingMinutes: number;
};

/** "Today" for the filters: today's date and a working day's length in minutes. */
export type FilterContext = { today: string; dayMinutes: number };

const FINISHED = ['DONE', 'CANCELLED'];
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Which "when" a task's due date falls in. A finished task is never overdue — it is "Earlier". */
export function dueWhen(t: FilterableTask, today: string): string {
  const due = t.dueDate.slice(0, 10);
  if (due < today) return FINISHED.includes(t.status) ? 'EARLIER' : 'OVERDUE';
  if (due === today) return 'TODAY';
  if (due <= addDays(today, 7)) return 'WEEK';
  return 'LATER';
}

/** How long it has been open (or took), in working days. */
export function elapsedRange(t: FilterableTask, dayMinutes: number): string {
  const day = Math.max(60, dayMinutes);
  if (t.workingMinutes < day) return 'UNDER_DAY';
  if (t.workingMinutes <= 3 * day) return 'ONE_TO_THREE';
  return 'OVER_THREE';
}

const DUE: [string, string][] = [
  ['OVERDUE', 'Overdue'],
  ['TODAY', 'Today'],
  ['WEEK', 'Next 7 days'],
  ['LATER', 'Later'],
  ['EARLIER', 'Earlier (done)'],
];
const PRIORITY = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const ELAPSED: [string, string][] = [
  ['UNDER_DAY', 'Under a day'],
  ['ONE_TO_THREE', '1 to 3 days'],
  ['OVER_THREE', 'Over 3 days'],
];
const STATUS: [string, string][] = [
  ['TODO', 'To do'],
  ['IN_PROGRESS', 'In progress'],
  ['ON_HOLD', 'On hold'],
  ['DONE', 'Done'],
];

const typeOf = (t: FilterableTask) => t.taskType ?? 'NONE';

export function matchesFilters(t: FilterableTask, f: MyWorkFilters, ctx: FilterContext): boolean {
  const words = f.text.trim().toLowerCase();
  if (words) {
    const hay = [t.title, t.clientName, t.projectName, t.internalProjectName].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(words)) return false;
  }
  if (f.type.length && !f.type.includes(typeOf(t))) return false;
  if (f.client.length && !f.client.includes(t.clientName)) return false;
  if (f.due.length && !f.due.includes(dueWhen(t, ctx.today))) return false;
  if (f.priority.length && !f.priority.includes(t.priority)) return false;
  if (f.elapsed.length && !f.elapsed.includes(elapsedRange(t, ctx.dayMinutes))) return false;
  if (f.status.length && !f.status.includes(t.status)) return false;
  return true;
}

/** What each column offers, from the tasks on the list — only values somebody has, with how many. */
export function filterOptions(tasks: FilterableTask[], ctx: FilterContext) {
  const count = (key: (t: FilterableTask) => string) => {
    const m = new Map<string, number>();
    for (const t of tasks) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
    return m;
  };
  const fixed = (order: [string, string][], counts: Map<string, number>): FilterOption[] =>
    order.filter(([v]) => counts.has(v)).map(([value, label]) => ({ value, label, count: counts.get(value)! }));

  const types = count(typeOf);
  const clients = count((t) => t.clientName);
  const priorities = count((t) => t.priority);

  return {
    type: [...types.entries()]
      .map(([value, n]) => ({ value, label: value === 'NONE' ? 'No type' : (taskTypeLabel(value) ?? value), count: n }))
      .sort((a, b) => (a.value === 'NONE' ? 1 : b.value === 'NONE' ? -1 : a.label.localeCompare(b.label))),
    // Clients by name, the studio's own work last.
    client: [...clients.entries()]
      .map(([value, n]) => ({ value, label: value, count: n }))
      .sort((a, b) => (a.value === 'Internal' ? 1 : b.value === 'Internal' ? -1 : a.label.localeCompare(b.label))),
    due: fixed(DUE, count((t) => dueWhen(t, ctx.today))),
    priority: PRIORITY.filter((p) => priorities.has(p)).map((p) => ({ value: p, label: getPriorityLabel(p), count: priorities.get(p)! })),
    elapsed: fixed(ELAPSED, count((t) => elapsedRange(t, ctx.dayMinutes))),
    status: fixed(STATUS, count((t) => t.status)),
  };
}
