/**
 * The studio's own work (Internal work plan).
 *
 *   Every task belongs to ONE of these:
 *   ├─ Client work ── a retainer (monthly) or a one-time project
 *   └─ Internal (the studio's own work)
 *        ├─ an internal project   e.g. "Hiring", "Website revamp"
 *        └─ No project            e.g. "Renew domain"
 *
 * "No project" is a choice made on the task form, not a skipped field. These
 * are the rules every screen counts it and an internal project's progress by,
 * so Live work, All work and the owner's reminder cannot disagree.
 */

/**
 * A task with no client and no project of any kind — "Internal — no project".
 *
 * The same nulls All work's "Internal" filter uses, plus no internal project.
 * A follow-up about a client (no project, but a client) is that client's.
 */
export const NO_PROJECT_WHERE = {
  projectId: null,
  monthCardId: null,
  companyId: null,
  internalProjectId: null,
} as const;

/** Still owed: what All work's default "Unfinished" means. */
export const UNFINISHED = ['TODO', 'IN_PROGRESS', 'ON_HOLD'] as const;

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Whole calendar days from `today` to `day` — negative once it has passed. */
export function daysBetween(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Late, the way the rest of the app means it: past its due date and not finished. */
export const isLate = (t: { status: string; dueDate: Date }, today: string) =>
  t.status !== 'DONE' && t.status !== 'CANCELLED' && dayOf(t.dueDate) < today;

export type ProgressTask = {
  id: string;
  title: string;
  status: string;
  dueDate: Date;
  assignees: { user: { id: string; name: string } }[];
};

/**
 * How an internal project is going: % done, open and overdue counts, the next
 * task due, who is on its open work, and how far off its target date is.
 *
 * Cancelled work counts for nothing, either way. With no tasks there is no
 * percentage to give, so it is null rather than a 0% that reads as "stuck".
 */
export function projectProgress(
  project: { status: string; targetDate: Date | null },
  tasks: ProgressTask[],
  today: string,
) {
  const counted = tasks.filter((t) => t.status !== 'CANCELLED');
  const done = counted.filter((t) => t.status === 'DONE').length;
  const open = counted.filter((t) => t.status !== 'DONE');
  const next = [...open].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0] ?? null;

  const people = new Map<string, { id: string; name: string; open: number }>();
  for (const t of open) {
    for (const { user } of t.assignees) {
      const row = people.get(user.id) ?? { id: user.id, name: user.name, open: 0 };
      row.open += 1;
      people.set(user.id, row);
    }
  }

  const target = project.targetDate ? dayOf(project.targetDate) : null;
  const daysLeft = target ? daysBetween(today, target) : null;

  return {
    percentDone: counted.length > 0 ? Math.round((done / counted.length) * 100) : null,
    total: counted.length,
    done,
    open: open.length,
    overdue: open.filter((t) => isLate(t, today)).length,
    nextDue: next ? { id: next.id, title: next.title, dueDate: dayOf(next.dueDate) } : null,
    // By name: who is on it, not who is carrying most.
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    /** Days to the target date; negative once it has passed. Null with no target. */
    daysLeft,
    /** Past its target with work still open, while it is still running. */
    pastTarget: project.status === 'ACTIVE' && daysLeft !== null && daysLeft < 0 && open.length > 0,
  };
}
