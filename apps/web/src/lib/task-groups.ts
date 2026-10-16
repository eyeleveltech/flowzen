/**
 * "Group by" for a list of tasks (Internal work plan, decision 4).
 *
 * Done in the browser, on the list already fetched with its filters — so the
 * filters still apply inside every group, and a Head's list is already their
 * scope. Groups keep the list's own order inside them.
 *
 * How tasks are organised, which "Project or retainer" follows:
 *
 *   Client work ── a retainer (monthly) or a one-time project
 *   Internal ───── an internal project, or "Internal — no project"
 */

export type TaskGroup<T> = {
  key: string;
  label: string;
  /** A second, quieter line: the client a project is for, say. */
  sub?: string;
  /** Red, for Overdue. */
  tone?: 'bad';
  tasks: T[];
};

/** What a task needs to be grouped by any of these. */
export type GroupableTask = {
  id: string;
  dueDate: string;
  isOverdue?: boolean;
  clientName: string | null;
  companyId: string | null;
  projectId?: string | null;
  retainerProjectId?: string | null;
  internalProjectId?: string | null;
  retainerId?: string | null;
  monthCardMonth?: string | null;
  projectName: string | null;
  assignees: { id: string; name: string }[];
};

export const NO_PROJECT_LABEL = 'Internal — no project';

/** Groups in a fixed order: `rank` first, then the label. */
function collect<T>(
  tasks: T[],
  keysOf: (t: T) => { key: string; label: string; sub?: string; rank: number; tone?: 'bad' }[],
): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T> & { rank: number }>();
  for (const t of tasks) {
    for (const k of keysOf(t)) {
      const g = groups.get(k.key) ?? { key: k.key, label: k.label, sub: k.sub, tone: k.tone, rank: k.rank, tasks: [] };
      g.tasks.push(t);
      groups.set(k.key, g);
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || `${a.sub ?? ''} ${a.label}`.localeCompare(`${b.sub ?? ''} ${b.label}`))
    .map((g): TaskGroup<T> => ({ key: g.key, label: g.label, sub: g.sub, tone: g.tone, tasks: g.tasks }));
}

/**
 * The piece of work a task belongs to: a one-time project, a retainer's
 * workstream, an internal project — or "Internal — no project". A follow-up
 * about a client with no project is that client's.
 */
export function workOf(t: GroupableTask): { key: string; label: string; sub?: string; rank: number } {
  const client = t.clientName ?? 'Internal';
  if (t.projectId) return { key: `P:${t.projectId}`, label: t.projectName ?? 'Project', sub: client, rank: 0 };
  if (t.retainerProjectId) return { key: `RP:${t.retainerProjectId}`, label: t.projectName ?? 'Retainer work', sub: `${client} · retainer`, rank: 0 };
  if (t.retainerId || t.monthCardMonth) return { key: `R:${t.retainerId ?? client}`, label: `${client} retainer`, rank: 0 };
  if (t.internalProjectId) return { key: `IP:${t.internalProjectId}`, label: t.projectName ?? 'Internal project', sub: 'Internal', rank: 2 };
  if (t.companyId) return { key: `C:${t.companyId}`, label: `${client} — no project`, rank: 1 };
  return { key: 'NO_PROJECT', label: NO_PROJECT_LABEL, rank: 3 };
}

export const byWork = <T extends GroupableTask>(tasks: T[]) => collect(tasks, (t) => [workOf(t)]);

export const byClient = <T extends GroupableTask>(tasks: T[]) =>
  collect(tasks, (t) =>
    t.companyId
      ? [{ key: t.companyId, label: t.clientName ?? 'Client', rank: 0 }]
      : [{ key: 'INTERNAL', label: 'Internal', rank: 1 }],
  );

/**
 * By person: a task with two people is under both — it is on both their desks.
 * With a person filter on, only the people asked about.
 */
export const byPerson = <T extends GroupableTask>(tasks: T[], only: string[] = []) =>
  collect(tasks, (t) => {
    const people = t.assignees.filter((a) => only.length === 0 || only.includes(a.id));
    return people.length > 0
      ? people.map((a) => ({ key: a.id, label: a.name, rank: 0 }))
      : [{ key: 'NOBODY', label: 'Nobody on it', rank: 1 }];
  });

/**
 * By the department of the people on it, in Settings' order — each department
 * once, however many of its people are on the task. With a department filter
 * on, only the departments asked about.
 */
export function byDepartment<T extends GroupableTask>(
  tasks: T[],
  departmentOf: (personId: string) => string | null,
  departments: { id: string; name: string }[],
  only: string[] = [],
) {
  const order = new Map(departments.map((d, i) => [d.id, i]));
  return collect(tasks, (t) => {
    const ids = [...new Set(t.assignees.map((a) => departmentOf(a.id)))].filter(
      (id) => only.length === 0 || (id !== null && only.includes(id)),
    );
    if (ids.length === 0) return [{ key: 'NONE', label: 'No department', rank: 100_000 }];
    return ids.map((id) =>
      id && order.has(id)
        ? { key: id, label: departments[order.get(id)!].name, rank: order.get(id)! }
        : { key: 'NONE', label: 'No department', rank: 100_000 },
    );
  });
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * By when it is due: Overdue, Today, This week (to Sunday), Later — and
 * Earlier, for a past date that is not overdue because the task is finished
 * or with an approver. "No date" for a task without one.
 */
export function byDue<T extends GroupableTask>(tasks: T[], today: string) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sunday = addDays(today, (7 - weekday) % 7);
  return collect(tasks, (t) => {
    const due = t.dueDate ? t.dueDate.slice(0, 10) : null;
    if (t.isOverdue) return [{ key: 'overdue', label: 'Overdue', rank: 0, tone: 'bad' as const }];
    if (!due) return [{ key: 'nodate', label: 'No date', rank: 5 }];
    if (due === today) return [{ key: 'today', label: 'Today', rank: 1 }];
    if (due > today && due <= sunday) return [{ key: 'week', label: 'This week', rank: 2 }];
    if (due > sunday) return [{ key: 'later', label: 'Later', rank: 3 }];
    return [{ key: 'earlier', label: 'Earlier — finished or with an approver', rank: 4 }];
  });
}
